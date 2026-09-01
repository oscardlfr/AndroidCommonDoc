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
const os = require('os');
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

// ─────────────────────────────────────────────────────────────────────────────
// M6+M7 SIXTEENTH Phase 2C: sealed git-topology cache. `projectGitFactsOnce`/
// `projectRealOnceForScope`/`gitDerivedSensitiveRootsCache` (runtime-bridge-
// codex.cjs, runtime-consultation.cjs) each memoize a `git rev-parse`-derived
// identity ONCE per distinct projectRoot string, for the life of the process
// -- a real, measured perf necessity (a real `git` subprocess spawn per call,
// re-run on every one of hundreds of authority decisions across a retained
// supervisor's lifetime, previously caused a genuine multi-minute busy-loop
// hang under the real five-role plane). But "worktree toplevel / git common
// dir cannot change for the life of THIS process" is only true absent a
// hostile or buggy actor mutating `.git`/the worktree's gitdir pointer out
// from under it mid-session -- a plain memo has no way to ever notice that.
// This seals the concrete on-disk facts a git-topology swap would have to
// change (the `.git` entry's own identity, its content if it's a linked-
// worktree gitdir pointer file, the resolved gitdir target's identity, and
// the git-common-dir's identity), and re-proves them CHEAPLY (lstat/readlink/
// one small file read -- never a second git spawn) before every reuse of a
// cached derivation. A mismatch fails closed; it is NEVER treated as "just
// recompute and accept the new topology" -- a cache entry, once sealed, is
// either still valid or the call fails, exactly like any other durable-read
// identity check this codebase already uses (classifyDurableRead's own
// path-identity-across-the-read discipline, applied here across CALLS
// instead of within one read).
// ─────────────────────────────────────────────────────────────────────────────

function statIdentityOrNull(p) {
  try {
    const st = fs.lstatSync(p);
    return {
      dev: st.dev, ino: st.ino, mode: st.mode, uid: st.uid, nlink: st.nlink,
      isDirectory: st.isDirectory(), isFile: st.isFile(), isSymbolicLink: st.isSymbolicLink(),
    };
  } catch (err) {
    return null;
  }
}

function readlinkOrNull(p) {
  try {
    return fs.readlinkSync(p);
  } catch (err) {
    return null;
  }
}

/**
 * fd-bound whole-file read (AUDIT-raw-reads' own discipline, never a raw
 * by-path read): open no-follow, fstat-confirm identity against the
 * just-taken lstat before trusting the fd at all, read, fstat again after --
 * a swap landing exactly inside this narrow window is caught here rather
 * than only on the NEXT seal comparison. Returns null (never throws) on any
 * absence/type-mismatch/identity-drift/read failure.
 * @param {string} p
 * @param {object} priorStat - result of statIdentityOrNull(p), already known non-null/isFile.
 * @returns {Buffer|null}
 */
function readFdBoundFileOrNull(p, priorStat) {
  let bytes = null;
  let fd;
  try {
    fd = fs.openSync(p, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const opened = fs.fstatSync(fd);
    if (opened.isFile() && opened.dev === priorStat.dev && opened.ino === priorStat.ino) {
      const chunks = [];
      const buf = Buffer.alloc(65536);
      let read;
      while ((read = fs.readSync(fd, buf, 0, buf.length, null)) > 0) chunks.push(Buffer.from(buf.subarray(0, read)));
      const afterStat = fs.fstatSync(fd);
      if (afterStat.dev === opened.dev && afterStat.ino === opened.ino && afterStat.size === opened.size) {
        bytes = Buffer.concat(chunks);
      }
    }
  } catch (err) {
    bytes = null;
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch (err) { /* best effort */ } }
  }
  return bytes;
}

/**
 * Captures the concrete, tamper-evident on-disk facts behind one resolved
 * `(projectReal, gitCommonDirReal)` pair. `.git` may be a real directory
 * (normal repo) or a file containing a `gitdir: <path>` pointer (linked
 * worktree, PLAN.md's own R33/WP3-ABI carrier shape) -- both arms are sealed;
 * an unexpected third shape (neither, e.g. `.git` deleted or replaced with
 * something else entirely) seals as a null gitdir target, which
 * `gitTopologySealsMatch` still compares exactly (a later swap back to a
 * directory would then correctly mismatch too).
 *
 * Correction (Codex review, post-Phase-2C): a linked worktree's OWN gitdir
 * target (`.../worktrees/<name>/`) contains a SEPARATE `commondir` file --
 * the thing `git rev-parse --git-common-dir` itself reads to resolve
 * `gitCommonDirReal`. The original seal only lstat'd the STRING
 * `gitCommonDirReal` (a snapshot from the one git spawn at derive time) --
 * never `commondir`'s own bytes -- so a later in-place rewrite of
 * `commondir` (repointing it elsewhere, without touching the gitdir target
 * directory's own dev/ino, or the OLD common-dir path's own dev/ino) went
 * completely unnoticed on reseal: the cache kept validating a `gitCommonDirReal`
 * string git itself would no longer produce. `commondir` is now sealed
 * directly (fd-bound, same discipline as the `.git`-pointer-file arm above)
 * whenever this is the linked-worktree shape, so its OWN byte-identity is
 * part of what every reseal re-proves, not just the derived string's stat.
 * @returns {object} plain, JSON-safe, directly comparable via deepStrictEqual-style field checks.
 */
function sealGitIdentityFor(projectReal, gitCommonDirReal) {
  const gitEntryPath = path.join(projectReal, '.git');
  const gitEntryStat = statIdentityOrNull(gitEntryPath);
  const gitEntrySymlinkTarget = gitEntryStat && gitEntryStat.isSymbolicLink ? readlinkOrNull(gitEntryPath) : null;
  const resolvedGitEntry = realpathOrSelf(gitEntryPath);
  const resolvedGitEntryStat = statIdentityOrNull(resolvedGitEntry);
  let gitdirFileSha256 = null;
  let gitdirTargetReal = null;
  let isLinkedWorktree = false;
  if (resolvedGitEntryStat && resolvedGitEntryStat.isFile) {
    isLinkedWorktree = true;
    const bytes = readFdBoundFileOrNull(resolvedGitEntry, resolvedGitEntryStat);
    if (bytes) {
      gitdirFileSha256 = sha256Buffer(bytes);
      const match = bytes.toString('utf8').match(/^gitdir:\s*(.+?)\s*$/m);
      const rawTarget = match ? match[1] : null;
      gitdirTargetReal = rawTarget
        ? realpathOrSelf(path.isAbsolute(rawTarget) ? rawTarget : path.resolve(projectReal, rawTarget))
        : null;
    }
  } else if (resolvedGitEntryStat && resolvedGitEntryStat.isDirectory) {
    gitdirTargetReal = resolvedGitEntry;
  }

  // <gitdirTargetReal>/commondir -- only meaningful (and only ever present)
  // for the linked-worktree shape; a normal repo's own .git directory IS
  // its common dir, with no separate indirection file. Sealed the SAME way
  // regardless of whether it currently exists: absence is itself part of
  // the sealed state, so a LATER appearance (or disappearance) of this file
  // is exactly as much a mismatch as a content change.
  let commondirStat = null;
  let commondirSymlinkTarget = null;
  let commondirSha256 = null;
  let commondirTargetReal = null;
  if (isLinkedWorktree && gitdirTargetReal) {
    const commondirPath = path.join(gitdirTargetReal, 'commondir');
    commondirStat = statIdentityOrNull(commondirPath);
    commondirSymlinkTarget = commondirStat && commondirStat.isSymbolicLink ? readlinkOrNull(commondirPath) : null;
    if (commondirStat && commondirStat.isFile) {
      const bytes = readFdBoundFileOrNull(commondirPath, commondirStat);
      if (bytes) {
        commondirSha256 = sha256Buffer(bytes);
        const raw = bytes.toString('utf8').replace(/\r?\n+$/, '');
        commondirTargetReal = raw
          ? realpathOrSelf(path.isAbsolute(raw) ? raw : path.resolve(gitdirTargetReal, raw))
          : null;
      }
    }
  }

  return {
    projectRealStat: statIdentityOrNull(projectReal),
    gitEntryStat,
    gitEntrySymlinkTarget,
    resolvedGitEntry,
    resolvedGitEntryStat,
    gitdirFileSha256,
    gitdirTargetReal,
    gitdirTargetStat: gitdirTargetReal ? statIdentityOrNull(gitdirTargetReal) : null,
    isLinkedWorktree,
    commondirStat,
    commondirSymlinkTarget,
    commondirSha256,
    commondirTargetReal,
    gitCommonDirReal,
    gitCommonDirStat: statIdentityOrNull(gitCommonDirReal),
  };
}

function statIdentityEqual(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  // M6+M7 SIXTEENTH Phase 2C correction (empirically forced): nlink is
  // deliberately EXCLUDED from this comparison. For a directory it is a
  // subdirectory reference COUNT (2 + one per immediate child dir), not an
  // identity property -- it legitimately changes every time any ordinary
  // sibling directory is created/removed anywhere under projectReal, .git,
  // the gitdir target, or the common-dir, all of which are actively-used
  // working directories during a real session (measured: a live retained
  // supervisor's own pollRetainedWorkers loop hit this as a false-positive
  // seal mismatch on ordinary repo activity, threw, and self-shut-down the
  // whole retained plane -- reproduced 100% of the time against a real
  // fixture, M6-CD-02's own regression). dev+ino is already the complete,
  // sufficient, and this codebase's own established "same underlying file"
  // proof (classifyDurableRead, readProtectedHostCodexPin); mode+uid add
  // genuine tamper signal (permission/ownership swap) without nlink's
  // volatility.
  return a.dev === b.dev && a.ino === b.ino && a.mode === b.mode && a.uid === b.uid
    && a.isDirectory === b.isDirectory && a.isFile === b.isFile
    && a.isSymbolicLink === b.isSymbolicLink;
}

/** Exact field-by-field comparison -- never a JSON.stringify shortcut (key-order-fragile). */
function gitTopologySealsMatch(a, b) {
  if (!a || !b) return false;
  return statIdentityEqual(a.projectRealStat, b.projectRealStat)
    && statIdentityEqual(a.gitEntryStat, b.gitEntryStat)
    && a.gitEntrySymlinkTarget === b.gitEntrySymlinkTarget
    && a.resolvedGitEntry === b.resolvedGitEntry
    && statIdentityEqual(a.resolvedGitEntryStat, b.resolvedGitEntryStat)
    && a.gitdirFileSha256 === b.gitdirFileSha256
    && a.gitdirTargetReal === b.gitdirTargetReal
    && statIdentityEqual(a.gitdirTargetStat, b.gitdirTargetStat)
    && a.isLinkedWorktree === b.isLinkedWorktree
    && statIdentityEqual(a.commondirStat, b.commondirStat)
    && a.commondirSymlinkTarget === b.commondirSymlinkTarget
    && a.commondirSha256 === b.commondirSha256
    && a.commondirTargetReal === b.commondirTargetReal
    && a.gitCommonDirReal === b.gitCommonDirReal
    && statIdentityEqual(a.gitCommonDirStat, b.gitCommonDirStat);
}

/**
 * Self-consistency gate, distinct from before/after seal comparison: does
 * `commondir`'s OWN on-disk content (as just read into this seal) actually
 * resolve to the SAME real path as `gitCommonDirReal` (the string git itself
 * produced via `rev-parse --git-common-dir` at derive time)? Required by
 * review: a divergence here -- even one that has existed since the very
 * first derive (so there is no "before" seal to diff against) -- must fail
 * closed rather than silently trusting whichever of the two sources looked
 * more convenient. Non-worktree repos (no commondir file at all) trivially
 * pass: there is nothing to correlate.
 * @returns {boolean}
 */
function sealCorrelatesWithGitCommonDir(seal, gitCommonDirReal) {
  if (!seal) return false;
  if (!seal.isLinkedWorktree) return true;
  if (!seal.commondirTargetReal) return false;
  return seal.commondirTargetReal === gitCommonDirReal;
}

/**
 * Generic sealed-cache wrapper for a per-projectRoot git-topology derivation.
 * `deriveFn(projectRoot)` runs the real (expensive, git-spawning) derivation
 * exactly once per distinct projectRoot for the life of this process -- same
 * memoization shape as before -- and must return
 * `{ok:true, projectReal, gitCommonDirReal, ...}` (extra fields pass through
 * untouched) or `{ok:false, reason}`. Every call (including the very first)
 * is sealed via `sealGitIdentityFor`; every REUSE of a cached entry first
 * cheaply reproves the seal still matches (lstat/readlink/read only, never a
 * second git spawn) before returning the cached derivation -- a mismatch
 * fails closed with `git-topology-seal-mismatch` rather than silently
 * recomputing and accepting a new topology under the same cache key.
 * @param {Map} cacheMap - private to ONE call site; never shared across sites with different derived shapes.
 * @param {string} projectRoot
 * @param {(projectRoot: string) => ({ok:true,projectReal:string,gitCommonDirReal:string}|{ok:false,reason:string})} deriveFn
 * @returns {{ok:true,derived:object}|{ok:false,reason:string}}
 */
function resolveSealedGitCache(cacheMap, projectRoot, deriveFn) {
  const existing = cacheMap.get(projectRoot);
  if (existing) {
    const freshSeal = sealGitIdentityFor(existing.derived.projectReal, existing.derived.gitCommonDirReal);
    if (!gitTopologySealsMatch(existing.seal, freshSeal)) {
      return { ok: false, reason: 'git-topology-seal-mismatch' };
    }
    if (!sealCorrelatesWithGitCommonDir(freshSeal, existing.derived.gitCommonDirReal)) {
      return { ok: false, reason: 'git-topology-commondir-correlation-mismatch' };
    }
    return { ok: true, derived: existing.derived };
  }
  let result;
  try {
    result = deriveFn(projectRoot);
  } catch (err) {
    return { ok: false, reason: 'git-topology-unresolvable' };
  }
  if (!result.ok) return result;
  const seal = sealGitIdentityFor(result.projectReal, result.gitCommonDirReal);
  if (!sealCorrelatesWithGitCommonDir(seal, result.gitCommonDirReal)) {
    return { ok: false, reason: 'git-topology-commondir-correlation-mismatch' };
  }
  cacheMap.set(projectRoot, { derived: result, seal });
  return { ok: true, derived: result };
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
 * Codex NO-GO round 6: `planRootFromArtifact`'s own confinement check above is
 * a MINIMUM-DEPTH check (>= 3 segments below `coordRoot`), not a genuine
 * inside-vs-outside check -- an artifact under a wholly unrelated root
 * (e.g. a completely different project's own, independently-confined
 * coordination tree) can easily relativize to >= 3 segments once `..` climb-
 * out segments are counted, and would pass unrejected. This is an
 * ADDITIONAL, stricter check (never a replacement -- callers needing the
 * derived plan-root still call `planRootFromArtifact` too) that rejects any
 * relative path requiring an escape (`..`) or landing on a different
 * absolute root entirely (e.g. a different drive on Windows, where
 * `path.relative` returns the target unchanged as an absolute path). Scoped
 * to this pass's own two new call sites (`cmdCancel`'s early request-path
 * check, `accreditCancelRecord`'s cancel-path check) -- `planRootFromArtifact`
 * itself and its other existing callers (`validateResultV2`, `validateConsultV2`,
 * etc.) are unchanged; whether they share this same gap is out of this pass's
 * named scope and is flagged, not fixed, here.
 *
 * Codex NO-GO round 8: `path.relative`/`path.resolve` are PURELY LEXICAL --
 * they never touch the filesystem, so a genuinely-confined-LOOKING path whose
 * ancestor directory is ACTUALLY a symlink resolving elsewhere on disk still
 * lexically "relativizes" as confined. `fs.realpathSync` resolves symlinks;
 * walking up to the DEEPEST EXISTING ancestor (rather than requiring the full
 * artifact path to already exist) lets this run on a path that is ABOUT to be
 * read/written, not only on one already durably present, while still
 * resolving every symlink actually on disk along the way.
 */
function realpathDeepestExisting(p) {
  let cur = path.resolve(p);
  const tail = [];
  for (;;) {
    try {
      return { real: fs.realpathSync(cur), tail: tail };
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      const parent = path.dirname(cur);
      if (parent === cur) throw err; // reached the filesystem root without resolving anything
      tail.unshift(path.basename(cur));
      cur = parent;
    }
  }
}

function assertGenuinelyConfinedUnderRoot(coordRoot, artifactPath) {
  let realCoordRoot;
  try {
    realCoordRoot = fs.realpathSync(coordRoot);
  } catch (err) {
    throw new CliError('INVALID', 'SECURITY_INVALID', 'coordination_root does not resolve: ' + coordRoot);
  }
  const { real: realExistingAncestor, tail } = realpathDeepestExisting(artifactPath);
  const fullReal = tail.length ? path.join(realExistingAncestor, ...tail) : realExistingAncestor;
  const rel = path.relative(realCoordRoot, fullReal);
  if (rel === '' || rel.startsWith('..' + path.sep) || rel === '..' || path.isAbsolute(rel)) {
    throw new CliError('INVALID', 'SECURITY_INVALID', 'artifact path is not confined under coordination_root once symlinks are resolved: ' + artifactPath);
  }
}

/** `--request`/cancel.json callers must reference the artifact at its own literal, canonical filename -- never a differently-named sibling whose basename is silently discarded via `path.dirname`. */
function assertCanonicalFilename(artifactPath, expectedBasename) {
  if (path.basename(artifactPath) !== expectedBasename) {
    throw new CliError('INVALID', 'SECURITY_INVALID', 'artifact is not referenced at its own canonical filename (' + expectedBasename + '): ' + artifactPath);
  }
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

/** Sixteenth §16c: the sole canonical location for Context7 pattern evidence. */
function patternEvidencePathFor(txnDir) {
  return path.join(txnDir, 'evidence', 'context7.json');
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
 *
 * `suppressFaultInjection` (M7 completeness, mirrors `publishNoClobber`'s own
 * `suppressInternalFaultInjection` -- see that option's doc comment): when
 * true, skips BOTH `isDirFsyncFaultActive`/`isDirCloseFaultActive` checks
 * below. Passed `true` ONLY by `publishNoClobber`'s own internal calls, and
 * ONLY when ITS caller opted in; `publishReplace`'s own call site never
 * passes this argument, so its behavior is completely unchanged.
 */
function fsyncDir(dirPath, barrierLabel, suppressFaultInjection) {
  let fd;
  let proven = false;
  let primaryClosed = false;
  try {
    fd = fs.openSync(dirPath, 'r');
    if (!suppressFaultInjection && isDirFsyncFaultActive(barrierLabel)) {
      dirFsyncFaultInjectedCount += 1;
      const injected = new Error('simulated directory-fsync failure (RUNTIME_CONSULTATION_FAULT_DIR_FSYNC)');
      injected.code = 'EIO';
      throw injected;
    }
    fs.fsyncSync(fd);
    if (!suppressFaultInjection && isDirCloseFaultActive(barrierLabel)) {
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
 *
 * `suppressFaultInjection` (M7 completeness): when true, skips both
 * `isTempHardenFaultActive` checks below -- see `publishNoClobber`'s own
 * `suppressInternalFaultInjection` doc comment. `publishReplace`'s own call
 * site never passes this argument.
 */
function hardenTempFdExact0600(fd, tempPath, suppressFaultInjection) {
  if (process.platform === 'win32') return; // POSIX-mode discipline only; Windows ACL confinement is PENDING_CI.
  try {
    if (!suppressFaultInjection && isTempHardenFaultActive('fchmod')) {
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
    if (!suppressFaultInjection && isTempHardenFaultActive('fstat')) {
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
 *
 * `opts.revalidateBeforeLink`, if given, is called with no arguments as the
 * LAST statement before the actual `linkSync` election below -- narrower
 * callers (cmdClaim) use it to re-accredit the data a no-clobber write is
 * ABOUT to durably commit as close to that commit as an ordinary JS callback
 * can get. Codex HARD NO-GO (round 18->19, cmdClaim): a caller-side check run
 * strictly BEFORE calling this function only closes the window up to this
 * function's OWN entry -- everything below (mkdir, temp create/harden/write/
 * fsync/fstat/close) still runs, unrevalidated, afterward. Placing the
 * revalidation here instead closes the window down to the gap between this
 * callback returning and `linkSync` actually executing -- the tightest
 * achievable without a hypothetical atomic "compare-then-link" primitive.
 *
 * `opts.suppressReplacePostRenameFaultInjection` (M7/WP4 Phase B.3): forwarded
 * verbatim to every internal `assertDurableTargetMatches` call -- see that
 * function's own doc comment for why this exists (a test-only fault seam
 * authored for `publishReplace` was leaking into `publishNoClobber`'s shared
 * comparator). Test-instrumentation-scope only; every real durability/replay/
 * security check this function performs is completely unaffected.
 *
 * `opts.suppressInternalFaultInjection` (M7 completeness, sibling fix to the
 * one directly above): the SAME leak class, for every OTHER test-only fault
 * seam this function itself checks directly (as opposed to inside the shared
 * `assertDurableTargetMatches` comparator) -- `isTempHardenFaultActive`
 * (`hardenTempFdExact0600`), `isNoclobberPrelinkFaultActive`,
 * `isLoserUnlinkFaultActive`, `isDirFsyncFaultActive`/`isDirCloseFaultActive`
 * (all three `fsyncDir` calls below: loser-cleanup, barrier1, barrier2), and
 * `isTempUnlinkFaultActive`/`isNoclobberPrevalidateFaultActive`. Confirmed
 * (M7 completeness pass, `consumeValidatedRoleCommandGrantOrThrow`'s grant-
 * consumption marker write) that a test fault var targeting one of THESE
 * families on a LATER, unrelated call could equally be "stolen" by this
 * earlier internal write, exactly like the REPLACE_POSTRENAME case above --
 * every fault check this function can reach is test-instrumentation-scope
 * only, so suppressing all of them together for one caller's own internal
 * write is the complete fix, not a per-fault-type patchwork that would need
 * re-discovering one fault family at a time. Passed `true` ONLY by
 * `consumeValidatedRoleCommandGrantOrThrow`; every other `publishNoClobber` caller's
 * behavior is completely unchanged. Deliberately a SEPARATE option from
 * `suppressReplacePostRenameFaultInjection` above (never merged/renamed) --
 * that one is already shipped/verified and governs the comparator only; this
 * one governs everything else `publishNoClobber` itself checks.
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
    hardenTempFdExact0600(tempFd, tempPath, options.suppressInternalFaultInjection);
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
  if (!options.suppressInternalFaultInjection && isNoclobberPrelinkFaultActive('swap')) {
    // Test-only (Codex P1-1 repro): simulate an attacker swapping the temp's content
    // between our own fsync+identity-capture and our linkSync below.
    try { fs.unlinkSync(tempPath); } catch (e) { /* best-effort test setup */ }
    fs.writeFileSync(tempPath, Buffer.from('RUNTIME_CONSULTATION_TEST_ATTACKER_SWAP_CONTENT'), { mode: 0o600 });
  } else if (!options.suppressInternalFaultInjection && isNoclobberPrelinkFaultActive('swap-same-bytes')) {
    // Test-only (Codex NO-GO round 2, missing-evidence item 3): swap to a FRESH file
    // carrying the EXACT SAME bytes we just wrote (`buf`) -- a different inode, but
    // byte-identical content. Isolates that the post-link revalidation's identity
    // binding (dev/ino), not merely a byte comparison, is what rejects the foreign
    // inode: a byte-only check would see identical content and wrongly accept it.
    try { fs.unlinkSync(tempPath); } catch (e) { /* best-effort test setup */ }
    fs.writeFileSync(tempPath, buf, { mode: 0o600 });
  }
  if (typeof options.revalidateBeforeLink === 'function') {
    try {
      options.revalidateBeforeLink();
    } catch (err) {
      // M7 GREEN section 4.6: a revalidateBeforeLink rejection (e.g. a
      // freshly-observed terminal) must leave ZERO observable mutation --
      // the temp-owner file already created/fsynced above is best-effort
      // cleaned up here too, mirroring the identical non-EEXIST linkSync
      // failure cleanup below. Never masks the original rejection reason.
      try { fs.unlinkSync(tempPath); } catch (cleanupErr) { /* best effort */ }
      throw err;
    }
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
        if (!options.suppressInternalFaultInjection && isLoserUnlinkFaultActive()) {
          const injected = new Error('injected loser-cleanup unlink failure (RUNTIME_CONSULTATION_FAULT_LOSER_UNLINK)');
          injected.code = 'EIO';
          throw injected;
        }
        fs.unlinkSync(tempPath);
      } catch (unlinkErr) {
        throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'no-clobber loser could not durably remove its own temp: ' + tempPath + ' (' + (unlinkErr && unlinkErr.message) + ')');
      }
      if (!fsyncDir(dir, 'loser-cleanup', options.suppressInternalFaultInjection)) {
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
          let idempotentSt;
          try {
            idempotentSt = assertDurableTargetMatches(existingFd, targetPath, buf, undefined, options.suppressReplacePostRenameFaultInjection);
          } catch (cmpErr) {
            if (cmpErr && cmpErr.byteMismatch) {
              throw new CliError('INVALID', options.raceDetailCode || 'AUTHORITY_INVALID', 'no-clobber race lost (existing durable target differs) for ' + targetPath);
            }
            throw cmpErr;
          }
          // Receipt built from the EXACT snapshot assertDurableTargetMatches
          // itself already accredited (its own return value) -- never a
          // separate, later fstat call on the same fd. Codex NO-GO round 17
          // (P1): the prior round's own "never a fresh by-path fstat" fix
          // still performed a fresh FD-BOUND fstat here, which is a narrower
          // but still-real gap -- a mutation landing between the comparator's
          // own internal proof (st/st2/lst all consistent) and this call would
          // have been silently adopted as if it were the original snapshot.
          return {
            path: targetPath, dev: idempotentSt.dev, ino: idempotentSt.ino,
            mode: idempotentSt.mode, uid: idempotentSt.uid, gid: idempotentSt.gid,
            nlink: idempotentSt.nlink, ctimeNs: idempotentSt.ctimeNs, mtimeNs: idempotentSt.mtimeNs,
            digest: sha256Buffer(buf),
          };
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
  if (!fsyncDir(dir, 'barrier1', options.suppressInternalFaultInjection)) {
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
    if (!options.suppressInternalFaultInjection && isTempUnlinkFaultActive()) {
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
  if (!fsyncDir(dir, 'barrier2', options.suppressInternalFaultInjection)) {
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
    if (!options.suppressInternalFaultInjection && isNoclobberPrevalidateFaultActive('delete')) {
      // Test-only (Codex P1-1 repro): simulate an attacker deleting the just-published
      // target after barrier 2 but before this revalidation observes it.
      try { fs.unlinkSync(targetPath); } catch (e) { /* best-effort test setup */ }
    } else if (!options.suppressInternalFaultInjection && isNoclobberPrevalidateFaultActive('hardlink')) {
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
    let publishedSt;
    try {
      // Codex NO-GO round 17 (P1): built directly from the comparator's OWN
      // return value -- the exact snapshot it already triple-proved stable
      // internally (st/st2/lst) -- rather than a separate, later fstat call
      // on the same fd. Round 16's own "captured immediately after" fix was
      // still a distinct, unvalidated re-read, reopening a fresh (if narrow)
      // window between the comparator's own proof and this call's own read;
      // see assertDurableTargetMatches's own matching comment.
      publishedSt = assertDurableTargetMatches(checkFd, targetPath, buf, { dev: tempIdentity.dev, ino: tempIdentity.ino }, options.suppressReplacePostRenameFaultInjection);
    } finally {
      try { fs.closeSync(checkFd); } catch (e) { /* best-effort cleanup */ }
    }
    // Receipt: dev/ino already fd-bound-proven above (tempIdentity, which now
    // IS the target's own identity post-linkSync); digest is over `buf`, the
    // exact bytes this call wrote -- never a re-read/re-serialization, so a
    // caller holding this receipt can later compare fresh fd-bound bytes/
    // identity against it directly, with no reconstruction step in between.
    return {
      path: targetPath, dev: tempIdentity.dev, ino: tempIdentity.ino,
      mode: publishedSt.mode, uid: publishedSt.uid, gid: publishedSt.gid,
      nlink: publishedSt.nlink, ctimeNs: publishedSt.ctimeNs, mtimeNs: publishedSt.mtimeNs,
      digest: sha256Buffer(buf),
    }; // COMPLETE: publish credited durable + fully revalidated.
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
 *
 * `suppressReplacePostRenameFaultInjection` (M7/WP4 Phase B.3, test-scope-leak fix):
 * `RUNTIME_CONSULTATION_FAULT_REPLACE_POSTRENAME` (`isReplacePostRenameFaultActive`,
 * test-capability-gated, zero effect in production regardless) was authored to
 * test `publishReplace`'s OWN post-rename revalidation specifically -- but this
 * comparator is SHARED with `publishNoClobber`'s own post-link revalidation, so
 * the SAME env var was incidentally also intercepting `publishNoClobber`'s
 * unrelated callers. Concretely: `consumeValidatedRoleCommandGrantOrThrow`'s
 * `publishNoClobber` write (the role-command-grant `.consumed` marker) now
 * legitimately runs BEFORE `cmdLeaseHeartbeat` ever acquires its lock (PLAN.md
 * ~L604: grant consumption happens "before any read or mutation"), so a fault
 * env var a test set to target `cmdLeaseHeartbeat`'s OWN later `publishReplace`
 * call was instead being consumed by this earlier, unrelated write -- never
 * reaching the `publishReplace` call the test actually targets. Passed `true`
 * ONLY by `publishNoClobber`, and ONLY when ITS OWN caller opts in via
 * `options.suppressReplacePostRenameFaultInjection` (currently only
 * `consumeValidatedRoleCommandGrantOrThrow`) -- `publishReplace`'s own call site never
 * passes this argument, so its behavior, and every other publishNoClobber
 * caller's, is completely unchanged. This affects ONLY which test-only fault
 * seam a call is subject to; every real replay/EEXIST/argv-digest/binding
 * check is untouched.
 */
function assertDurableTargetMatches(fd, targetPath, expectedBytes, expectedIdentity, suppressReplacePostRenameFaultInjection) {
  if (!suppressReplacePostRenameFaultInjection && isReplacePostRenameFaultActive('fstat1')) throw new Error('injected fstat1 fault');
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
    if (!suppressReplacePostRenameFaultInjection && isReplacePostRenameFaultActive('read')) throw new Error('injected read fault');
    const readback = readAllFromFd(fd, Number(st.size) + 1);
    if (Buffer.compare(readback, expectedBytes) !== 0) {
      // A genuine, durable target that simply carries DIFFERENT bytes is flagged distinctly so
      // an idempotent caller can map it to a no-clobber race-loss rather than a durability fault.
      mismatchErr = new CliError('INVALID', 'DURABILITY_UNPROVEN', 'target bytes do not match the payload: ' + targetPath);
      mismatchErr.byteMismatch = true;
    }
  }

  // Codex NO-GO round 16 (P1): ONLY evaluated when the bytes above already
  // matched -- if they didn't, mismatchErr (byteMismatch) already correctly
  // identifies this as "a different record occupies this path", and this
  // check must not steal that classification merely because an ordinary
  // content difference also touches ctimeNs. This exists for the NARROWER
  // case bytes alone can never catch: a rewrite-in-place (same inode)
  // FOLLOWED BY an exact-bytes restoration, indistinguishable from "never
  // touched" by content alone -- only comparing metadata against the
  // ORIGINAL publish-time snapshot (not just this call's own internal
  // st2/lst below, which only prove consistency across their OWN brief
  // window) can. When the caller supplies the FULL original snapshot
  // (mode/uid/gid/nlink/ctimeNs/mtimeNs, not just dev/ino --
  // `publishNoClobber`'s own internal temp-identity binding still passes
  // only dev/ino and is unaffected), a genuine rewrite changes at least
  // ctimeNs even if the final bytes are restored to identical.
  if (!mismatchErr && expectedIdentity && expectedIdentity.mode !== undefined && (
    st.mode !== expectedIdentity.mode || st.uid !== expectedIdentity.uid || st.gid !== expectedIdentity.gid
    || st.nlink !== expectedIdentity.nlink || st.ctimeNs !== expectedIdentity.ctimeNs || st.mtimeNs !== expectedIdentity.mtimeNs
  )) {
    throw new CliError('INVALID', 'SECURITY_INVALID', 'target metadata does not match its own original publish-time snapshot (rewritten since, even though current bytes match): ' + targetPath);
  }

  if (!suppressReplacePostRenameFaultInjection && isReplacePostRenameFaultActive('fstat2')) throw new Error('injected fstat2 fault');
  const st2 = fs.fstatSync(fd, { bigint: true });
  if (st2.dev !== st.dev || st2.ino !== st.ino || st2.nlink !== st.nlink || st2.size !== st.size || st2.mode !== st.mode || st2.uid !== st.uid || st2.gid !== st.gid || st2.ctimeNs !== st.ctimeNs || st2.mtimeNs !== st.mtimeNs) {
    throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'target identity changed during read (rewrite/chmod/hardlink/growth): ' + targetPath);
  }
  if (!suppressReplacePostRenameFaultInjection && isReplacePostRenameFaultActive('lstat')) throw new Error('injected lstat fault');
  const lst = fs.lstatSync(targetPath, { bigint: true });
  // PRESENT requires the LAST snapshot still be a single-link (nlink==1) inode with ALL
  // invariants -- including ctimeNs/mtimeNs -- unchanged from the stable fstat snapshot.
  if (lst.dev !== st.dev || lst.ino !== st.ino || lst.nlink !== st.nlink || lst.size !== st.size || lst.mode !== st.mode || lst.uid !== st.uid || lst.gid !== st.gid || lst.ctimeNs !== st.ctimeNs || lst.mtimeNs !== st.mtimeNs) {
    throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'target path rebound or invariants changed after read: ' + targetPath);
  }

  // Identity/path proven STABLE throughout the read -- ONLY NOW may a genuine byte/size
  // mismatch be surfaced as a race-loss candidate.
  if (mismatchErr) throw mismatchErr;
  // Codex NO-GO round 17 (P1): return the EXACT snapshot this call already
  // triple-proved stable (st == st2 == lst, all just asserted above) so a
  // caller building a receipt uses THIS accredited value directly, instead of
  // performing its own separate, later fstat on the same fd -- which would
  // reopen a fresh, unvalidated window between this function's own proof and
  // that subsequent read (the exact class of gap this function exists to
  // close in the first place).
  return st;
}

/**
 * Codex NO-GO round 15: post-publish re-verification that re-serializes a
 * PARSED object and compares digests (round 14's own "byte-exact" claim)
 * proves nothing about raw bytes OR inode identity -- two files with the
 * same JSON VALUES but different whitespace/key-order canonicalize to the
 * same string regardless, and a brand-new file carrying byte-identical
 * content but a DIFFERENT inode is indistinguishable from the genuine one by
 * digest alone. This reuses `assertDurableTargetMatches` -- the SAME
 * fd-bound comparator `publishNoClobber` already trusts for its own
 * post-link revalidation -- against a `receipt` `publishNoClobber` itself
 * returned at publish time (`{path,dev,ino,digest}`), so the caller never
 * reconstructs an "expected" value; it compares live fd-bound bytes and
 * identity directly against what THIS invocation is proven to have written.
 */
function assertArtifactMatchesReceipt(artifactPath, receipt, expectedBytes) {
  let fd;
  try {
    fd = fs.openSync(artifactPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  } catch (err) {
    if (err && err.code === 'ELOOP') {
      throw new CliError('INVALID', 'SECURITY_INVALID', 'artifact is a symlink (rejected at post-publish re-verification): ' + artifactPath);
    }
    throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'artifact vanished before post-publish re-verification: ' + artifactPath + ' (' + (err && err.message) + ')');
  }
  try {
    try {
      // Codex NO-GO round 16 (P1): the FULL receipt is passed through (not
      // just dev/ino) so assertDurableTargetMatches also proves mode/uid/gid/
      // nlink/ctimeNs/mtimeNs are unchanged since the ORIGINAL publish moment
      // -- catching a rewrite-then-restore-exact-bytes attack on the SAME
      // inode that a dev/ino-only comparison would miss entirely.
      assertDurableTargetMatches(fd, artifactPath, expectedBytes, receipt);
    } catch (err) {
      // assertDurableTargetMatches is shared with publishNoClobber's own
      // idempotent-path revalidation and throws its OWN generic vocabulary
      // (DURABILITY_UNPROVEN for a byte/size mismatch). This file's own
      // established convention for "a different, otherwise-valid record
      // occupies this path" is AUTHORITY_INVALID (matching every other
      // substitution/mismatch check in cmdCancel/cmdAcceptResult/cmdClaim
      // etc.) -- remap ONLY the byte-mismatch case; identity/mode/owner/nlink
      // failures are already correctly SECURITY_INVALID/DURABILITY_UNPROVEN
      // and propagate unchanged.
      if (err && err.byteMismatch) {
        throw new CliError('INVALID', 'AUTHORITY_INVALID', 'artifact at ' + artifactPath + ' is not byte-identical to what this invocation published');
      }
      throw err;
    }
  } finally {
    try { fs.closeSync(fd); } catch (e) { /* best-effort cleanup */ }
  }
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
  let tempIdentity;
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
    // Codex NO-GO round 17 (P1): capture OUR OWN temp's identity while its fd
    // is still open and trusted -- mirrors publishNoClobber's own tempIdentity
    // discipline (line ~941) exactly. renameSync preserves the inode (dev/ino
    // unchanged across a same-filesystem rename), so this lets the post-rename
    // revalidation below bind the renamed target back to THIS SPECIFIC inode,
    // never merely "some byte-matching regular file" -- without it, a swap of
    // targetPath for a byte-identical foreign file between rename and
    // revalidation would go completely undetected.
    tempIdentity = fs.fstatSync(tempFd, { bigint: true });
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
    if (isReplacePostRenameFaultActive('swap-same-bytes')) {
      // Test-only (Codex HARD NO-GO post round 17, repro for the tempIdentity
      // binding this same round added): simulate an attacker replacing the
      // just-renamed target with a FRESH file carrying byte-identical
      // content -- a different inode -- in the window between rename and
      // this revalidation opening it. Isolates that the tempIdentity dev/ino
      // binding (not merely a byte comparison) is what rejects the foreign
      // inode.
      try { fs.unlinkSync(targetPath); } catch (e) { /* best-effort test setup */ }
      fs.writeFileSync(targetPath, bytes, { mode: 0o600 });
    }
    if (isReplacePostRenameFaultActive('open')) throw new Error('injected post-rename open fault');
    const checkFd = fs.openSync(targetPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    let revalErr = null;
    let publishedSt = null;
    try {
      // Codex NO-GO round 17 (P1, two fixes): (1) bind back to the ORIGINAL
      // temp's own captured inode (tempIdentity) -- previously omitted here
      // entirely, unlike publishNoClobber's own equivalent call, so this
      // revalidation could only prove "some byte-matching regular file exists
      // at targetPath", never that it is the SPECIFIC inode renameSync just
      // created. (2) use the comparator's OWN return value for the receipt
      // instead of a separate, later fstat call on the same fd -- round 16's
      // own "captured immediately after" fix was still a distinct,
      // unvalidated re-read; see assertDurableTargetMatches's own comment.
      publishedSt = assertDurableTargetMatches(checkFd, targetPath, bytes, { dev: tempIdentity.dev, ino: tempIdentity.ino });
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
    return {
      path: targetPath, dev: publishedSt.dev, ino: publishedSt.ino,
      mode: publishedSt.mode, uid: publishedSt.uid, gid: publishedSt.gid,
      nlink: publishedSt.nlink, ctimeNs: publishedSt.ctimeNs, mtimeNs: publishedSt.mtimeNs,
      digest: sha256Buffer(bytes),
    }; // COMPLETE: rename credited durable + fully revalidated.
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
    // Codex NO-GO round 12: st1/st2 are already proven identical (the drift
    // check above) and are fd-bound (fstatSync on an open, O_NOFOLLOW fd --
    // never a path-based lstat a rename/replace could TOCTOU around). Surfaced
    // here, additively, so a caller needing genuine fd-bound identity (not
    // just content digest, which a byte-identical replacement would not
    // change) can compare dev/ino across two separate reads of the same path.
    //
    // Codex NO-GO round 13: dev/ino alone still misses an IN-PLACE rewrite
    // that restores the exact original bytes before a later check runs (same
    // inode throughout, so dev/ino never differ, yet the file was genuinely
    // mutated in between). The FULL snapshot this function already computes
    // and compares (st1 vs st2, the drift check just above) is surfaced here
    // too -- nlink/size/mode/uid/gid/ctimeNs/mtimeNs -- so a caller can freeze
    // and later re-compare the SAME complete snapshot this reader already
    // trusts, not a hand-picked subset of it.
    return {
      state: DURABLE_PRESENT, bytes: bytes, obj: obj,
      dev: st1.dev, ino: st1.ino, nlink: st1.nlink, size: st1.size,
      mode: st1.mode, uid: st1.uid, gid: st1.gid, ctimeNs: st1.ctimeNs, mtimeNs: st1.mtimeNs,
    };
  } finally {
    try { fs.closeSync(fd); } catch (e) { /* already closed */ }
  }
}

/** One-shot STOP for the nlink==2 in-flight window (a caller with no wait budget). */
function pendingDurableStop(artifactPath) {
  const e = new CliError('INVALID', 'DURABILITY_UNPROVEN', 'artifact in the nlink==2 in-flight window, not yet durable: ' + artifactPath);
  // Mirrors absentDurableStop's own durableAbsent flag below: a downstream
  // caller that polls (e.g. assessAwaitResultLiveness) needs to tell "still
  // being durably written this instant" apart from every OTHER
  // DURABILITY_UNPROVEN cause (identity drift, path rebound, ...), which must
  // stay a hard STOP, never a swallowed "keep waiting".
  e.durablePending = true;
  return e;
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
 *
 * Codex NO-GO round 12: calls classifyDurableRead directly (not through
 * readDurableBytes, which discards it) so dev/ino -- the fd-bound identity a
 * content digest alone cannot prove (a byte-identical replacement changes
 * neither content nor digest) -- reaches every caller of this function
 * additively, alongside the existing {bytes, obj, digest} shape.
 *
 * Codex NO-GO round 13: the FULL stat snapshot (nlink/size/mode/uid/gid/
 * ctimeNs/mtimeNs), not just dev/ino, is surfaced the same way -- dev/ino
 * alone misses an in-place rewrite that restores the original bytes before a
 * later comparison runs (same inode throughout; ctimeNs/mtimeNs would still
 * differ).
 */
function readDurableRecord(artifactPath, policy) {
  policy = policy || {};
  const r = classifyDurableRead(artifactPath, policy);
  if (r.state === DURABLE_ABSENT) throw absentDurableStop(artifactPath, policy);
  if (r.state === DURABLE_PENDING) throw pendingDurableStop(artifactPath);
  return {
    bytes: r.bytes, obj: parseJsonOrSchemaInvalid(r.bytes), digest: sha256Buffer(r.bytes),
    dev: r.dev, ino: r.ino, nlink: r.nlink, size: r.size, mode: r.mode, uid: r.uid, gid: r.gid, ctimeNs: r.ctimeNs, mtimeNs: r.mtimeNs,
  };
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

// ─────────────────────────────────────────────────────────────────────────────
// M7 §10.1: deterministic test-rendezvous seams (Fase 0 prerequisite -- these
// exact producers do not exist in the baseline; this is inert
// test-instrumentation plumbing only, never authority/schema behavior).
// Mirrors testRendezvous's own capability+name-gate/sleepSync-poll shape
// immediately above, but stricter per the contract: no-clobber (never a
// clobbering writeFileSync), explicit mode 0600, exact bytes (never a PID
// string), and a caller-supplied directory (never a fixed txnDir) that must
// realpath beneath the process's own tmpdir (the suite's private test root)
// and outside this repo's registry/coordination roots. Gated on BOTH this
// file's own RUNTIME_CONSULTATION_TEST_CAPABILITY (isTestCapability()) and
// the shared RUNTIME_M7_TEST_STAGE/RUNTIME_M7_TEST_RENDEZVOUS_DIR pair --
// production and tests without every gate perform ZERO filesystem I/O (no
// stat, no read) before returning. No sentinel is an authority artifact.
// ─────────────────────────────────────────────────────────────────────────────

const RUNTIME_M7_RENDEZVOUS_MAX_WAIT_MS = 5000;
const RUNTIME_M7_RENDEZVOUS_POLL_MS = 20;
const RUNTIME_M7_READY_BYTES = Buffer.from('ready\n', 'utf8');
const RUNTIME_M7_GO_BYTES = Buffer.from('go\n', 'utf8');
// registryBaseDir()'s own fixed literal parent (runtime-role-lifecycle.cjs:
// path.join(os.tmpdir(), 'android-common-doc-runtime', computePrincipalId())),
// reproduced here ONLY as this fixed prefix (never the principal-id suffix)
// so this file can prove "outside the runtime registry root" without a
// lazy-require of its sibling module for a pure test-instrumentation safety
// check -- mirrors scripts/tests/lib/private-registry-tmpdir-preload.cjs's
// own documented "prefix check" strategy for the identical purpose.
const M7_REGISTRY_BASE_DIR_LITERAL = 'android-common-doc-runtime';

/**
 * Realpath-validates `dirRaw` beneath the process's own tmpdir (the suite's
 * private test root) and outside this repo's registry/coordination roots --
 * returns the resolved real path, or null on ANY failure (never throws; the
 * caller must skip the rendezvous, never fail production behavior, per M7
 * §10.1's "fail closed / skip... do not throw into production behavior").
 * @param {string} dirRaw
 * @param {string} [coordRoot]
 * @returns {string|null}
 */
function resolveSafeM7RendezvousDir(dirRaw, coordRoot) {
  if (typeof dirRaw !== 'string' || dirRaw.length === 0 || !path.isAbsolute(dirRaw)) return null;
  let real;
  try {
    real = fs.realpathSync(dirRaw);
  } catch {
    return null;
  }
  let tmpReal;
  try {
    tmpReal = fs.realpathSync(os.tmpdir());
  } catch {
    return null;
  }
  if (real !== tmpReal && !real.startsWith(tmpReal + path.sep)) return null;
  const registryParent = path.join(tmpReal, M7_REGISTRY_BASE_DIR_LITERAL);
  if (real === registryParent || real.startsWith(registryParent + path.sep)) return null;
  if (typeof coordRoot === 'string' && coordRoot.length > 0) {
    let coordReal;
    try {
      coordReal = fs.realpathSync(coordRoot);
    } catch {
      coordReal = null;
    }
    if (coordReal !== null && (real === coordReal || real.startsWith(coordReal + path.sep))) return null;
  }
  return real;
}

/**
 * M7 §10.1 deterministic rendezvous producer. No-op (zero I/O) unless
 * NODE_ENV=test, a non-empty RUNTIME_CONSULTATION_TEST_CAPABILITY, AND both
 * RUNTIME_M7_TEST_STAGE===stage and a safely-scoped
 * RUNTIME_M7_TEST_RENDEZVOUS_DIR are present. When armed: no-clobber writes
 * regular mode-0600 "<stage>.ready" with exact bytes "ready\n", then polls
 * (bounded 5000ms) for regular mode-0600 "<stage>.go" with exact bytes "go\n"
 * before returning. Throws (never hangs) if the bound is exceeded once armed
 * -- a hung rendezvous must fail loud, never hang the test suite.
 * @param {string} stage
 * @param {string} [coordRoot]
 */
function testM7Rendezvous(stage, coordRoot) {
  if (!isTestCapability()) return;
  if (process.env.RUNTIME_M7_TEST_STAGE !== stage) return;
  const dirRaw = process.env.RUNTIME_M7_TEST_RENDEZVOUS_DIR;
  if (typeof dirRaw !== 'string' || dirRaw.length === 0) return;
  const safeDir = resolveSafeM7RendezvousDir(dirRaw, coordRoot);
  if (!safeDir) return;
  const readyPath = path.join(safeDir, stage + '.ready');
  const goPath = path.join(safeDir, stage + '.go');
  fs.writeFileSync(readyPath, RUNTIME_M7_READY_BYTES, { mode: 0o600, flag: 'wx' });
  try { fs.chmodSync(readyPath, 0o600); } catch { /* best-effort hardening, umask already yields 0600 */ }
  // M7 defect 12: a monotonic clock (never Date.now(), which a wall-clock
  // adjustment could move backward mid-poll) bounds the wait.
  const startNs = process.hrtime.bigint();
  while (true) {
    // M7 GREEN section 4.11 (R14, TOCTOU fix) / M7 CORRECTION round 1 (C10):
    // never validate one inode and read another path. lstat records
    // pre-open identity (dev/ino) and rejects an obvious symlink/wrong-mode
    // entry -- genuinely ENOENT is the ordinary "not written yet" case
    // (kept polling below); ANY OTHER existing-but-invalid case (symlink,
    // wrong mode, non-regular, or an identity drift between lstat and the
    // open) throws IMMEDIATELY with a message containing the stable literal
    // M7_RENDEZVOUS_INVALID_GO_SENTINEL, never silently retried as if it
    // simply were not ready yet and never falling through to the generic
    // timeout below. O_NOFOLLOW on the open itself is the REAL symlink
    // protection (throws ELOOP on a symlink planted between the lstat and
    // the open); fstat on the ALREADY-OPEN fd re-proves regular-file/
    // exact-0600 and (when the platform exposes numeric dev/ino) correlates
    // back to the pre-open identity, so a same-path swap to a different
    // inode is caught too; the bytes are then read from that SAME held fd,
    // never a fresh path lookup, and the fd is always closed.
    let preLstat;
    try {
      preLstat = fs.lstatSync(goPath);
    } catch (err) {
      if (!err || err.code !== 'ENOENT') {
        throw new Error('M7_RENDEZVOUS_INVALID_GO_SENTINEL: .go sentinel could not be stat-verified (' + ((err && err.code) || 'unknown') + ')');
      }
      preLstat = null;
    }
    if (preLstat !== null) {
      if (preLstat.isSymbolicLink() || !preLstat.isFile() || (preLstat.mode & 0o777) !== 0o600) {
        throw new Error('M7_RENDEZVOUS_INVALID_GO_SENTINEL: .go sentinel is not a genuine owner-only regular file');
      }
      let fd;
      try {
        fd = fs.openSync(goPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      } catch (err) {
        throw new Error('M7_RENDEZVOUS_INVALID_GO_SENTINEL: .go sentinel could not be opened (' + ((err && err.code) || 'unknown') + ')');
      }
      let goBytes;
      try {
        const st = fs.fstatSync(fd);
        const identityStable = typeof preLstat.dev !== 'number' || typeof preLstat.ino !== 'number'
          || (st.dev === preLstat.dev && st.ino === preLstat.ino);
        if (!st.isFile() || (st.mode & 0o777) !== 0o600 || !identityStable) {
          throw new Error('M7_RENDEZVOUS_INVALID_GO_SENTINEL: .go sentinel identity/shape changed between lstat and open');
        }
        goBytes = fs.readFileSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      if (goBytes.equals(RUNTIME_M7_GO_BYTES)) return;
    }
    const elapsedMs = Number(process.hrtime.bigint() - startNs) / 1e6;
    if (elapsedMs >= RUNTIME_M7_RENDEZVOUS_MAX_WAIT_MS) {
      throw new Error('M7 test rendezvous "' + stage + '" timed out waiting for the go sentinel');
    }
    sleepSync(RUNTIME_M7_RENDEZVOUS_POLL_MS);
  }
}

// An opaque, unforgeable transition-lock token. ONLY acquireLock mints one (a fresh
// object carrying this private brand + the bound txnDir); a forged plain object, or a
// token minted for a DIFFERENT txnDir, is rejected by isValidLockTokenFor.
// DUR-J item 2: a transition-lock token is an OPAQUE, frozen, empty object. ALL of its
// authority lives in this module-private WeakMap -- nothing is observable on the token, so
// it cannot be forged (a plain/cloned object is simply absent from the map), mutated
// (frozen, no metadata), or replayed after release (`active` flips false). The record binds
// the canonical txnDir/lockDir STRINGS plus BOTH the .lock directory's own dev/ino AND (Codex
// NO-GO round 11 P0(2)) txnDir's OWN dev/ino at acquisition -- a COHERENT before/after pair
// (round 12), not merely stamped once after the fact -- so a later use can prove the SAME
// directories still stand: a deleted+recreated .lock differs, and a renamed/rebound txnDir
// itself differs, both checked together by assertLockedScopeIdentity (round 12; supersedes
// the txnDir-only assertLockedTxnDirIdentity from round 11).
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
  // Codex NO-GO round 16 (P0): see assertLockedScopeIdentity's own matching
  // comment -- txnDir's own identity survives a whole-subtree move, so the
  // ancestor chain must be re-walked here too, not just once at acquisition.
  try {
    assertAncestorChainConfined(rec.coordRoot, rec.canonicalTxnDir);
  } catch (err) {
    return false;
  }
  let st;
  try {
    st = fs.lstatSync(rec.canonicalLockDir, { bigint: true });
  } catch (err) {
    return false; // the .lock we hold is gone -> the token no longer proves exclusion.
  }
  // Codex NO-GO round 14: mode/uid/gid checked too, for the SAME reason
  // assertLockedScopeIdentity checks them -- a permission/ownership change is
  // genuine tampering even when dev/ino never move.
  return st.isDirectory() && st.dev === rec.lockDev && st.ino === rec.lockIno
    && st.mode === rec.lockMode && st.uid === rec.lockUid && st.gid === rec.lockGid;
}

/**
 * Codex NO-GO round 12: assertLockedTxnDirIdentity (round 11) checked ONLY
 * txnDir itself -- if `.lock` is deleted and recreated (a fresh, different
 * inode) while txnDir itself is left UNCHANGED, that check alone would not
 * catch it: another process could legitimately `mkdir` a NEW `.lock` in the
 * gap and both processes would believe they hold the exclusive lock
 * simultaneously. `isValidLockTokenFor` already re-verifies `.lock`'s own
 * identity, but only at the ONE call site gating a mutable read
 * (`immutablePath:false`) -- not at the general read/publish points inside
 * `cmdCancel`/`cmdAcceptResult`. This merges both checks into the ONE thing
 * every read/write under a held lock must pass: txnDir AND `.lock` are BOTH
 * still the exact directories this token was minted for. Throws
 * SECURITY_INVALID (an identity change) or DURABILITY_UNPROVEN (vanished/
 * unstattable) -- never silently proceeds. Call immediately before reading
 * and immediately before AND after publishing under a held lock, never once
 * and reused.
 */
function assertLockedScopeIdentity(lockToken) {
  const rec = (lockToken && typeof lockToken === 'object') ? lockRegistry.get(lockToken) : undefined;
  if (!rec || rec.active !== true) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'assertLockedScopeIdentity called with a non-authentic or already-released transition-lock token');
  }
  // Codex NO-GO round 16 (P0, empirically reproduced): txnDir's own
  // dev/ino/mode/uid/gid below stay UNCHANGED if the ENTIRE subtree is moved
  // as a unit (rename preserves inode) and a symlink is planted at the
  // ORIGINAL ancestor location pointing to the new location -- every check
  // in this function would pass while the transaction has genuinely escaped
  // coordRoot. Re-walking the ancestor chain on EVERY call (not just once at
  // acquisition) is the only way to catch this for the full lifetime of the
  // lock, not only its first instant.
  assertAncestorChainConfined(rec.coordRoot, rec.canonicalTxnDir);
  let txnSt;
  try {
    txnSt = fs.lstatSync(rec.canonicalTxnDir, { bigint: true });
  } catch (err) {
    throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'transition lock parent directory vanished while the lock was held: ' + rec.canonicalTxnDir);
  }
  // Codex NO-GO round 13: mode/uid/gid checked too, alongside dev/ino --
  // an ownership or permission change (e.g. made world-writable, chowned to
  // a different user) is genuine tampering even when dev/ino never move.
  // nlink/size/ctimeNs/mtimeNs are deliberately NOT compared here: a
  // directory's own nlink/size/ctime legitimately change the moment a child
  // is created or removed (e.g. .lock itself, inside txnDir) -- unlike
  // assertRequestIdentityMatches's full-snapshot comparison for the regular
  // FILE request.json (which has no such expected-child-mutation exception),
  // comparing them here would misfire on this system's own normal operation.
  if (!txnSt.isDirectory() || txnSt.dev !== rec.txnDirDev || txnSt.ino !== rec.txnDirIno
      || txnSt.mode !== rec.txnDirMode || txnSt.uid !== rec.txnDirUid || txnSt.gid !== rec.txnDirGid) {
    throw new CliError('INVALID', 'SECURITY_INVALID', 'transition lock parent directory identity changed while the lock was held: ' + rec.canonicalTxnDir);
  }
  let lockSt;
  try {
    lockSt = fs.lstatSync(rec.canonicalLockDir, { bigint: true });
  } catch (err) {
    throw new CliError('INVALID', 'DURABILITY_UNPROVEN', '.lock directory vanished while the lock was held: ' + rec.canonicalLockDir);
  }
  if (!lockSt.isDirectory() || lockSt.dev !== rec.lockDev || lockSt.ino !== rec.lockIno
      || lockSt.mode !== rec.lockMode || lockSt.uid !== rec.lockUid || lockSt.gid !== rec.lockGid) {
    throw new CliError('INVALID', 'SECURITY_INVALID', '.lock directory identity changed while the lock was held (deleted/recreated, or its own ownership/permissions changed): ' + rec.canonicalLockDir);
  }
}

/**
 * Exclusive `mkdir` of `.lock/`; bounded wait; never age-reclaimed (an orphaned lock is
 * never unblocked by its age alone -- `LOCK-ORPHAN-01`). Times out with CliError(TIMEOUT)
 * rather than hanging or inferring staleness. DUR-J item 5: the lock is a DURABLE
 * in-progress signal -- ORDER is mkdir(.lock) -> fsync(txnDir); the parent barrier is
 * proven BEFORE a usable token is minted. If that barrier cannot be proven, the .lock is
 * LEFT in place as a durable/unproven orphan (a later actor times out + STOPs, never
 * silently reclaims it) and acquisition fails closed with DURABILITY_UNPROVEN.
 *
 * Codex NO-GO round 13: this function used to unconditionally
 * `fs.mkdirSync(canonicalTxnDir, {recursive:true})` FIRST, before even its own
 * baseline stat -- a mutating call that could create or traverse through a
 * WRONG path (e.g. through a since-tampered ancestor) before any identity
 * check ever ran, and the round-12 rendezvous fired only AFTER this mutation
 * had already happened, so it never actually exercised this window. Verified
 * this round, by tracing every one of this file's 7 withLock callers plus
 * request.json's own first publish (cmdPublishRequest, which creates txnDir
 * via its OWN publishNoClobber call -- never through withLock/acquireLock at
 * all): NO legitimate caller ever needs acquireLock to create txnDir --
 * every command operating under a lock does so on an ALREADY-EXISTING
 * transaction. The mkdir is removed entirely; the first operation is now a
 * pure, non-mutating stat that fails closed (never creates anything) if
 * txnDir does not already exist -- closing this class of gap systemically
 * for all 7 callers, not just the 2 with their own preflight.
 */
/**
 * Codex NO-GO round 15: acquireLock's own before/after coherence check only
 * ever proved txnDir's OWN identity was stable -- it never proved anything
 * about the ANCESTOR directories between `root` and `txnDir` (e.g. the
 * wave/plan-digest/transactions path segments). `path.resolve` is purely
 * lexical; a symlinked ancestor is silently followed by every fs call this
 * function and its caller make, never rejected. Mirrors cmdPublishBlob's own
 * established per-component symlink-rejecting walk (a proven pattern in this
 * file, not a new mechanism) -- unlike that walk's use for a staging root
 * (whose leaf entries may not exist yet), every one of acquireLock's 7
 * callers operates on an ALREADY-EXISTING transaction (created earlier by
 * cmdPublishRequest's own, separate publishNoClobber call), so requiring
 * every ancestor component to already exist is the correct precondition
 * here, not an over-strict borrowed assumption.
 */
function assertAncestorChainConfined(root, targetDir) {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(targetDir);
  const rel = path.relative(resolvedRoot, resolvedTarget);
  if (rel === '' || rel === '.' || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new CliError('INVALID', 'SECURITY_INVALID', 'transition lock directory is not lexically confined under its own coordination root: ' + resolvedTarget);
  }
  let lst;
  try {
    lst = fs.lstatSync(resolvedRoot);
  } catch (err) {
    throw new CliError('INVALID', 'SECURITY_INVALID', 'coordination root does not exist or could not be stat-verified: ' + resolvedRoot);
  }
  if (lst.isSymbolicLink()) {
    throw new CliError('INVALID', 'SECURITY_INVALID', 'coordination root is a symlink (rejected): ' + resolvedRoot);
  }
  let walked = resolvedRoot;
  for (const seg of rel.split(path.sep)) {
    walked = path.join(walked, seg);
    let segLst;
    try {
      segLst = fs.lstatSync(walked);
    } catch (err) {
      throw new CliError('INVALID', 'SECURITY_INVALID', 'transition lock ancestor path component does not exist or could not be stat-verified: ' + walked);
    }
    if (segLst.isSymbolicLink()) {
      throw new CliError('INVALID', 'SECURITY_INVALID', 'transition lock ancestor path component is a symlink (rejected): ' + walked);
    }
  }
}

function acquireLock(txnDir, coordRoot) {
  const canonicalTxnDir = path.resolve(txnDir);
  const canonicalCoordRoot = path.resolve(coordRoot);
  const lockDir = path.join(canonicalTxnDir, '.lock');
  // Codex NO-GO round 15: the ancestor walk brackets the SAME acquisition
  // window the existing txnDir-identity before/after check already does --
  // once before the mkdir(.lock) loop starts polling, once after acquiring --
  // so a symlink swapped into an ancestor DURING the wait is caught too, not
  // only one observed before the wait began.
  assertAncestorChainConfined(canonicalCoordRoot, canonicalTxnDir);
  // Codex NO-GO round 12: a COHERENT snapshot of txnDir itself, taken BEFORE
  // the mkdir(.lock) loop below starts polling (which can run for up to
  // LOCK_MAX_WAIT_MS). A stat taken only AFTER acquiring -- round 11's own
  // fix -- could already be observing a directory that was swapped WHILE
  // this loop was waiting, silently treating the wrong directory as the one
  // this acquisition genuinely began against. This is now the FIRST thing
  // acquireLock ever does -- no mutation precedes it.
  let txnStBefore;
  try {
    txnStBefore = fs.lstatSync(canonicalTxnDir, { bigint: true });
  } catch (err) {
    throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'transition lock parent directory does not exist or could not be stat-verified before acquisition (acquireLock never creates it): ' + canonicalTxnDir);
  }
  if (!txnStBefore.isDirectory()) {
    throw new CliError('INVALID', 'SECURITY_INVALID', 'transition lock parent path is not a directory: ' + canonicalTxnDir);
  }
  // Deterministic test seam for the before/after coherence check itself (a
  // fixed, generic name -- every acquireLock caller shares this one
  // acquisition-time race, not a per-command concern like the read/publish
  // seams elsewhere in this file). Now fires as the very first thing after
  // the very first (non-mutating) operation -- genuinely exercising the
  // full window this function's own docstring claims to protect.
  testRendezvous(canonicalTxnDir, 'acquire-lock-before-mkdir-loop');
  const start = Date.now();
  for (;;) {
    try {
      fs.mkdirSync(lockDir);
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      // Codex NO-GO round 19 (evidence gap): a test that only observes "the
      // contending process is alive and has produced no output yet" never
      // proves it genuinely reached THIS branch, as opposed to still being
      // somewhere earlier in its own preflight. Test-capability-gated,
      // fixed-name marker (never touches production behavior) so a bats test
      // can assert directly that this invocation observed a genuine EEXIST,
      // not merely infer it from timing.
      if (isTestCapability()) {
        try { fs.writeFileSync(path.join(canonicalTxnDir, '.lock-contention-observed'), String(process.pid)); } catch (e) { /* best-effort test evidence only */ }
      }
      if (Date.now() - start >= LOCK_MAX_WAIT_MS) {
        throw new CliError('TIMEOUT', 'DEADLINE_EXCEEDED', 'transition lock acquisition timed out: ' + lockDir);
      }
      sleepSync(LOCK_POLL_MS);
      continue;
    }
    // Codex NO-GO round 16 (P0): a path-based chmodSync(lockDir, ...) here is
    // its own TOCTOU -- between this mkdirSync succeeding and a chmod BY
    // PATH, .lock could be replaced by a symlink and the chmod would silently
    // affect whatever THAT resolves to, not the directory we just created;
    // only a later lstat would catch the substitution, by which point the
    // chmod already landed somewhere foreign. fd-bound open (O_NOFOLLOW,
    // rejecting a symlink at open) + fchmod + fstat via that SAME fd binds
    // every one of these operations to the EXACT inode mkdirSync just
    // created, with no path re-resolution in between -- mirroring this
    // file's own established discipline for every FILE writer (open once,
    // fchmod via the fd, never trust a by-path chmod).
    //
    // Codex NO-GO round 17 (P1): O_NOFOLLOW only rejects a SYMLINK substitute
    // -- it does nothing to stop a real directory or file planted at this
    // exact path in the narrow gap between mkdirSync returning and the open
    // call below; the open would simply succeed against that substitute, and
    // fchmod/fstat would act on it. lockStAfterMkdir is captured as the very
    // next statement after mkdirSync succeeds (the tightest binding
    // achievable -- no primitive here returns an fd directly from mkdir) and
    // is compared against the opened fd's own identity below, mirroring this
    // SAME function's own txnStBefore/txnStAfter coherence-check pattern:
    // shrink the window as far as possible, then PROVE across it rather than
    // trusting whatever the subsequent open happens to see.
    let lockStAfterMkdir;
    try {
      lockStAfterMkdir = fs.lstatSync(lockDir, { bigint: true });
    } catch (err) {
      throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'transition lock directory could not be stat-verified immediately after this invocation\'s own mkdirSync: ' + lockDir);
    }
    if (lockStAfterMkdir.isSymbolicLink()) {
      throw new CliError('INVALID', 'SECURITY_INVALID', 'transition lock directory is a symlink immediately after this invocation\'s own mkdirSync: ' + lockDir);
    }
    // Codex NO-GO round 17 (P1): deterministic test seam for the
    // lstat-to-open window, mirroring this file's other rendezvous points --
    // lets a bats test genuinely pause a real, in-flight acquisition right
    // after the genuine post-mkdir snapshot above and swap lockDir for a
    // non-symlink substitute directory before the open+comparison below ever
    // runs (placed AFTER lockStAfterMkdir, not before it, so the captured
    // baseline is the genuine mkdir'd directory, not whatever a test's own
    // tampering already put there).
    testRendezvous(canonicalTxnDir, 'acquire-lock-post-mkdir-pre-verify');
    let lockFd;
    try {
      lockFd = fs.openSync(lockDir, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    } catch (err) {
      if (err && err.code === 'ELOOP') {
        throw new CliError('INVALID', 'SECURITY_INVALID', 'transition lock directory is a symlink immediately after this invocation\'s own mkdirSync (rejected at open): ' + lockDir);
      }
      throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'transition lock directory could not be opened immediately after acquisition: ' + lockDir);
    }
    let st;
    try {
      const openedSt = fs.fstatSync(lockFd, { bigint: true });
      if (openedSt.dev !== lockStAfterMkdir.dev || openedSt.ino !== lockStAfterMkdir.ino) {
        throw new CliError('INVALID', 'SECURITY_INVALID', 'transition lock directory was substituted between this invocation\'s own mkdirSync and its immediately-following open (dev/ino mismatch): ' + lockDir);
      }
      fs.fchmodSync(lockFd, 0o700);
      st = fs.fstatSync(lockFd, { bigint: true });
    } finally {
      try { fs.closeSync(lockFd); } catch (e) { /* best-effort cleanup */ }
    }
    if (!st.isDirectory()) {
      throw new CliError('INVALID', 'SECURITY_INVALID', 'transition lock path is not a directory after acquisition: ' + lockDir);
    }
    if (process.platform !== 'win32' && (st.mode & 0o777n) !== 0o700n) {
      throw new CliError('INVALID', 'SECURITY_INVALID', 'transition lock directory is not owner-only 0700 immediately after this invocation\'s own fd-bound fchmod: ' + lockDir);
    }
    // mkdir succeeded -> prove the acquisition barrier (mkdir precedes fsync by construction).
    if (!fsyncDir(canonicalTxnDir, 'lock-acquire')) {
      throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'transition lock acquisition barrier could not be proven durable; .lock retained as a durable orphan: ' + lockDir + fsyncDirCauseSuffix());
    }
    let txnStAfter;
    try {
      txnStAfter = fs.lstatSync(canonicalTxnDir, { bigint: true });
    } catch (err) {
      throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'transition lock parent directory could not be stat-verified after acquisition: ' + canonicalTxnDir);
    }
    if (!txnStAfter.isDirectory()) {
      throw new CliError('INVALID', 'SECURITY_INVALID', 'transition lock parent path is not a directory after acquisition: ' + canonicalTxnDir);
    }
    // Codex NO-GO round 15: re-verify the ancestor chain too, not just
    // txnDir's own identity -- a symlink swapped into an ancestor DURING the
    // mkdir(.lock) polling wait would otherwise go undetected by the
    // before-only check above.
    assertAncestorChainConfined(canonicalCoordRoot, canonicalTxnDir);
    // Codex NO-GO round 12: the BEFORE/AFTER pair must be COHERENT -- if
    // txnDir was swapped WHILE this loop polled for .lock, the .lock we just
    // created lives inside a directory that is NOT the one this acquisition
    // began against; the token would be meaningless for the caller's actual
    // txnDir. `.lock` is deliberately LEFT in place here (this codebase's own
    // established convention -- see the fsyncDir-failure case just above --
    // is to never attempt automatic cleanup of a `.lock` that already exists
    // on disk; a human resolves the orphan).
    //
    // Codex NO-GO round 14: this comparison used to check dev/ino only, while
    // the token below stored txnStAfter's mode/uid/gid as the baseline
    // going forward -- a permission/ownership change DURING this exact
    // acquisition window (between txnStBefore and txnStAfter) would never be
    // caught here, and would be SILENTLY ADOPTED as the new baseline for
    // every later assertLockedScopeIdentity call, exactly the "adopt instead
    // of reject" mistake already corrected twice this session for
    // cmdCancel/cmdAcceptResult and cmdAwaitResult. Compares the SAME full
    // field set the token will go on to store, so nothing captured below was
    // ever adopted without first being checked against what came before it.
    if (txnStAfter.dev !== txnStBefore.dev || txnStAfter.ino !== txnStBefore.ino
        || txnStAfter.mode !== txnStBefore.mode || txnStAfter.uid !== txnStBefore.uid || txnStAfter.gid !== txnStBefore.gid) {
      throw new CliError('INVALID', 'SECURITY_INVALID', 'transition lock parent directory identity changed during acquisition (before/after snapshot mismatch): ' + canonicalTxnDir);
    }
    const token = Object.freeze({});
    // Codex NO-GO round 13: mode/uid/gid captured for BOTH directories too --
    // see assertLockedScopeIdentity's own doc comment for why nlink/size/
    // ctimeNs/mtimeNs are deliberately EXCLUDED for directories (unlike the
    // full snapshot request.json's own identity check uses): a directory's
    // nlink/size/ctime legitimately change the moment a child (e.g. .lock
    // itself, inside txnDir) is created or removed -- comparing them would
    // misfire on this function's own, expected behavior, not on tampering.
    lockRegistry.set(token, {
      canonicalTxnDir: canonicalTxnDir,
      canonicalLockDir: lockDir,
      // Codex NO-GO round 16 (P0, empirically reproduced): stored so
      // assertLockedScopeIdentity/isValidLockTokenFor/releaseLock can ALL
      // re-verify the ancestor chain for the ENTIRE lifetime of the lock, not
      // only once here at acquisition. txnDir's own dev/ino/mode/uid/gid stay
      // UNCHANGED under a `mv` of the whole subtree (rename preserves inode)
      // -- moving the tree outside coordRoot and planting a symlink at the
      // original ancestor location back to it passes every existing identity
      // check while genuinely escaping confinement; only re-walking the
      // ancestor chain itself, every time, catches this.
      coordRoot: canonicalCoordRoot,
      lockDev: st.dev, lockIno: st.ino, lockMode: st.mode, lockUid: st.uid, lockGid: st.gid, // BigInt/BigInt/BigInt/BigInt/BigInt
      txnDirDev: txnStAfter.dev, txnDirIno: txnStAfter.ino, txnDirMode: txnStAfter.mode, txnDirUid: txnStAfter.uid, txnDirGid: txnStAfter.gid,
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
  // Codex NO-GO round 16 (P0): see assertLockedScopeIdentity's own matching
  // comment -- a whole-subtree move preserves txnDir's own identity, so a
  // release must re-walk the ancestor chain too, BEFORE any disk mutation
  // (mirrors this function's own "authenticate before mutating" discipline).
  // A compromised ancestor here means whatever this invocation just did
  // happened against a transaction that has escaped coordRoot -- revoking
  // and refusing the release (never rmdir) is the only safe response, not
  // silently completing what LOOKS like ordinary cleanup.
  try {
    assertAncestorChainConfined(rec.coordRoot, rec.canonicalTxnDir);
  } catch (err) {
    rec.active = false;
    throw isPoisoned(err) ? err : markPoisoned(err);
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
  // Codex NO-GO round 14: mode/uid/gid checked too, consistent with
  // assertLockedScopeIdentity/isValidLockTokenFor -- one joint guarantee
  // across every place this file authenticates a lock token's own .lock.
  if (!st.isDirectory() || st.dev !== rec.lockDev || st.ino !== rec.lockIno
      || st.mode !== rec.lockMode || st.uid !== rec.lockUid || st.gid !== rec.lockGid) {
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
 *
 * Codex NO-GO round 14: assertLockedScopeIdentity used to be something ONLY
 * cmdCancel/cmdAcceptResult remembered to call manually -- `validateActiveLeaseV1`,
 * cmdLeaseHeartbeat/cmdClaim/cmdTakeover/cmdPublishResult (the other 5 of this
 * file's 7 withLock callers) had no equivalent protection at all. It is now
 * called HERE, by withLock itself, at every exit path -- systemic for all 7
 * callers without any of them needing to change. Callers may still call it
 * again at their own narrower points (immediately before/after a specific
 * publish) for a tighter window; this baseline means even a caller that does
 * nothing extra is no longer unprotected.
 */
function withLock(txnDir, coordRoot, fn) {
  const lockToken = acquireLock(txnDir, coordRoot);
  // Baseline check immediately after acquisition: if this somehow fails
  // (acquireLock's own coherence check just passed moments ago, so this is
  // near-redundant defense-in-depth, not the primary catch), fn never runs
  // and no release is ever attempted -- .lock is left behind exactly as any
  // other unresolved acquisition-time failure already is.
  assertLockedScopeIdentity(lockToken);
  // Deterministic test seam, generic to EVERY withLock caller (a fixed name,
  // like acquireLock's own 'acquire-lock-before-mkdir-loop' seam) -- proves
  // the systemic protection this round added applies uniformly, including to
  // the 5 callers (validateActiveLeaseV1, cmdLeaseHeartbeat, cmdClaim,
  // cmdTakeover, cmdPublishResult) that have no scope-identity call of their
  // own.
  testRendezvous(txnDir, 'with-lock-post-acquire-pre-fn');
  let result;
  try {
    result = fn(lockToken);
  } catch (err) {
    if (isPoisoned(err)) throw err; // POST_RENAME_UNPROVEN etc. -> retain .lock as a durable orphan.
    // Codex NO-GO round 14: check scope BEFORE attempting to release -- if fn
    // failed cleanly but the scope has since been compromised, releasing
    // could succeed against a DIFFERENT reality than the one just detected
    // (e.g. .lock itself still matches while txnDir does not). Never attempt
    // release in that case; poison and retain instead.
    try {
      assertLockedScopeIdentity(lockToken);
    } catch (scopeErr) {
      throw markPoisoned(scopeErr);
    }
    // Clean failure, scope still coherent: release the lock so the txn is not wedged.
    // If release ALSO fails, its DURABILITY_UNPROVEN is primary (a stuck/unproven lock
    // is the more urgent fact) and the original cause is preserved for diagnosis.
    try {
      releaseLock(lockToken);
    } catch (releaseErr) {
      releaseErr.cause = err;
      throw releaseErr;
    }
    throw err;
  }
  // Codex NO-GO round 14: same check before the SUCCESS-path release -- fn
  // completed without throwing, but if scope was compromised DURING its run,
  // nothing fn did can be trusted; poison rather than release into an
  // unproven state.
  try {
    assertLockedScopeIdentity(lockToken);
  } catch (scopeErr) {
    throw markPoisoned(scopeErr);
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

/**
 * The graph/role-policy/content_ref half of the full consult-v2 pipeline,
 * extracted (Codex NO-GO round 9) so a caller that needs the request's own
 * digest alongside its validated `obj` (`accreditCanonicalRequest` below) can
 * reuse this deep validation without a second fd-bound read of the same
 * file -- `validateConsultV2` itself is unchanged below, a thin wrapper
 * around one read plus this.
 */
function validateConsultV2Fields(obj, planRoot) {
  if (obj.content_ref) {
    resolveContentRefOrThrow(planRoot, obj.content_ref);
  }
  validateRequestGraph(obj, planRoot);
  if (obj.depth > obj.max_depth) {
    throw new CliError('INVALID', 'CORRELATION_INVALID', 'depth exceeds max_depth');
  }
  assertRolePolicy(obj.source_role, obj.target_role);
}

/** Full `validate --kind consult-v2` pipeline: shape -> durability -> graph -> role-policy -> content_ref. */
function validateConsultV2(artifactPath, coordRoot) {
  const expectedRequestId = path.basename(path.dirname(artifactPath));
  const obj = readCanonicalRequestRecord(artifactPath, expectedRequestId, {}).obj;
  // DUR-J item 4: durability + fd-bound identity are proven inside readCanonicalRequestRecord
  // above; the old path-based `assertDurable` after a by-path read was a TOCTOU and is gone.
  const planRoot = planRootFromArtifact(coordRoot, artifactPath);
  validateConsultV2Fields(obj, planRoot);
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
function validateActiveLeaseV1(artifactPath, coordRoot) {
  const txnDir = path.dirname(path.dirname(artifactPath));
  return withLock(txnDir, coordRoot, (lockToken) => {
    // Codex NO-GO round 15 ("el lector mutable de lease" / "los cinco callers
    // del lock"): withLock's own entry/exit checks bracket this ENTIRE
    // callback, which cannot catch an ABA -- txnDir swapped away, this read
    // happening against the substitute, txnDir swapped back before withLock's
    // own post-fn check runs. A fresh scope check immediately before the read
    // shrinks that window to the minimum (the same discipline every other
    // hardened caller in this file now applies at its own sensitive
    // operation, not just at withLock's own bracket).
    assertLockedScopeIdentity(lockToken);
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
  pattern_evidence_dependency: {
    check: (v) => v === null || isPatternEvidenceDependencyShape(v),
  },
  producer_worktree_id: { check: isNonEmptyString },
  producer_head: { check: isNonEmptyString },
  created_at: { check: isIsoTimestamp },
};

const PATTERN_EVIDENCE_DEPENDENCY_KEYS = Object.freeze([
  'evidence_digest', 'evidence_ref', 'gap_digest', 'internal_search_digest',
  'library_id', 'provider', 'query_digest', 'resolution_digest',
].sort());
const PATTERN_EVIDENCE_V1_FIELDS = {
  schema: { check: (v) => v === 'coordination/pattern-evidence/v1' },
  request_id: { check: isHexId },
  request_digest: { check: isHex64 },
  attempt_id: { check: isHexId },
  lease_epoch: { check: isNonNegativeInteger },
  turn_id: { check: isNonEmptyString },
  provider: { check: (v) => v === 'context7' },
  internal_search_digest: { check: isHex64 },
  gap_digest: { check: isHex64 },
  library_id: { check: isCanonicalContext7LibraryId },
  query_digest: { check: isHex64 },
  resolution_ref: { check: (v) => v === null || isContentRefHandle(v) },
  resolution_digest: { check: orNull(isHex64) },
  source_uri: { check: (v) => v === 'https://context7.com/api/v2/context' },
  content_ref: { check: isContentRefHandle },
  created_at: { check: isIsoTimestamp },
};

function isPatternEvidenceDependencyShape(value) {
  if (!hasExactKeys(value, PATTERN_EVIDENCE_DEPENDENCY_KEYS)) return false;
  return (
    isNonEmptyString(value.evidence_ref) && isHex64(value.evidence_digest)
    && value.provider === 'context7' && isHex64(value.internal_search_digest)
    && isHex64(value.gap_digest) && isCanonicalContext7LibraryId(value.library_id)
    && isHex64(value.query_digest) && (value.resolution_digest === null || isHex64(value.resolution_digest))
  );
}

function evidenceRelativeRefFor(requestId) {
  return path.posix.join('transactions', requestId, 'evidence', 'context7.json');
}

function readAndValidatePatternEvidenceRecord(resultObj, reqRec, txnDir, planRoot, classified) {
  const evidencePath = patternEvidencePathFor(txnDir);
  let evidenceRec;
  if (classified && classified.state === DURABLE_PRESENT) {
    assertClosedShape(classified.obj, PATTERN_EVIDENCE_V1_FIELDS);
    evidenceRec = {
      obj: classified.obj,
      bytes: classified.bytes,
      digest: sha256Buffer(classified.bytes),
      path: evidencePath,
    };
  } else {
    evidenceRec = readClosedRecord(evidencePath, PATTERN_EVIDENCE_V1_FIELDS, {
      absentDetail: 'CORRELATION_INVALID', absentMessage: 'pattern evidence does not resolve',
    });
  }
  const evidence = evidenceRec.obj;
  const auth = resolveAuthoritativeAttempt(reqRec.obj, txnDir);
  if (
    evidence.request_id !== resultObj.in_reply_to
    || evidence.request_digest !== reqRec.digest
    || evidence.attempt_id !== resultObj.attempt_id || evidence.attempt_id !== auth.attemptId
    || evidence.lease_epoch !== resultObj.lease_epoch || evidence.lease_epoch !== auth.leaseEpoch
  ) throw new CliError('INVALID', 'CORRELATION_INVALID', 'pattern evidence does not match the current transaction');
  if (isoToMs(evidence.created_at) >= isoToMs(reqRec.obj.expiry)) {
    throw new CliError('INVALID', 'CORRELATION_INVALID', 'pattern evidence was created at/after request expiry');
  }
  resolveContentRefOrThrow(planRoot, evidence.content_ref);
  if ((evidence.resolution_ref === null) !== (evidence.resolution_digest === null)) {
    throw new CliError('INVALID', 'SCHEMA_INVALID', 'pattern evidence resolution ref/digest nullability mismatch');
  }
  if (evidence.resolution_ref !== null) {
    if (evidence.resolution_ref.digest !== evidence.resolution_digest || evidence.resolution_ref.blob !== evidence.resolution_digest) {
      throw new CliError('INVALID', 'CORRELATION_INVALID', 'pattern evidence resolution digest does not match its blob handle');
    }
    resolveContentRefOrThrow(planRoot, evidence.resolution_ref);
  }
  return evidenceRec;
}

function validatePatternEvidenceForResult(dependency, resultObj, reqRec, txnDir, planRoot) {
  const evidencePath = patternEvidencePathFor(txnDir);
  if (dependency === null) {
    const classified = classifyDurableRead(evidencePath, { parse: true });
    if (classified.state === DURABLE_PENDING) {
      throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'pattern evidence is pending while result declares no dependency');
    }
    if (classified.state === DURABLE_PRESENT && resultObj.status !== 'BLOCKED') {
      throw new CliError('INVALID', 'CORRELATION_INVALID', 'result omits its existing pattern evidence dependency');
    }
    // Sixteenth explicitly makes the dependency nullable for every BLOCKED
    // result, including a CP that emits BLOCKED on its second, evidence-fed
    // turn.  The durable evidence is still fully reopened and correlated; it
    // simply is not represented as an answer dependency.
    if (classified.state === DURABLE_PRESENT) {
      return readAndValidatePatternEvidenceRecord(resultObj, reqRec, txnDir, planRoot, classified);
    }
    return null;
  }
  if (resultObj.status === 'BLOCKED' || resultObj.from_role !== 'context-provider') {
    throw new CliError('INVALID', 'CORRELATION_INVALID', 'pattern evidence dependency is forbidden for this result');
  }
  if (!isPatternEvidenceDependencyShape(dependency)) {
    throw new CliError('INVALID', 'SCHEMA_INVALID', 'pattern evidence dependency shape invalid');
  }
  const expectedRef = evidenceRelativeRefFor(resultObj.in_reply_to);
  if (dependency.evidence_ref !== expectedRef) {
    throw new CliError('INVALID', 'CORRELATION_INVALID', 'pattern evidence dependency ref is not canonical');
  }
  const evidenceRec = readAndValidatePatternEvidenceRecord(resultObj, reqRec, txnDir, planRoot);
  const evidence = evidenceRec.obj;
  if (
    evidenceRec.digest !== dependency.evidence_digest
    || evidence.provider !== dependency.provider
    || evidence.internal_search_digest !== dependency.internal_search_digest
    || evidence.gap_digest !== dependency.gap_digest
    || evidence.library_id !== dependency.library_id
    || evidence.query_digest !== dependency.query_digest
    || evidence.resolution_digest !== dependency.resolution_digest
  ) throw new CliError('INVALID', 'CORRELATION_INVALID', 'pattern evidence dependency does not match its evidence record/current transaction');
  return { obj: evidence, bytes: evidenceRec.bytes, digest: evidenceRec.digest, path: evidencePath };
}

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

  validatePatternEvidenceForResult(obj.pattern_evidence_dependency, obj, reqRec, txnDir, planRoot);
  const evidenceAuthority = resolveRootEvidenceAuthority(reqObj, reqRec.digest, coordRoot);
  const evidencePolicy = evidenceAuthority.policy;
  if (
    obj.status === 'ANSWERED' && obj.from_role === 'context-provider'
    && evidencePolicy === 'context7-required'
    && obj.pattern_evidence_dependency === null
  ) throw new CliError('INVALID', 'AUTHORITY_INVALID', 'context7-required root result has no pattern evidence dependency');
  if (
    obj.status === 'ANSWERED' && obj.from_role === 'context-provider'
    && (evidencePolicy === 'context7-required' || evidencePolicy === 'context7-preferred') && evidenceAuthority.libraryId !== null
    && obj.pattern_evidence_dependency !== null
    && obj.pattern_evidence_dependency.library_id !== evidenceAuthority.libraryId
  ) throw new CliError('INVALID', 'AUTHORITY_INVALID', 'context-provider pattern evidence library_id does not match the approved directive');

  // M6/M7 terminal functional closure, point F: every reopen of a
  // result/v2 re-validates its consultation_dependencies through the same
  // canonical validator publish-time used -- never a lighter shape-only
  // re-check.
  validateConsultationDependencySet(obj.consultation_dependencies, reqObj, planRoot, coordRoot, evidenceAuthority);

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

/**
 * HARD NO-GO (round 18, REVERSED round 19): a narrower, request-digest-only
 * correlator briefly lived here (assertAcceptedResultTiedToTransaction),
 * reasoning that assertAcceptedResultCorrelates's stricter
 * accepted_attempt_id/accepted_lease_epoch check was "the wrong fit" because
 * a legitimate accepted-result for a NOW-SUPERSEDED attempt could still make
 * the transaction terminal (PLAN.md ~L704's "terminal records are never
 * deleted" framing). That premise does not survive PLAN's own transition
 * table: `ACCEPTED` (~L698) has no outgoing transition -- takeover is only
 * ever legal from `PUBLISHED`/`CLAIMED` (~L696/~L700) -- and cmdAcceptResult
 * itself only ever durably constructs accepted-result.json after validating
 * the candidate against the CURRENT authoritative attempt/epoch under the
 * SAME lock a takeover uses. No PLAN-legal history ever produces a durable
 * accepted-result.json whose accepted_attempt_id later diverges from a
 * fresh resolveAuthoritativeAttempt() re-resolution -- there is no
 * legitimate cross-attempt case to protect. The round-18 test that motivated
 * the narrower check (a hand-planted accepted-result for a fabricated
 * `other_aid`, with no takeover.json ever making it authoritative) is not an
 * instance of that hypothetical case -- it is indistinguishable from a
 * forged artifact, and the narrower check let it (and any forgery copying
 * only the public, non-secret request_digest while fabricating attempt_id/
 * candidate_result_path/result_digest/routing_policy_digest) through as
 * ordinary "already accepted" rather than a rejected correlation.
 * cmdCancel/cmdAcceptResult/cmdPublishResult now call the SAME
 * assertAcceptedResultCorrelates every other authoritative surface
 * (cmdAwaitResult, cmdTransactionAck -- AUTH-06/07) already uses: one
 * authority contract, not two.
 */

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

const CONSULTATION_DEPENDENCY_KEYS = Object.freeze(
  ['accepted_result_digest', 'from_role', 'request_id', 'result_digest'].sort(),
);

/**
 * M6/M7 terminal functional closure, point F: the ONE canonical
 * consultation_dependencies validator, reused both immediately before a
 * terminal result publishes (hostBridgePublishTerminalResult) and every time
 * validateResultV2 reopens an already-published result. Structural/shape
 * checks (<=2 entries, exact key set) always run first; each entry is then
 * fully reopened -- child request, its accepted-result (which itself
 * re-derives and cross-checks the authoritative candidate result via
 * assertAcceptedResultCorrelates), and its ack -- never trusted from the
 * caller-supplied digests alone. Fails closed (throws) on any mismatch,
 * missing/foreign artifact, wrong from_role, duplicate dependency, or a
 * disposition other than 'accepted'.
 *
 * `evidenceAuthority` (optional; the same { policy, libraryId } resolveRootEvidenceAuthority
 * returns), when supplied and `policy === 'context7-required'` and
 * `reqObj.target_role !== 'context-provider'` (i.e. reqObj is the reporting
 * architect's own result, not the context-provider child's), additionally
 * enforces the architect-side half of point F: exactly one dependency,
 * sourced from context-provider, whose child question is byte-identical to
 * the parent's own required question (preserving any embedded
 * APPROVED_CONTEXT7_LIBRARY_ID line end to end).
 */
function validateConsultationDependencySet(dependencies, reqObj, planRoot, coordRoot, evidenceAuthority) {
  if (!Array.isArray(dependencies) || dependencies.length > 2) {
    throw new CliError('INVALID', 'SCHEMA_INVALID', 'consultation dependency set is invalid');
  }
  const seenRequestIds = new Set();
  const childReqObjs = [];
  for (const dep of dependencies) {
    if (
      !dep || typeof dep !== 'object' || Array.isArray(dep) || !hasExactKeys(dep, CONSULTATION_DEPENDENCY_KEYS)
      || !isHexId(dep.request_id) || !isHex64(dep.accepted_result_digest) || !isHex64(dep.result_digest)
      || !isNonEmptyString(dep.from_role)
    ) throw new CliError('INVALID', 'SCHEMA_INVALID', 'consultation dependency shape invalid');
    if (seenRequestIds.has(dep.request_id)) {
      throw new CliError('INVALID', 'CORRELATION_INVALID', 'consultation dependency request_id is duplicated');
    }
    seenRequestIds.add(dep.request_id);

    const childRequestPath = requestPathFor(planRoot, dep.request_id);
    const childReqRec = readCanonicalRequestRecord(childRequestPath, dep.request_id, {
      absentDetail: 'CORRELATION_INVALID', absentMessage: 'consultation dependency child request does not resolve',
    });
    const childReqObj = childReqRec.obj;
    if (
      childReqObj.parent_request_id !== reqObj.request_id || childReqObj.root_request_id !== reqObj.root_request_id
      || childReqObj.depth !== reqObj.depth + 1 || childReqObj.source_role !== reqObj.target_role
      || childReqObj.target_role !== dep.from_role
      || childReqObj.plan_digest !== reqObj.plan_digest || childReqObj.subject_scope_digest !== reqObj.subject_scope_digest
      || childReqObj.subject_repo_id !== reqObj.subject_repo_id || childReqObj.subject_worktree_id !== reqObj.subject_worktree_id
      || childReqObj.subject_head !== reqObj.subject_head
      || childReqObj.routing_policy_version !== reqObj.routing_policy_version
      || childReqObj.routing_policy_digest !== reqObj.routing_policy_digest
    ) throw new CliError('INVALID', 'CORRELATION_INVALID', 'consultation dependency child request does not correlate to its parent');
    childReqObjs.push(childReqObj);

    const childTxnDir = path.dirname(childRequestPath);
    const childAcceptedPath = acceptedResultPathFor(childTxnDir);
    const childAcceptedRec = readClosedRecord(childAcceptedPath, ACCEPTED_RESULT_V1_FIELDS, {
      absentDetail: 'CORRELATION_INVALID', absentMessage: 'consultation dependency accepted-result does not resolve',
    });
    assertAcceptedResultCorrelates(childAcceptedRec.obj, childTxnDir, childReqObj, coordRoot);
    if (
      childAcceptedRec.digest !== dep.accepted_result_digest
      || childAcceptedRec.obj.result_digest !== dep.result_digest
    ) throw new CliError('INVALID', 'CORRELATION_INVALID', 'consultation dependency accepted-result does not match its declared digests');

    const childAckPath = ackPathFor(childTxnDir);
    const childAckRec = readClosedRecord(childAckPath, ACK_V1_FIELDS, {
      absentDetail: 'CORRELATION_INVALID', absentMessage: 'consultation dependency ack does not resolve',
    });
    if (
      childAckRec.obj.disposition !== 'accepted'
      || childAckRec.obj.in_reply_to_attempt_id !== childAcceptedRec.obj.accepted_attempt_id
    ) throw new CliError('INVALID', 'CORRELATION_INVALID', 'consultation dependency ack is not an accepted disposition for the current attempt');
  }
  if (
    evidenceAuthority && (evidenceAuthority.policy === 'context7-required' || evidenceAuthority.policy === 'context7-preferred')
    && reqObj.target_role !== 'context-provider'
  ) {
    if (dependencies.length !== 1 || dependencies[0].from_role !== 'context-provider') {
      throw new CliError('INVALID', 'AUTHORITY_INVALID', 'context7-required architect result must have exactly one context-provider consultation dependency');
    }
    if (childReqObjs[0].question !== reqObj.question) {
      throw new CliError('INVALID', 'AUTHORITY_INVALID', 'context7-required child question does not preserve the required question');
    }
  }
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

/**
 * FULL canonical accreditation for an ALREADY durably-read, shape-valid
 * cancel/v1 object. Codex NO-GO round 8 -- supersedes round 6's version,
 * which itself was accepted as still partial: it confirmed *lexical*
 * confinement + minimum depth (>=3 segments) and correlated only against
 * `basename(dirname(cancelPath))`, never the FULL, EXACT canonical geometry
 * `<repo_id>/<wave_slug>/<plan_digest>/transactions/<request_id>/cancel.json`
 * cross-checked against the containing request's OWN embedded identity --
 * a self-consistent request.json+cancel.json pair planted under an
 * arbitrary `<coordRoot>/junk/<id>/` passed. It also used
 * `readCanonicalRequestRecord` (shape+ID only) for the containing request,
 * not the FULL `validateConsultV2` graph/role-policy/content_ref pipeline,
 * and accepted the bare `reason==='expired'` value alone as proof of
 * `cancelled_by:'timeout-authority'` authority -- the reason a caller/writer
 * declares is not itself evidence anything actually expired.
 *
 * This version, in order:
 *  1. Exact canonical filename (`cancel.json`).
 *  2. Ancestor-symlink-safe confinement (`assertGenuinelyConfinedUnderRoot`,
 *     itself upgraded this round to realpath-resolve every existing
 *     ancestor, not merely lexical `path.relative`).
 *  3. EXACT canonical namespace geometry: the cancel.json's realpath-resolved
 *     location relative to `coordRoot` must be precisely 5 segments,
 *     `<repo_id>/<wave_slug>/<plan_digest>/transactions/<request_id>`, with
 *     the literal `transactions` segment in position 3 -- not merely "deep
 *     enough."
 *  4. The CONTAINING request.json genuinely exists and passes the FULL
 *     `validate --kind consult-v2` pipeline (shape, durability, identity,
 *     root/parent/depth graph, role-policy, content_ref) -- not the lighter
 *     shape+ID-only check every OPERATIONAL request read
 *     (`readRequestForTxnOrCorrelationInvalid`) uses for claim/lease/
 *     takeover/record-delivery/worker-stop/await-result, which stays
 *     unchanged and out of this pass's scope.
 *  5. The namespace segments recovered in step 3 (repo_id/wave_slug/
 *     plan_digest/request_id) match the CONTAINING REQUEST's own embedded
 *     `repo_id`/`wave_slug`/`plan_digest`/`request_id` fields exactly --
 *     closes the "self-consistent pair under an arbitrary junk/<id>/
 *     directory" gap: the directory name alone is never sufficient, it must
 *     equal what the request itself actually claims.
 *  6. cancel.json's own `request_id` matches that confirmed request.
 *  7. `cancelled_by` authority: `'timeout-authority'` is accepted ONLY when
 *     `reason==='expired'` AND the record's own `cancelled_at` is at or
 *     after the request's own `expiry` (data-embedded proof the deadline had
 *     genuinely passed at the moment of cancellation -- not a live wall-
 *     clock re-check at READ time, which would let a too-early cancel
 *     become falsely acceptable merely because enough real time has since
 *     elapsed); otherwise the ACTUAL requester's own `requester_instance_id`
 *     from the confirmed containing request.
 * Shared by every cancel.json reader via the three `readCanonicalCancelRecord*`
 * wrappers below (the ONLY sanctioned way to read a cancel.json in this file --
 * see their own doc comment and the CANCEL-AUDIT-01 source-audit test).
 */
/**
 * EXACT canonical namespace geometry for a transaction directory: ancestor-
 * symlink-safe (realpath, not lexical), and precisely 5 segments
 * `<repo_id>/<wave_slug>/<plan_digest>/transactions/<request_id>` below
 * `coordRoot` -- never a bare "deep enough" minimum-depth check. Shared by
 * `accreditCanonicalRequest` below and (transitively, through it)
 * `accreditCancelRecord` -- ONE geometry computation, not one per artifact
 * type, since request.json and cancel.json always share this same directory.
 */
function assertExactCanonicalGeometry(coordRoot, txnDir) {
  let realCoordRoot;
  try {
    realCoordRoot = fs.realpathSync(coordRoot);
  } catch (err) {
    throw new CliError('INVALID', 'SECURITY_INVALID', 'coordination_root does not resolve: ' + coordRoot);
  }
  // A genuinely never-published transaction (a caller-supplied --request that
  // does not resolve at all) must still surface as CORRELATION_INVALID once
  // this geometry check passes and the actual request read is attempted --
  // never SECURITY_INVALID merely because txnDir itself does not YET exist.
  // realpathDeepestExisting resolves symlinks in whatever ancestor chain
  // ACTUALLY exists (proving no ancestor escape) and lexically appends the
  // (necessarily non-existent, hence un-symlinked) tail, exactly mirroring
  // assertGenuinelyConfinedUnderRoot's own graceful-absence handling.
  const { real: realExistingAncestor, tail } = realpathDeepestExisting(txnDir);
  const realTxnDir = tail.length ? path.join(realExistingAncestor, ...tail) : realExistingAncestor;
  const rel = path.relative(realCoordRoot, realTxnDir);
  const segments = rel.split(path.sep).filter(Boolean);
  if (rel === '' || rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel) || segments.length !== 5 || segments[3] !== 'transactions') {
    throw new CliError('INVALID', 'SECURITY_INVALID', 'artifact is not stored at its exact canonical namespace path once symlinks are resolved: ' + txnDir);
  }
  return { repoId: segments[0], waveSlug: segments[1], planDigest: segments[2], requestId: segments[4] };
}

/**
 * THE canonical accreditor for a request.json -- used directly by
 * `cmdCancel`/`cmdAcceptResult`/`cmdAwaitResult` for their own `--request`,
 * and reused by `accreditCancelRecord` below for its containing-request
 * check. Codex NO-GO round 9: those three commands each only checked
 * filename + confinement + MINIMUM depth (`planRootFromArtifact`) + shape+ID
 * (`readRequestForTxnOrCorrelationInvalid`) for their OWN `--request` --
 * never the EXACT geometry or FULL `validateConsultV2` pipeline
 * `accreditCancelRecord` already required for an EXISTING cancel.json. This
 * let `cmdCancel` durably WRITE a cancel.json next to a request.json that
 * this exact function (reached the moment ANY reader, including
 * `accreditCancelRecord` itself, later looks at that cancel.json) would
 * immediately reject -- a write reporting SUCCESS whose own artifact no
 * reader ever accepts. NOTE: `claim`/`lease-heartbeat`/`takeover`/
 * `record-delivery`/`worker-stop` still use the lighter
 * `readRequestForTxnOrCorrelationInvalid` for their own `--request`; whether
 * they share this same asymmetry is out of this pass's named scope
 * (cancel/accept-result/await-result only) and is flagged, not fixed, here.
 */
function accreditCanonicalRequest(coordRoot, requestPath) {
  assertCanonicalFilename(requestPath, 'request.json');
  assertGenuinelyConfinedUnderRoot(coordRoot, requestPath);
  const txnDir = path.dirname(requestPath);
  const geo = assertExactCanonicalGeometry(coordRoot, txnDir);
  // ONE fd-bound read (DUR-J item 6): readCanonicalRequestRecord already
  // proves durability + shape + content/location-identity (request_id ==
  // geo.requestId) and returns {obj, digest} in a single pass -- callers that
  // need the digest (cmdAcceptResult) get it without a second, TOCTOU-risking
  // read of the same file. validateConsultV2Fields reuses the SAME deep
  // graph/role-policy/content_ref validation validateConsultV2's own
  // standalone `validate --kind consult-v2` entry point uses.
  const rec = readCanonicalRequestRecord(requestPath, geo.requestId, {
    absentDetail: 'CORRELATION_INVALID',
    absentMessage: 'referenced request.json does not resolve',
  });
  const reqObj = rec.obj;
  if (reqObj.repo_id !== geo.repoId || reqObj.wave_slug !== geo.waveSlug || reqObj.plan_digest !== geo.planDigest) {
    throw new CliError('INVALID', 'SECURITY_INVALID', "request.json canonical path segments do not match its own embedded identity: " + requestPath);
  }
  const planRoot = planRootFromArtifact(coordRoot, requestPath);
  validateConsultV2Fields(reqObj, planRoot);
  // Codex NO-GO round 12/13: the full fd-bound stat snapshot (from the same
  // read as digest -- see readDurableRecord's own doc comment) surfaced
  // additively so a caller needing to prove request.json was never replaced
  // OR in-place-rewritten-and-restored (either of which digest alone can
  // miss) can compare the SAME complete snapshot across two separate calls.
  return {
    obj: reqObj, digest: rec.digest,
    dev: rec.dev, ino: rec.ino, nlink: rec.nlink, size: rec.size, mode: rec.mode, uid: rec.uid, gid: rec.gid, ctimeNs: rec.ctimeNs, mtimeNs: rec.mtimeNs,
  };
}

/**
 * Codex NO-GO round 12: request.json is published exactly once and never
 * rewritten (PLAN.md ~L813, "immutable"). cmdCancel/cmdAcceptResult's own
 * round-11 fix re-accredited fresh INSIDE the lock but then TRUSTED whatever
 * that fresh read found -- silently ADOPTING a mid-wait mutation instead of
 * detecting and rejecting it, exactly the bug round 11 itself corrected for
 * cmdAwaitResult but never applied symmetrically here. ANY divergence between
 * a preflight accreditation and a later one is evidence of an illegal
 * mutation, never a legitimate update to adopt.
 *
 * Codex NO-GO round 13: comparing only digest+dev+ino still misses an
 * IN-PLACE rewrite that restores the exact original bytes before this check
 * runs -- same inode throughout (dev/ino never differ), same final content
 * (digest never differs), yet the file was genuinely mutated in between.
 * Compares the FULL fd-bound snapshot classifyDurableRead itself already
 * trusts (dev/ino/nlink/size/mode/uid/gid/ctimeNs/mtimeNs) plus digest -- any
 * genuine mutation, even one whose final state is byte-identical, changes at
 * least ctimeNs (and typically mtimeNs), so this is not a hand-picked subset
 * that could miss the same class of gap a second time.
 */
function assertRequestIdentityMatches(preflightRec, laterRec, requestPath) {
  if (laterRec.digest !== preflightRec.digest
      || laterRec.dev !== preflightRec.dev || laterRec.ino !== preflightRec.ino
      || laterRec.nlink !== preflightRec.nlink || laterRec.size !== preflightRec.size
      || laterRec.mode !== preflightRec.mode || laterRec.uid !== preflightRec.uid || laterRec.gid !== preflightRec.gid
      || laterRec.ctimeNs !== preflightRec.ctimeNs || laterRec.mtimeNs !== preflightRec.mtimeNs) {
    throw new CliError('INVALID', 'SECURITY_INVALID', 'request.json changed since preflight -- request.json is immutable per PLAN.md ~L813: ' + requestPath);
  }
}

function accreditCancelRecord(cancelObj, cancelPath, coordRoot) {
  assertCanonicalFilename(cancelPath, 'cancel.json');
  assertGenuinelyConfinedUnderRoot(coordRoot, cancelPath);
  const txnDir = path.dirname(cancelPath);
  // Geometry of txnDir is fully proven inside accreditCanonicalRequest below
  // (request.json lives in this exact same directory) -- recomputing it here
  // too would be redundant, not stricter.
  const reqObj = accreditCanonicalRequest(coordRoot, path.join(txnDir, 'request.json')).obj;

  if (cancelObj.request_id !== reqObj.request_id) {
    throw new CliError('INVALID', 'SECURITY_INVALID', 'cancel.json content does not match its own canonical identity: ' + cancelPath);
  }

  // Codex NO-GO round 9 (PENDING_WP4): this cancelled_by check is
  // CORRELATION -- the recorded identity matches a value already present in
  // the request/schema -- never CRYPTOGRAPHIC or GRANT-BASED AUTHORITY. PLAN.md's
  // `role-command-grant/v1` (~L580-592) is the actual authority mechanism
  // ("the matching core atomically wins <grant_id>.used... revalidates
  // schema/surface/binding/authority/profile/subcommand/PLAN/worktree/role/
  // action... before any read or mutation") and is NOT implemented anywhere
  // in this file -- PENDING_WP4, a future work package, not built here or
  // claimed to be. This check only rejects an OBVIOUSLY wrong value (an
  // arbitrary caller-invented string, or an unconnected fresh genId()) from
  // passing as "the requester" or "timeout-authority" -- a floor, not the
  // ceiling PLAN ultimately requires.
  if (cancelObj.reason === 'expired') {
    if (isoToMs(cancelObj.cancelled_at) < isoToMs(reqObj.expiry)) {
      throw new CliError('INVALID', 'AUTHORITY_INVALID', "cancel.json claims reason='expired' but its own cancelled_at precedes the request's own expiry: " + cancelPath);
    }
    // Codex NO-GO round 9: `cancelled_at >= expiry` ALONE lets a planted
    // artifact claim an arbitrary FAR-FUTURE `cancelled_at` (e.g. year 2099)
    // to "prove" expiry against ANY request, expired or not. `cancelled_at`
    // must ALSO not implausibly exceed the current moment (respecting the
    // `--fixed-clock` test seam via `currentClockMs()`) -- bounding it to the
    // genuinely-elapsed window `[expiry, now]`, never an unconstrained future
    // value. `nowIso()`'s own millisecond truncation only ever makes a
    // genuine writer's stamped value earlier, never later, than real "now" --
    // this bound cannot spuriously reject an honest writer.
    if (isoToMs(cancelObj.cancelled_at) > currentClockMs()) {
      throw new CliError('INVALID', 'AUTHORITY_INVALID', "cancel.json claims reason='expired' with a cancelled_at implausibly in the future: " + cancelPath);
    }
    if (cancelObj.cancelled_by !== 'timeout-authority') {
      throw new CliError('INVALID', 'SECURITY_INVALID', 'cancel.json cancelled_by does not match the expected identity for its own reason: ' + cancelPath);
    }
  } else if (cancelObj.cancelled_by !== reqObj.requester_instance_id) {
    throw new CliError('INVALID', 'SECURITY_INVALID', 'cancel.json cancelled_by does not match the expected identity for its own reason: ' + cancelPath);
  }
  return reqObj;
}

/**
 * The THREE sanctioned entry points for reading a cancel.json in this file
 * (Codex NO-GO round 8's "single choke point + source-audit" requirement).
 * Each performs the durable read AND the full accreditation above as one
 * inseparable step -- no caller can obtain a shape-checked-but-unaccredited
 * object. CANCEL-AUDIT-01 (runtime-consultation-cli.bats) mechanically greps
 * this file and asserts `CANCEL_V1_FIELDS` appears in exactly the field-table
 * definition plus these three functions -- never inline at a command body.
 */
function readCanonicalCancelRecordOptional(cancelPath, coordRoot) {
  const obj = readJsonDurableOptional(cancelPath, { shape: (o) => assertClosedShape(o, CANCEL_V1_FIELDS) });
  if (obj === null) return null;
  const reqObj = accreditCancelRecord(obj, cancelPath, coordRoot);
  return { obj: obj, reqObj: reqObj };
}

// M6+M7 SIXTEENTH CODEX ACCEPTANCE Correction C: returns {obj, bytes, digest,
// reqObj} from the ONE fd-bound read, not just {obj, reqObj} --
// readRootSourceTerminalArtifacts previously needed a SECOND, separate
// readDurableRecord(cancelPath) call purely to obtain a digest this same
// read already computed, a real (if narrow, cancel.json being no-clobber-
// immutable) TOCTOU window. Inlines readJsonDurable's own absent/pending
// handling (rather than calling it) specifically so `r.bytes` -- which
// readJsonDurable's own return contract discards, keeping only `.obj` --
// stays reachable from this ONE classifyDurableRead call; this also keeps
// CANCEL-AUDIT-01's own sanctioned shape-check call intact, textually
// unchanged, still one of its exactly-three counted occurrences (a
// LITERAL-quoted restatement of that exact call right here in this comment
// would itself be a fourth occurrence and self-sabotage that audit -- see
// this same file's own CANCEL_V1_FIELDS export comment for the identical
// lesson already learned once this session). Existing callers
// (validateCancelV1) only ever destructure `.obj`, so the additive fields
// are invisible to them.
function readCanonicalCancelRecordRequired(cancelPath, coordRoot) {
  const r = classifyDurableRead(cancelPath, { parse: true, shape: (o) => assertClosedShape(o, CANCEL_V1_FIELDS) });
  if (r.state === DURABLE_ABSENT) throw absentDurableStop(cancelPath, {});
  if (r.state === DURABLE_PENDING) throw pendingDurableStop(cancelPath);
  const reqObj = accreditCancelRecord(r.obj, cancelPath, coordRoot);
  return { obj: r.obj, bytes: r.bytes, digest: sha256Buffer(r.bytes), reqObj: reqObj };
}

// M7 GREEN correction round 2, R3: also returns {bytes, digest} from the
// SAME ONE fd-bound read when present -- mirrors readCanonicalCancelRecordRequired's
// own {obj, bytes, digest, reqObj} extension (M6+M7 SIXTEENTH CODEX
// ACCEPTANCE Correction C, see that function's own doc comment) so a
// caller needing a cancel digest (readRootSourceTerminalArtifacts) can use
// THIS single-read classifier instead of first calling this function for
// shape-free presence and then separately calling
// readCanonicalCancelRecordRequired to reopen the same file purely to get
// its digest. Purely additive: the one pre-existing caller (cmdCancel's own
// pre-write pass) only ever destructures `.state`.
function classifyCanonicalCancelRecord(cancelPath, coordRoot) {
  const r = classifyDurableRead(cancelPath, { parse: true, shape: (o) => assertClosedShape(o, CANCEL_V1_FIELDS) });
  if (r.state !== DURABLE_PRESENT) return r;
  const reqObj = accreditCancelRecord(r.obj, cancelPath, coordRoot);
  return { state: r.state, obj: r.obj, bytes: r.bytes, digest: sha256Buffer(r.bytes), reqObj: reqObj };
}

function validateCancelV1(artifactPath, coordRoot) {
  return readCanonicalCancelRecordRequired(artifactPath, coordRoot).obj;
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

// R33-STAGE1-AUDIT-SCOPE:BEGIN
// Everything between this marker and its matching closing marker below is the
// R33 stage-1 surface. `validate` is a NO-MUTATION command (PLAN.md ~L785), and
// PLAN.md ~L2913 forbids overwrite, conversion, adoption, unlink, fallback and
// retry outright while ~L2927-2928 makes a fresh R33 root the only rollout path
// ("No existe in-place upgrade, downgrade o rollback"). Those are ABSENCE
// properties: no test can prove them for a code path nobody thought to
// exercise. `runtime-consultation-cli.test.js` therefore EXTRACTS exactly this
// region by these two markers and asserts that no filesystem-mutating primitive
// occurs INSIDE it. Asserting absence within an extracted scope is the point --
// a hand-listed substring search over the whole file would be silently defeated
// by any later edit outside the markers. Do not move, rename or duplicate these
// marker strings, and do not introduce a write/rename/unlink/link/mkdir/lock
// primitive between them. The audit MUST also assert that each marker occurs
// EXACTLY ONCE in the file: a duplicated marker collapses the extracted region
// and would make the whole audit vacuously pass. (That is not hypothetical --
// the first draft of this very comment spelled the closing marker's literal
// token, which reduced the extracted scope to two lines and passed.)
// ─────────────────────────────────────────────────────────────────────────────
// NON-AUTHORITATIVE R33 STATIC CONFORMANCE. Read this before anything below.
//
// Every function in this section is a CONFORMANCE CHECK. Together they can prove
// closed schema, canonical byte encoding, confined paths, tuple correlation and
// the A.5 digests -- and NOTHING ELSE. None of them establishes authority,
// accreditation, liveness or the right to act, and none may be renamed, wrapped
// or reported as though it did.
//
// What is deliberately NOT here, and why it cannot be:
//  - the AUTHORITY tier. R3.3:2848-2851 makes receipt-level disagreement
//    AUTHORITY_INVALID, and the final `BootstrapReceipt` is published under the
//    runtime-owner root `R`.
//    CORRECTION, recorded because an earlier revision of this banner asserted
//    the opposite and it was propagated downstream: `R` IS derivable, and from
//    `C` alone. R3.3:209-215 constructs it explicitly --
//      runtime_slot_id = LOWERCASE_HEX(FIRST_16_BYTES(SHA256(
//        UTF8("runtime/owner-root-slot/v1") || 0x00 || LP(UTF8(C)) )))
//      runtime_owner_basename = ".acd-prm-r33-" || runtime_slot_id
//      R = P || native_separator || runtime_owner_basename
//    -- where the slot id is a hash OF `C` and `P` is C's parent. The earlier
//    claim reasoned about `runtime_owner_root_id`, which is an IDENTITY digest
//    (a verification mechanism for a path you already hold, R3.3:3733), and
//    mistook the absence of an inversion for the absence of any construction.
//    So locating `R` is NOT what blocks the authority tier here. What blocks it
//    is the liveness reason immediately below, which is sufficient on its own.
//  - temporal LIVENESS. R3.3:1460-1464 defines
//    `valid(envelope,now,clock-capability)` as requiring
//    `clock-capability.state == ACTIVE` and `issued <= now < expiry`. The
//    capability is `RuntimeClockDomainCapabilityLiveV1` (R3.3:1469-1470), and
//    `LiveV*` schemas are provider-owned, live-only and NON-SERIALIZABLE with no
//    disk projection (R3.3:2379-2383); and `now` would have to be in the
//    record's own monotonic domain, which R3.3:1465 forbids converting into.
// Both therefore belong to the provider-owned IN-PROCESS composition
// (PLAN.md ~L762: retained hosts "call the core in-process with
// `HostBridgeCapability/v1`, never through a CLI suffix"), where a real
// monotonic clock and a real retained receipt exist. Neither can be reconstructed
// from disk records by a standalone reader, and NOTHING here may substitute a
// path, boolean, digest or caller-supplied object for opaque live authority.
//
// Consequence, stated so it cannot be mistaken for an oversight: a caller that
// runs any function in this section to completion has learned that some bytes
// conform to a closed schema. It has NOT learned that a root, a session or a
// profile is legitimate. Static conformance is a precondition for accreditation,
// never a substitute for it.
//
// Bootstrap states this section must not collapse (R3.3:1115-1117 and step 17):
// step 12 is root-profile conformance/readback ONLY; step 17 is provider-session
// conformance/readback ONLY; step 18 -- `BootstrapReceipt` plus live capabilities
// transitioning the session to ACTIVE -- is the FIRST authority-success point and
// is not implemented here.
// ─────────────────────────────────────────────────────────────────────────────
// R33 static conformance surface -- PLAN §4.1 mandatory stage 1 of 6
// (PLAN.md ~L2935). The closed schemas for the three-record tuple
// `RuntimeProfileBindingV2 + RootProfileV3 + ProviderSessionV3`.
//
// SCOPE HONESTY (binding, do not weaken): this section delivers the closed
// schemas that tuple accreditation will CONSUME. It does NOT implement PLAN
// §3.1's tuple-first selection rule (PLAN.md ~L2676-2679: "El validator se
// selecciona primero por el tuple acreditado ... Schema string, path, record
// digest o profile literal aislado nunca seleccionan root/profile"). A
// `validate --kind X --artifact Y` surface selects by an argv-ASSERTED kind,
// one record at a time, and structurally cannot accredit a THREE-record tuple
// from a SINGLE `--artifact`. What the tuple check in this section establishes
// is that the three records CONFORM to their closed schemas and CORRELATE with
// each other -- a precondition for accreditation, never accreditation itself.
// Tuple-first selection needs the accredited tuple PLAN §3.1 names, which
// requires the receipt chain and live capabilities this section cannot reach;
// it belongs to the provider-owned composition. Nothing in this section may be
// reported as "R33 root/profile/session accreditation: DONE".
//
// "dispatch dinámico a validator R32" (PLAN.md ~L2673, prohibited) holds here
// BY CONSTRUCTION rather than by a guard: there is no RootProfileV2 /
// ProviderSessionV2 validator anywhere in this file to dispatch TO. An R32
// artifact simply fails the `schema`/`protocol_profile` literals below and is
// SCHEMA_INVALID, and an occupied-but-wrong-profile path can never degrade to
// ABSENT because absence is ENOENT-at-open only (classifyDurableRead) -- which
// is exactly PLAN.md ~L2911's "una path ocupada por bytes del otro profile es
// PRESENT_INVALID, nunca ABSENT". Do NOT add an R32 validator here: that would
// create the very dispatch surface the rule forbids.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * P33 (PLAN.md ~L2647). Its sibling P32
 * (`runtime-consultation/r32-csl-posix-local-v1`, ~L2646) is deliberately NOT
 * defined as a constant here: it is not a value this file ever writes or
 * accepts, only one the equality checks below must reject like any other wrong
 * literal.
 */
const R33_PROTOCOL_PROFILE = 'runtime-consultation/r33-csl-posix-local-v1';

// Literals shared by 2+ of the three tuple records -- ONE source each, never
// independently-typed copies (the DRIVER_ENUM precedent above). Single-use
// literals/enums stay inline in their own field table.
const R33_CONTROL_PROTOCOL = 'transition-lock/provider-control/v3';
const R33_HANDLE_PROTOCOL = 'transition-lock/provider-handle/v2';
const R33_PROVIDER_ABI = 3;
const TRANSITION_LOCK_PROVIDER_NAME = 'acd-transition-lock-posix';
const PROVIDER_MANAGER_KIND_ENUM = [
  'retained-native-host-owner', 'runtime-session-supervisor', 'registered-consumer-owner',
];
const PROVIDER_MANAGER_LIFETIME_PROFILE_ENUM = [
  'retained-session', 'persistent-consumer', 'transaction-retained-consumer',
];
const COORDINATION_MODE_ENUM = ['auto', 'persistent', 'ephemeral', 'disk-only'];

/**
 * Canonical basenames of the ONLY two R33 contract records that live in the
 * coordination root `C` (ARCHITECTURE-PROPOSAL-C-S-L-R3.3.md:1019-1022:
 * "`C/root-profile.json` contiene exactamente RootProfileV3 y
 * `C/.provider-session` exactamente ProviderSessionV3 ... Son records distintos
 * y no se reemplazan"), plus their shared 4,096-byte cap from that same
 * passage ("conservan cap 4,096").
 *
 * 4,096 is NOT the 16,384 "root/binding/endpoint/clock receipt" row of the caps
 * table at :1049 -- that table governs objects under the runtime-owner root `R`
 * (see its own preamble at :1042-1045), not these two `C` records. It is also
 * not DEFAULT_MAX_DURABLE_ARTIFACT_BYTES (1 MiB), which is this file's generic
 * coordination-record bound.
 */
const ROOT_PROFILE_V3_BASENAME = 'root-profile.json';
const PROVIDER_SESSION_V3_BASENAME = '.provider-session';
const C_RECORD_MAX_BYTES = 4096;

// RuntimeProfileBindingV2 gets NO R33 contractual byte cap, deliberately. It has
// no defined disk path or transport anywhere in the PLAN or R3.3, and it is
// barred from `C` (:1037-1039), so R33 specifies no cap for it at all. An
// earlier revision borrowed the 16,384-byte "root/binding/endpoint/clock
// receipt" row from the caps table at :1049; that attribution is WITHDRAWN --
// that row governs the durable `RuntimeOwnerCoordinationBindingReceiptV1`, a
// different record, and borrowing it is exactly the reasoning PLAN.md:1395
// forbids ("no implementation may derive an unlisted rule by similarity,
// naming, schema adjacency, or profile analogy"). This kind therefore relies
// only on this file's EXISTING generic bound
// (DEFAULT_MAX_DURABLE_ARTIFACT_BYTES), which is operational parser/DoS
// protection for any coordination record -- NOT an R33 cap for this one.

// ── R33 scalar primitives (ARCHITECTURE-PROPOSAL-C-S-L-R3.2.md:150-152) ──────

/**
 * `Id128 = exactamente 32 ASCII lowercase hex` (R3.2:150). Reuses HEX128_RE,
 * already this file's `stop_id` predicate. Deliberately NOT `isHexId`, whose
 * HEX_ID_RE is `{32,128}` and would accept a 64-char Sha256 where an Id128 is
 * required -- `Id128` and `HexId` are genuinely different types in the closed
 * schemas below (e.g. `root_generation_id:Id128` vs `root_bootstrap_id:HexId`)
 * and must not be collapsed.
 */
function isId128(v) { return typeof v === 'string' && HEX128_RE.test(v); }

/**
 * `Pid` is CITED at `ARCHITECTURE-PROPOSAL-C-S-L-R3.1.md:146`:
 * `| Pid | integer 1..2147483647 |`. A JSON NUMBER (unlike MonoNs, which is a
 * decimal string). PROVENANCE CHAIN: R3.3:2375 -> R3.2:150 -> R3.1:146.
 *
 * BOTH BOUNDS ARE ENFORCED. An earlier revision enforced only `>= 1`, so
 * `owner_pid: 2147483648` and `owner_pid: 9007199254740991` both passed -- both
 * reproduced before the fix. The omission came from an earlier comment asserting
 * "no ceiling is specified anywhere in R3.2/R3.3, so none is invented here",
 * which was wrong for the same reason as the `IsoUtc` and `DecimalU64`
 * annotations above: the delegation chain was followed only as far as R3.2, one
 * hop short of the scalar table that had the answer all along.
 *
 * `Number.isInteger` rather than `isSafeInteger`: the 2^31-1 ceiling is far below
 * the safe-integer limit, so the safe-integer test would be redundant -- any
 * value it would reject is already rejected by the ceiling.
 */
function isPid(v) { return Number.isInteger(v) && v >= 1 && v <= 2147483647; }

/**
 * `IsoUtc` is CITED, not derived: `ARCHITECTURE-PROPOSAL-C-S-L-R3.1.md:143` reads
 * `| IsoUtc | UTC YYYY-MM-DDTHH:MM:SSZ, fecha válida y round-trip idéntico |` --
 * i.e. exactly the three properties enforced below.
 *
 * PROVENANCE CHAIN, recorded because both a prior revision of this comment and a
 * prior ruling stopped one hop short of it: R3.3:2375 says primitives "conservan
 * R3.2"; R3.2:150 delegates onward to R3.1 by name; R3.1:143-146 is where the
 * scalar table actually lives. An earlier revision called this grammar a
 * "DERIVED, fail-closed reading" and admitted an optional `.mmm` fraction. Both
 * were wrong -- the grammar was cited all along, and it forbids fractions.
 * Do not "re-derive" this rule; it has a citation.
 *
 * Two checks are needed, and NEITHER is sufficient alone:
 *  1. the regex fixes the exact encoding -- integral seconds only, literal `Z`,
 *     no fraction, no offset, no date-only form, no surrounding whitespace;
 *  2. the byte-identical round-trip rejects IMPOSSIBLE dates that the regex
 *     cannot see and that `Date.parse` alone does NOT reject. Measured: for the
 *     ISO string form, `Date.parse('2025-02-30T00:00:00Z')` returns
 *     1740873600000 -- a NUMBER, not NaN -- because JS silently rolls the
 *     overflowing day forward. A `!Number.isNaN(...)` guard therefore ACCEPTS
 *     `2025-02-30`, `2025-04-31`, non-leap `2025-02-29`, and `T24:00:00`
 *     (normalized to the next midnight). Re-serializing and comparing back to
 *     the input catches every one of them, because the normalized form differs
 *     from what was written. The real leap day `2024-02-29T00:00:00Z` round-
 *     trips unchanged and is correctly accepted.
 *
 * Deliberately NOT `isIsoTimestamp` (which accepts anything `new Date()` can
 * parse, including `'Jan 1, 2025'` and offset forms). The 8 existing
 * `created_at: { check: isIsoTimestamp }` fields keep their looser predicate
 * untouched -- that looseness is a pre-existing property of shipped kinds, out
 * of this stage's scope. The blast radius is small by design: both new
 * wall-clock fields are named `*_diagnostic_utc`, because R33 moved authority
 * to the monotonic envelope and left wall clocks diagnostic-only.
 */
const ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
function isIsoUtc(v) {
  if (typeof v !== 'string') return false;
  if (!ISO_UTC_RE.test(v)) return false;
  const ms = Date.parse(v);
  if (Number.isNaN(ms)) return false;
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z') === v;
}

/**
 * `MonoNs = alias exacto de DecimalU64 (canonical decimal string)`
 * (ARCHITECTURE-PROPOSAL-C-S-L-R3.3.md:1441) -- a JSON **string**, never a JSON
 * number. The signed `-9223372036854775808..9223372036854775807` range on the
 * adjacent :1443-1444 belongs to `UnixNs`, a DIFFERENT type; attributing it to
 * MonoNs (as an earlier reading of this stage's contract did) would make these
 * three fields numbers and silently lose precision above 2^53.
 *
 * Grammar is the canonical-decimal one R3.2:151-152 establishes for the sibling
 * scalars (`DecimalU32`, `DecimalI64`: "decimal canónico ... sin '+', leading
 * zero ni '-0'"), i.e. digits only, no sign, no leading zeros, no whitespace --
 * required by R3.3:1466 ("overflow/underflow/noncanonical decimal → INVALID
 * before allocation/write"), a rule that only makes sense for a string
 * representation.
 *
 * `DecimalU64` is CITED at `ARCHITECTURE-PROPOSAL-C-S-L-R3.1.md:145`:
 * `| DecimalU64 | string decimal canónico 0..18446744073709551615 |`. So the
 * bound below is the cited range, and "string decimal canónico" is the cited
 * grammar -- neither is an inference from the `U64` type name.
 *
 * PROVENANCE CHAIN (R3.3:2375 -> R3.2:150 -> R3.1:145). An earlier revision of
 * this comment claimed the bound was undefined anywhere and therefore DERIVED;
 * that was wrong for the same reason the `IsoUtc` annotation above was wrong --
 * the delegation chain was followed only as far as R3.2.
 */
const CANONICAL_DECIMAL_U64_RE = /^(0|[1-9][0-9]*)$/;
const MAX_DECIMAL_U64 = 18446744073709551615n;
function isMonoNs(v) {
  return typeof v === 'string' && CANONICAL_DECIMAL_U64_RE.test(v) && BigInt(v) <= MAX_DECIMAL_U64;
}

/**
 * A field whose value is a single FIXED LITERAL. The literal is DECLARED as
 * data, so exactly one declaration drives BOTH the shape predicate and the
 * correlation-set derivation below -- they cannot drift apart.
 *
 * This exists because the 17-key R33 tuple correlation set is defined by
 * SUBTRACTING the keys that are a fixed literal in BOTH records (contract §8b:
 * such a key agrees by construction, and any deviation is already SCHEMA_INVALID
 * at shape time, so a correlation guard over it could never fire). A `check`
 * closure is opaque -- nothing can ask it "are you an equality test against a
 * literal?" -- so without this the subtraction would need a hand-maintained
 * second list of literal key names, which is precisely the hand-transcription
 * §8b says not to trust.
 *
 * Behaviourally inert: `check` is exactly the `(v) => v === value` it replaces.
 * `assertClosedShape` reads only `def.required` and `def.check` and never
 * enumerates a definition's own keys, so the extra `literal` property is
 * invisible to validation. Applied ONLY to the three R33 tuple tables -- the
 * other field tables in this file are deliberately left untouched.
 */
function lit(value) {
  return { literal: value, check: (v) => v === value };
}

/** True iff `table`'s field `key` was declared via `lit()`, i.e. is a single fixed literal. */
function isLiteralField(table, key) {
  return Object.prototype.hasOwnProperty.call(table, key)
    && Object.prototype.hasOwnProperty.call(table[key], 'literal');
}

// ── A.1 `RuntimeProfileBindingV2` [6] (R3.3:2388-2395) ──────────────────────

/**
 * Six FIXED LITERALS, no free-form field at all: five exact strings plus the
 * integer `3`. Any other value is SCHEMA_INVALID.
 *
 * CONFORMANCE CHECK, NOT AN IDENTITY BINDING. Because all six values are fixed
 * literals, this record carries NO `coordination_root_id`, no
 * `root_generation_id`, and no digest of anything -- there is no field by which
 * a binding is tied to a PARTICULAR root or session (contract §8c confirms the
 * only keys it shares with RootProfileV3 are those same fixed literals). So ANY
 * conforming binding satisfies the tuple: the record is effectively a constant,
 * and producing it evidences nothing beyond the caller being able to reproduce a
 * constant. The R33 tuple's actual force therefore comes from the two `C`
 * records plus their 17-key and digest correlation, NOT from this leg. A later
 * stage must NOT claim this record contributes identity or actor authority.
 * This is a property of the contract's own design at this stage, not a gap in
 * the validator.
 *
 * NAMED LIMITATION (flagged, deliberately not fixed here): `subject_manifest`
 * is the frozen literal `coordination/subject-bundle-manifest/v2` (R3.3:2394),
 * but the only manifest implemented in this file is
 * `coordination/subject-bundle-manifest/v1` (SUBJECT_BUNDLE_MANIFEST_V1_FIELDS
 * below). A conformant R33 binding therefore asserts a manifest version
 * `publish-blob`/`publish-request` cannot currently produce. That is a real
 * cross-contract divergence belonging to a later stage; the literal is NOT
 * weakened to v1 to make the two line up.
 */
const RUNTIME_PROFILE_BINDING_V2_FIELDS = {
  schema: lit('runtime/csl-profile-binding/v2'),
  protocol_profile: lit(R33_PROTOCOL_PROFILE),
  control_protocol: lit(R33_CONTROL_PROTOCOL),
  provider_abi: lit(R33_PROVIDER_ABI),
  handle_protocol: lit(R33_HANDLE_PROTOCOL),
  subject_manifest: lit('coordination/subject-bundle-manifest/v2'),
};

// ── A.3 `RootProfileV3` [28] (R3.3:3651 REPLACE over R3.2:2087-2098) ────────

/**
 * `REPLACE(RootProfileV2[24], "coordination/root-profile/v3", REMOVE(5),
 * ADD(9))` = 28 keys, matching the row's own authoritative `Keys` column.
 * REMOVE = schema, protocol_profile, control_protocol, provider_abi,
 * created_at. Retained keys keep exactly the type/nullability of their R3.2
 * base (R3.3:3638), so the two groups below are listed in their SOURCES' own
 * orders -- the 9 ADD keys in R3.3:3651's order, then the 19 retained keys in
 * RootProfileV2's order at R3.2:2087-2098 -- to stay diffable against both
 * citations in one pass.
 *
 * Note `provider_abi` is REMOVEd and re-ADDed with the new literal `3` (was `2`
 * in V2), `control_protocol` moves /v2 -> /v3, and `protocol_profile` moves
 * P32 -> P33; but `lock_profile` is RETAINED UNCHANGED at
 * `transition-lock/file-posix/v2` and must not be "fixed" to v3.
 */
const ROOT_PROFILE_V3_FIELDS = {
  schema: lit('coordination/root-profile/v3'),
  protocol_profile: lit(R33_PROTOCOL_PROFILE),
  control_protocol: lit(R33_CONTROL_PROTOCOL),
  provider_abi: lit(R33_PROVIDER_ABI),
  handle_protocol: lit(R33_HANDLE_PROTOCOL),
  runtime_owner_root_id: { check: isHex64 },
  clock_domain_id: { check: isId128 },
  clock_domain_receipt_digest: { check: isHex64 },
  created_at_diagnostic_utc: { check: isIsoUtc },
  lock_profile: lit('transition-lock/file-posix/v2'),
  coordination_root_id: { check: isHex64 },
  physical_root_id: { check: isHex64 },
  coordination_root_identity_security_digest: { check: isHex64 },
  canonical_root_path_digest: { check: isHex64 },
  mount_projection_digest: { check: isHex64 },
  root_generation_id: { check: isId128 },
  root_bootstrap_id: { check: isHexId },
  provider_session_id: { check: isId128 },
  local_filesystem_profile: lit('local-posix/v2'),
  local_filesystem_capability_digest: { check: isHex64 },
  mount_generation_digest: { check: isHex64 },
  provider_name: lit(TRANSITION_LOCK_PROVIDER_NAME),
  provider_build_digest: { check: isHex64 },
  platform: { check: isEnum(['linux', 'darwin']) },
  architecture: { check: isEnum(['x64', 'arm64']) },
  provider_manager_kind: { check: isEnum(PROVIDER_MANAGER_KIND_ENUM) },
  provider_manager_lifetime_profile: { check: isEnum(PROVIDER_MANAGER_LIFETIME_PROFILE_ENUM) },
  coordination_mode: { check: isEnum(COORDINATION_MODE_ENUM) },
};

// ── A.2 `TemporalAuthorityEnvelopeV1` [4] (R3.3:1446-1451) ──────────────────

const TEMPORAL_AUTHORITY_ENVELOPE_V1_FIELDS = {
  clock_domain_id: { check: isId128 },
  issued_monotonic_ns: { check: isMonoNs },
  not_before_monotonic_ns: { check: isMonoNs },
  expiry_monotonic_ns: { check: isMonoNs },
};

/**
 * NOTE ON THE NAME: the word "Authority" here is the R3.3 RECORD's own name
 * (`TemporalAuthorityEnvelopeV1`, R3.3:1446), NOT a claim that this function
 * establishes authority. It proves the envelope's static shape and ordering
 * invariants only. Liveness -- `clock-capability.state == ACTIVE` and
 * `issued <= now < expiry` (R3.3:1460-1464) -- is NOT checked here and cannot be,
 * for the reasons in the section banner. The name is kept deliberately so the
 * mapping to the R3.3 schema stays greppable; renaming it would obscure the
 * citation.
 *
 * The nested envelope's own closed shape PLUS its ordering invariants
 * (R3.3:1456-1458): `issued <= not_before < expiry` and `not_before == issued`
 * ("R3.3 no delayed activation"). Applied at the whole-object level rather than
 * as a per-field predicate, mirroring `assertResultContentXor`/
 * `assertStopCorrelationTriple` -- cross-field rules get their own precise
 * SCHEMA_INVALID messages instead of a generic "invalid field: temporal".
 *
 * NO COERCION, mechanically: every operand is BigInt-parsed from a value
 * `isMonoNs` has ALREADY proven to be a canonical unsigned decimal string
 * within range, so `BigInt()` is an exact, total parse of a validated string --
 * not a coercion of arbitrary input. There is no `Number()`, `parseInt`, unary
 * `+`, `==`, or relational comparison on mixed/unvalidated types anywhere here.
 * Both alternatives are actively wrong and were checked empirically:
 *   - `Number` collapses `9007199254740993` onto 2^53, so an envelope whose
 *     `not_before` genuinely DIFFERS from `issued` (delayed activation, which
 *     R3.3 forbids) compares EQUAL and would be ACCEPTED;
 *   - string relational comparison misorders different-length decimals
 *     (`'9' < '10'` is false).
 * `lifetime = expiry - issued` (:1459, "checked integer arithmetic") needs no
 * separate guard: BigInt subtraction cannot overflow, and each operand is
 * already range-bounded. No lifetime ceiling is invented -- `DurationNs`
 * (0..86400000000000, :1442) is a different type this envelope does not use.
 */
function assertTemporalAuthorityEnvelopeV1(envelope) {
  assertClosedShape(envelope, TEMPORAL_AUTHORITY_ENVELOPE_V1_FIELDS);
  const issued = BigInt(envelope.issued_monotonic_ns);
  const notBefore = BigInt(envelope.not_before_monotonic_ns);
  const expiry = BigInt(envelope.expiry_monotonic_ns);
  // Implied by the equality immediately below, but asserted separately and
  // first (R3.3 states both) so a future relaxation of the equality can never
  // silently drop the ordering rule with it.
  if (!(issued <= notBefore)) {
    throw new CliError('INVALID', 'SCHEMA_INVALID', 'temporal issued_monotonic_ns must be <= not_before_monotonic_ns');
  }
  if (notBefore !== issued) {
    throw new CliError('INVALID', 'SCHEMA_INVALID', 'temporal not_before_monotonic_ns must equal issued_monotonic_ns (R3.3 forbids delayed activation)');
  }
  if (!(notBefore < expiry)) {
    throw new CliError('INVALID', 'SCHEMA_INVALID', 'temporal expiry_monotonic_ns must be strictly greater than not_before_monotonic_ns');
  }
}

// ── A.3 `ProviderSessionV3` [28] (R3.3:3652 REPLACE over R3.2:2100-2110) ────

/**
 * `REPLACE(ProviderSessionV2[24], "coordination/provider-session/v3",
 * REMOVE(5), ADD(9))` = 28 keys. REMOVE = schema, provider_abi,
 * control_protocol, started_at, session_expiry. Same two-group ordering
 * convention as ROOT_PROFILE_V3_FIELDS above (ADD in R3.3:3652's order, then
 * retained in R3.2:2100-2110's order).
 *
 * CRITICAL ASYMMETRY -- do NOT "fix" this: `ProviderSessionV3` has NO
 * `protocol_profile` key and no `handle_protocol` key. That is INHERITED, not
 * an R33 invention -- `ProviderSessionV2` [24] (R3.2:2100-2110) never had
 * either. The session binds to the profile TRANSITIVELY, via
 * `root_profile_digest` and `runtime_binding_receipt_digest`. Adding
 * `protocol_profile` here is SCHEMA_INVALID via the closed key set, and a test
 * asserting `ProviderSessionV3.protocol_profile === P33` is asserting against a
 * key that must never exist.
 */
const PROVIDER_SESSION_V3_FIELDS = {
  schema: lit('coordination/provider-session/v3'),
  provider_abi: lit(R33_PROVIDER_ABI),
  control_protocol: lit(R33_CONTROL_PROTOCOL),
  runtime_owner_root_id: { check: isHex64 },
  runtime_binding_receipt_digest: { check: isHex64 },
  clock_domain_id: { check: isId128 },
  clock_domain_receipt_digest: { check: isHex64 },
  // Nested TemporalAuthorityEnvelopeV1 [4]. Only its object-ness is checked
  // here; its closed shape and ordering invariants are enforced by
  // assertTemporalAuthorityEnvelopeV1, called from the sole conformance checker below.
  temporal: { check: isPlainObject },
  started_at_diagnostic_utc: { check: isIsoUtc },
  coordination_root_id: { check: isHex64 },
  physical_root_id: { check: isHex64 },
  coordination_root_identity_security_digest: { check: isHex64 },
  canonical_root_path_digest: { check: isHex64 },
  mount_projection_digest: { check: isHex64 },
  root_generation_id: { check: isId128 },
  root_bootstrap_id: { check: isHexId },
  root_profile_digest: { check: isHex64 },
  local_filesystem_capability_digest: { check: isHex64 },
  mount_generation_digest: { check: isHex64 },
  provider_name: lit(TRANSITION_LOCK_PROVIDER_NAME),
  provider_build_digest: { check: isHex64 },
  provider_session_id: { check: isId128 },
  control_endpoint_id: { check: isId128 },
  provider_manager_instance_id: { check: isHexId },
  provider_manager_kind: { check: isEnum(PROVIDER_MANAGER_KIND_ENUM) },
  provider_manager_lifetime_profile: { check: isEnum(PROVIDER_MANAGER_LIFETIME_PROFILE_ENUM) },
  coordination_mode: { check: isEnum(COORDINATION_MODE_ENUM) },
  owner_pid: { check: isPid },
};

// ── Encoding + path conformance for the two `C` contract records ───────────

/**
 * Canonical-encoding conformance, from the governing preamble of R3.3's
 * Apéndice A (:2373-2374): "Todos los objetos son `additionalProperties:false`,
 * sin duplicate keys, canonical sorted compact JSON. Disk records: UTF-8
 * estricto + un LF".
 *
 * `assertClosedShape` runs AFTER `JSON.parse` and is structurally blind to four
 * things this one byte comparison catches:
 *  1. DUPLICATE KEYS -- the decisive one. `{"provider_abi":2,"provider_abi":3}`
 *     parses to `3` and would otherwise pass conformance. First-wins vs
 *     last-wins differs across parsers, so ONE artifact can be ACCEPTED as R33
 *     here and read as R32 elsewhere: an R32->R33 profile-smuggling vector, which
 *     is exactly what PLAN §3.6's mixed-profile matrix (PLAN.md ~L2888-2894)
 *     exists to prevent.
 *  2. `3.0` / `3e0` -- IEEE-identical to `3`, so `v === 3` cannot reject them.
 *  3. non-sorted or pretty-printed bytes.
 *  4. a missing, extra, or non-LF trailing byte.
 * It also makes the A.5 digests below unambiguous: once the bytes are proven
 * canonical, hashing `canonicalJSONStringify(obj)` and hashing the file's own
 * bytes-minus-LF provably coincide, so no caller can be surprised by which one
 * a formula meant.
 *
 * The 4,096-byte cap itself is enforced upstream by `classifyDurableRead`'s own
 * `maxSize` bound, which rejects on the fstat size BEFORE reading and then
 * reads `size + 1` -- i.e. R3.3:2374's "Readers leen `cap+1`" semantics, with
 * no silent truncation at exactly the cap. No second, weaker size check here.
 */
function assertCanonicalDiskRecordBytes(bytes, obj, artifactPath) {
  if (!bytes.equals(Buffer.from(canonicalJSONStringify(obj) + '\n', 'utf8'))) {
    throw new CliError('INVALID', 'SCHEMA_INVALID', 'artifact bytes are not the canonical sorted compact JSON + single-LF encoding of their own parsed content (duplicate keys, non-canonical number form, unsorted keys, or wrong trailing bytes): ' + artifactPath);
  }
}

/**
 * The two R33 contract records live DIRECTLY at the coordination-root leaf --
 * `C/root-profile.json` and `C/.provider-session` (R3.3:1019-1022) -- not under
 * the `<repo_id>/<wave_slug>/<plan_digest>/transactions/...` geometry every
 * other record in this file uses. `planRootFromArtifact` and
 * `assertExactCanonicalGeometry` are therefore both the WRONG primitives here
 * (the latter demands exactly 5 segments with a literal `transactions` at index
 * 3) and are deliberately not called.
 *
 * Checks, in order: exact canonical filename; ancestor-symlink-safe confinement
 * under `C`; then EXACTLY one path segment below `C`. The final depth check
 * resolves symlinks first (`realpathDeepestExisting`, the same primitive
 * `assertExactCanonicalGeometry` uses) rather than comparing lexically --
 * `path.relative`/`path.resolve` never touch the filesystem, so a nested path
 * whose ancestor is actually a symlink back to `C` would otherwise "relativize"
 * to depth 1 and pass a purely lexical check.
 */
function assertDirectlyAtCoordinationRoot(coordRoot, artifactPath, expectedBasename) {
  assertCanonicalFilename(artifactPath, expectedBasename);
  assertGenuinelyConfinedUnderRoot(coordRoot, artifactPath);
  let realCoordRoot;
  try {
    realCoordRoot = fs.realpathSync(coordRoot);
  } catch (err) {
    throw new CliError('INVALID', 'SECURITY_INVALID', 'coordination_root does not resolve: ' + coordRoot);
  }
  const { real: realExistingAncestor, tail } = realpathDeepestExisting(artifactPath);
  const realArtifact = tail.length ? path.join(realExistingAncestor, ...tail) : realExistingAncestor;
  const segments = path.relative(realCoordRoot, realArtifact).split(path.sep).filter(Boolean);
  if (segments.length !== 1 || segments[0] !== expectedBasename) {
    throw new CliError('INVALID', 'SECURITY_INVALID', 'artifact does not sit directly at the coordination-root leaf ' + expectedBasename + ' once symlinks are resolved: ' + artifactPath);
  }
}

// ── The three sole conformance checkers for the R33 records ────────────

/**
 * SOLE sanctioned reader of a `C/root-profile.json`. Mirrors
 * `readCanonicalRequestRecord`'s own choke-point discipline: path checking,
 * fd-bound durable read, closed shape and canonical encoding are ONE
 * inseparable step, so no caller can obtain a partially-checked
 * object. MECHANICAL RULE: no other `assertClosedShape(...,
 * ROOT_PROFILE_V3_FIELDS)` call may exist anywhere in this file.
 * Returns the full `{obj, bytes, digest, dev, ino, ...}` record so the
 * correlation slice can bind identity without a second, TOCTOU-risking read.
 */
function checkRootProfileV3Conformance(artifactPath, coordRoot) {
  // Phase 0: confinement-check `C` ITSELF before trusting anything inside it. Independent
  // of the tuple path because R3.3:1115-1117 step 12 calls this one on its own,
  // when `.provider-session` does not yet exist.
  const snapshot = snapshotCoordinationRootIdentity(coordRoot);
  assertDirectlyAtCoordinationRoot(coordRoot, artifactPath, ROOT_PROFILE_V3_BASENAME);
  const rec = readClosedRecord(artifactPath, ROOT_PROFILE_V3_FIELDS, { maxSize: C_RECORD_MAX_BYTES });
  assertCanonicalDiskRecordBytes(rec.bytes, rec.obj, artifactPath);
  assertCoordinationRootSnapshotUnchanged(coordRoot, snapshot, 'root-profile read');
  return rec;
}

/**
 * PER-RECORD DIAGNOSTIC ONLY -- NO ROOT-LEVEL AUTHORITY. Applies to BOTH
 * `checkRootProfileV3Conformance` above and `checkProviderSessionV3Conformance`
 * below. Both were formerly reachable as `validate --kind` entries; those kinds
 * were REMOVED in this pass, because a conformance check that returns a public
 * SUCCESS presents as a certifying surface it is not.
 *
 * Each checks exactly ONE record and deliberately never reads its sibling.
 * The concrete consequence, measured, not theorised: under a MIXED root (an R32
 * `coordination/root-profile/v2` at `C/root-profile.json` beside a perfectly
 * valid R33 `.provider-session`), a single-record conformance check on the
 * session SUCCEEDS, and symmetrically for the other pairing.
 *
 * THE MISUSE THIS FORBIDS: a caller that runs either single-record check to
 * completion and concludes "this coordination root is R33" is WRONG. Neither
 * function observes the sibling record, so neither can decide the
 * `unknown/mixed root` row of the mixed-profile matrix (PLAN.md ~L2894).
 * `checkR33ProfileTupleConformance` is the only function here that reads all
 * three records -- and per the section banner even IT establishes conformance
 * only, never authority. PLAN §3.1's tuple-first selection rule
 * (PLAN.md ~L2676-2679) is satisfied by the provider-owned in-process
 * composition, not by anything in this section.
 *
 * WHY THE SINGLE-RECORD SPLIT IS REQUIRED BY THE CONTRACT, not merely
 * convenient, and why it must not be "fixed" into a sibling requirement:
 * R3.3:1115-1117 step 12 publishes AND READS BACK `RootProfileV3` while
 * explicitly "no publicar aún ProviderSessionV3"; only step 17 publishes the
 * session. The contract therefore mandates an intermediate state in which
 * `C/root-profile.json` must be read back while `C/.provider-session` does not
 * yet exist. A function that demanded the sibling would make that mandated
 * readback impossible -- it would violate the bootstrap sequence, not merely
 * complicate it.
 *
 * CONTRACT-MANDATED CALLERS: step 12 calls the root-profile check, step 17 calls
 * the provider-session check. Those callers live in the provider-owned in-process
 * composition and DO NOT EXIST YET, so these functions are currently caller-less
 * production code awaiting their consumer. Any CLI exposure of them is a
 * diagnostic convenience and never an authority surface; step 18 --
 * `BootstrapReceipt` plus live capabilities -- is the first authority-success
 * point and is not implemented here.
 *
 * ABSENT vs PRESENT-BUT-WRONG-PROFILE IS NOT ABI-OBSERVABLE. PLAN.md ~L2911
 * requires that a `C` path occupied by the other profile's bytes be
 * PRESENT_INVALID and "nunca ABSENT". That holds BY CONSTRUCTION:
 * `classifyDurableRead` returns ABSENT only on ENOENT at open, so a present file
 * carrying R32 bytes structurally cannot take the absent branch -- it is read,
 * then fails shape.
 *
 * But it is NOT observable through the CLI AT ALL. `PRESENT_INVALID` is not one
 * of the 16 frozen `detail_code` values (PLAN.md ~L791), so it can never be
 * emitted, and both outcomes are BYTE-IDENTICAL on stdout AND stderr -- measured,
 * not inferred: same `status:"INVALID"`, same `detail_code:"SCHEMA_INVALID"`,
 * same nulls, and stderr empty in both cases. The `CliError` message is never
 * emitted anywhere, because `main()` writes to stderr only for NON-`CliError`
 * throws and the frozen envelope (PLAN.md ~L789) has no message field. So the
 * message is NOT a discriminator either -- an earlier revision of this comment
 * claimed it was, which was wrong.
 *
 * The property is therefore provable ONLY at the library boundary, via the
 * exported `classifyDurableRead`, which is the exact function where the
 * distinction lives: R32 bytes at this path return `state === DURABLE_PRESENT`,
 * a missing path returns `state === DURABLE_ABSENT`. That is a mechanism-level
 * test rather than a diagnostic-string test, so it cannot rot when a message is
 * reworded.
 *
 * `absentDetail` is deliberately NOT given a distinct code: no frozen code
 * denotes absence, so inventing one would mean repurposing a frozen value or
 * breaking this file's own documented not-found convention (see cjs:4017-4018).
 */

/**
 * SOLE sanctioned reader of a `C/.provider-session`, same discipline as
 * `checkRootProfileV3Conformance` plus the nested temporal envelope's closed shape and
 * ordering invariants. MECHANICAL RULE: no other `assertClosedShape(...,
 * PROVIDER_SESSION_V3_FIELDS)` call may exist anywhere in this file -- the
 * `temporal` field's own table entry checks object-ness ONLY, so a bypassing
 * caller would silently skip every invariant in
 * `assertTemporalAuthorityEnvelopeV1`.
 */
function checkProviderSessionV3Conformance(artifactPath, coordRoot) {
  // Phase 0, as above -- step 17 calls this one on its own.
  const snapshot = snapshotCoordinationRootIdentity(coordRoot);
  assertDirectlyAtCoordinationRoot(coordRoot, artifactPath, PROVIDER_SESSION_V3_BASENAME);
  const rec = readClosedRecord(artifactPath, PROVIDER_SESSION_V3_FIELDS, { maxSize: C_RECORD_MAX_BYTES });
  assertCanonicalDiskRecordBytes(rec.bytes, rec.obj, artifactPath);
  assertTemporalAuthorityEnvelopeV1(rec.obj.temporal);
  assertCoordinationRootSnapshotUnchanged(coordRoot, snapshot, 'provider-session read');
  return rec;
}

/**
 * `RuntimeProfileBindingV2` is barred from `C` (R3.3:1037-1039: "Fuera de los
 * dos contract records obligatorios `root-profile.json` y `.provider-session`
 * ya enumerados, ningún runtime-owner/provider evidence R33 se escribe en `C`").
 * That is a TWO-SIDED must: `C` holds exactly those two records, so an artifact
 * resolving INSIDE `C` must not pass conformance as a binding, however
 * well-formed its bytes are.
 *
 * Realpath-resolved, never lexical, for the same reason `assertGenuinelyConfined
 * UnderRoot` and `assertDirectlyAtCoordinationRoot` resolve first (cjs:419-426:
 * `path.relative`/`path.resolve` never touch the filesystem, so a path whose
 * ancestor is actually a symlink into `C` would otherwise "relativize" as
 * outside and slip past a lexical check).
 *
 * This is a NEGATIVE location constraint only. It grants its caller no path
 * authority whatsoever -- it proves where the artifact is NOT, never where it
 * legitimately lives, because R33 defines no such place.
 */
function assertNotInsideCoordinationRoot(coordRoot, artifactPath) {
  let realCoordRoot;
  try {
    realCoordRoot = fs.realpathSync(coordRoot);
  } catch (err) {
    throw new CliError('INVALID', 'SECURITY_INVALID', 'coordination_root does not resolve: ' + coordRoot);
  }
  const { real: realExistingAncestor, tail } = realpathDeepestExisting(artifactPath);
  const realArtifact = tail.length ? path.join(realExistingAncestor, ...tail) : realExistingAncestor;
  const rel = path.relative(realCoordRoot, realArtifact);
  const escapes = rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel);
  if (!escapes) {
    throw new CliError('INVALID', 'SECURITY_INVALID', 'a RuntimeProfileBindingV2 must not live inside the coordination root, which holds exactly root-profile.json and .provider-session (R3.3:1037-1039): ' + artifactPath);
  }
}

/**
 * Coordination-root confinement check, phase 0 of every entry point in this section.
 * Reuses `validateRootConfinement` -- the SAME primitive `root-validate` uses,
 * never a second weaker check -- which proves in one call that `C` is not a
 * symlink, is a real directory, is owner-confined, is EXACTLY mode 0700, and is
 * confined to its own git worktree.
 *
 * This closes a gap that let a caller mint a coordination root wholly outside
 * Git, at mode 0777, or behind a symlink, and have three self-consistent records
 * inside it pass every check in this section. Confining the ARTIFACT to `C`
 * (`assertDirectlyAtCoordinationRoot`) never proved anything about `C` ITSELF.
 *
 * Returns a NON-AUTHORITATIVE SNAPSHOT of the root's `dev/ino/mode/uid/gid`.
 *
 * IT IS A SNAPSHOT, NOT A WITNESS, AND IT DOES NOT CLOSE THE TOCTOU. An earlier
 * revision of this comment claimed a re-checked snapshot proves ONE accredited
 * identity was used throughout. That was WRONG and is withdrawn. Every check
 * here is a PATH-BASED `lstat` sample, so all it can establish is that the
 * identity matched AT EACH SAMPLING POINT. Three gaps survive:
 *  1. substitution between `validateRootConfinement` and the first `lstat`;
 *  2. an ABA cycle -- swap `C`, serve a different record, restore before the
 *     next sample -- which is invisible to path-based sampling by construction;
 *  3. worst and clearest: the record reads themselves re-resolve
 *     `path.join(coordRoot, basename)` AT READ TIME, so a swap DURING a read is
 *     served from the substitute while both surrounding samples see the
 *     original. No amount of sampling around a read can fix a read that
 *     re-resolves its own path.
 *
 * Closing this needs a retained `C_fd` (openat-equivalent) with SAME-FD reads,
 * so the records are read THROUGH the accredited directory handle rather than
 * re-resolved by name. That is provider-owned retained-handle work and belongs
 * to Phase B; it is deliberately not attempted here, and this snapshot must not
 * be presented as a substitute for it.
 *
 * What it is still worth: it catches the non-adversarial cases -- a root
 * renamed, chmod'd or chown'd mid-sequence -- and it makes the checked
 * identity OBSERVABLE to the caller, which is the only reason a test can check
 * which root a result came from at all.
 *
 * @param {string} coordRoot - absolute coordination root `C`.
 * @returns {{dev: bigint, ino: bigint, mode: bigint, uid: bigint, gid: bigint}}
 */
function snapshotCoordinationRootIdentity(coordRoot) {
  validateRootConfinement(coordRoot);
  const st = fs.lstatSync(coordRoot, { bigint: true });
  return { dev: st.dev, ino: st.ino, mode: st.mode, uid: st.uid, gid: st.gid };
}

/**
 * Re-proves the coordination root is still the SAME directory, unchanged, as the
 * one snapshotted at phase 0. A fresh `lstat` on the path, compared field by
 * field against the snapshot: a rename/replace changes dev or ino, a chmod
 * changes mode, a chown changes uid/gid. Called after each record read.
 *
 * Bounded claim: this detects a change that is STILL VISIBLE at the moment of
 * sampling. It does not detect an ABA cycle that restores the original before
 * this runs, and it cannot speak for what the read itself resolved -- see the
 * three surviving gaps on `snapshotCoordinationRootIdentity` above.
 */
function assertCoordinationRootSnapshotUnchanged(coordRoot, snapshot, afterWhat) {
  let st;
  try {
    st = fs.lstatSync(coordRoot, { bigint: true });
  } catch (err) {
    throw new CliError('INVALID', 'SECURITY_INVALID', 'coordination root vanished during conformance checking (after ' + afterWhat + '): ' + coordRoot);
  }
  if (st.dev !== snapshot.dev || st.ino !== snapshot.ino || st.mode !== snapshot.mode
      || st.uid !== snapshot.uid || st.gid !== snapshot.gid) {
    throw new CliError('INVALID', 'SECURITY_INVALID', 'coordination root identity changed during conformance checking (rebound/chmod/chown after ' + afterWhat + '): ' + coordRoot);
  }
}

/**
 * The binding's PATHLESS DIAGNOSTIC CARRIER admits EXACTLY TWO byte forms and no
 * others: the canonical payload, or that same payload followed by EXACTLY ONE
 * LF. Both are exact whole-buffer comparisons -- deliberately NOT an `endsWith`
 * test and NOT a trim, either of which would let CRLF, two-or-more LFs, or
 * surrounding whitespace through.
 *
 * Why a tolerance exists here at all, when the two `C` records require exactly
 * one LF: R3.3:2374 distinguishes "Disk records: UTF-8 estricto + un LF" from
 * "frames: sin LF", and `RuntimeProfileBindingV2` has NO defined disk path and
 * NO defined transport, so the source does not say which side of that line it
 * falls on. The resolution is to be strictly closed on every axis R3.3 DOES
 * specify for all closed objects (canonical sorted compact JSON, no duplicate
 * keys, no `3.0`-style numerics -- R3.3:2373) and permissive ONLY on the single
 * axis it leaves unstated for this record.
 *
 * DERIVED DECISION, with a condition attached: if `RuntimeProfileBindingV2` ever
 * gains a defined disk path or transport, this MUST be tightened to that form's
 * rule -- for a disk record, exactly one LF, i.e. `assertCanonicalDiskRecordBytes`.
 * The tolerance belongs exclusively to this pathless diagnostic carrier and
 * grants no path or transport authority.
 *
 * Note this closes the duplicate-key R32->R33 smuggling vector on the ONE record
 * whose whole purpose is carrying the P33 literal: without it,
 * `{"protocol_profile":P32, ..., "protocol_profile":P33}` parses last-wins to
 * P33 and is ACCEPTED here while a first-wins parser elsewhere reads P32.
 */
function assertBindingCarrierBytes(bytes, obj, artifactPath) {
  const canonical = Buffer.from(canonicalJSONStringify(obj), 'utf8');
  if (bytes.equals(canonical)) return;
  if (bytes.equals(Buffer.concat([canonical, Buffer.from('\n', 'utf8')]))) return;
  throw new CliError('INVALID', 'SCHEMA_INVALID', 'RuntimeProfileBindingV2 carrier bytes are neither the canonical payload nor the canonical payload plus exactly one LF (CRLF, repeated LFs, surrounding whitespace, pretty-printing, unsorted keys, duplicate keys and non-canonical numerics are all rejected): ' + artifactPath);
}

/**
 * SHAPE + CARRIER-ENCODING conformance for a `RuntimeProfileBindingV2`, plus the
 * negative "not inside `C`" location constraint. No CLI surface (see the tuple
 * function's note on why the `validate --kind` exposure was removed).
 *
 * It carries NO POSITIVE PATH AUTHORITY WHATSOEVER -- R33 defines no legitimate
 * location for this record, so a later stage must not read a location guarantee
 * into this function that it does not make. And because all six fields are fixed
 * literals, passing this check means only that the caller reproduced a constant:
 * it is conformance, never identity.
 *
 * DIGEST OPERAND (stated here so a later stage cannot get it wrong): any digest
 * or correlation over this record MUST use the canonical payload,
 * `canonicalJSONStringify(obj)`, NEVER the carrier's raw bytes -- the carrier
 * may legally carry a trailing LF that is not part of the payload, so hashing
 * `rec.bytes` would yield two different digests for one logically identical
 * binding. There is no binding digest formula in this stage; this note exists so
 * the one that arrives later starts from the payload.
 */
function checkRuntimeProfileBindingV2Conformance(artifactPath, coordRoot) {
  assertNotInsideCoordinationRoot(coordRoot, artifactPath);
  // No `maxSize` override: the generic DEFAULT_MAX_DURABLE_ARTIFACT_BYTES bound
  // applies as operational parser protection, not as an R33 contractual cap
  // (see the withdrawal note above).
  const rec = readDurableRecord(artifactPath);
  assertClosedShape(rec.obj, RUNTIME_PROFILE_BINDING_V2_FIELDS);
  assertBindingCarrierBytes(rec.bytes, rec.obj, artifactPath);
  return rec.obj;
}


// ── A.5 domain-separated digests (R3.3:3716-3729) ──────────────────────────

/**
 * `SHA256(UTF8(domain) || 0x00 || UTF8(canonical(record)))`.
 *
 * The domain is passed EXPLICITLY and is never derived from `record.schema`:
 * the temporal envelope has no `schema` key at all, and its domain
 * (`runtime/temporal-authority-envelope/v1`) is not any record's schema literal.
 *
 * Over the FULL canonical record -- NO field exclusion. Deliberately unlike the
 * sibling formulas at :3666-3669 and :3711-3713 (`canonical(binding without
 * binding_digest)`), which DO exclude their own self-digest field. These three
 * records carry no self-digest field, so there is nothing to exclude and adding
 * an exclusion would silently change every value.
 *
 * Hashes `canonicalJSONStringify(record)`, NOT the artifact's raw file bytes
 * and NOT `readDurableRecord`'s own `.digest`: a disk record carries a trailing
 * LF (R3.3:2374) that is not part of `canonical(record)`, so a raw-bytes digest
 * is a DIFFERENT value and would break
 * `ProviderSessionV3.root_profile_digest == rootProfileDigestV3(RootProfileV3)`
 * (:3734-3735). With `assertCanonicalDiskRecordBytes` proving the bytes are
 * exactly `canonical(obj) + LF`, the two differ by precisely that one byte and
 * nothing else.
 *
 * PLAN.md ~L2768-2769: these apply ONLY AFTER shape/profile/root accreditation.
 * A digest is never computed to DECIDE a profile.
 * @param {string} domain - the exact domain-separation string.
 * @param {object} record - an already shape-checked record.
 * @returns {string} lowercase hex sha256.
 */
function domainSeparatedRecordDigest(domain, record) {
  return sha256Buffer(Buffer.concat([
    Buffer.from(domain, 'utf8'),
    Buffer.from([0x00]),
    Buffer.from(canonicalJSONStringify(record), 'utf8'),
  ]));
}

/**
 * `rootProfileDigestV3(profile)` (R3.3:3716-3719).
 * @param {object} profile - a conformant RootProfileV3.
 * @returns {string} lowercase hex sha256.
 */
function rootProfileDigestV3(profile) {
  return domainSeparatedRecordDigest('coordination/root-profile/v3', profile);
}

/**
 * `providerSessionDigestV3(session)` (R3.3:3721-3724).
 * @param {object} session - a conformant ProviderSessionV3.
 * @returns {string} lowercase hex sha256.
 */
function providerSessionDigestV3(session) {
  return domainSeparatedRecordDigest('coordination/provider-session/v3', session);
}

/**
 * `temporalEnvelopeDigestV1(envelope)` (R3.3:3726-3729). Note the domain is
 * `runtime/temporal-authority-envelope/v1`, which is NOT a key of the envelope
 * -- TemporalAuthorityEnvelopeV1 [4] carries no `schema` field.
 * @param {object} envelope - a conformant TemporalAuthorityEnvelopeV1.
 * @returns {string} lowercase hex sha256.
 */
function temporalEnvelopeDigestV1(envelope) {
  return domainSeparatedRecordDigest('runtime/temporal-authority-envelope/v1', envelope);
}

// ── R33 tuple-first selection + correlation (PLAN §3.1, PLAN.md ~L2676-2679) ──

/**
 * The R33 tuple correlation set, DERIVED at module load from the two field
 * tables themselves -- never hand-transcribed (contract §8b: "Re-derive the
 * intersection programmatically; do not hand-trust either list").
 *
 *   correlation_set = (keys(RootProfileV3) ∩ keys(ProviderSessionV3))
 *                     minus keys that are a FIXED LITERAL in BOTH
 *
 * The subtraction is not an optimization: a key that is the same fixed literal
 * in both records agrees BY CONSTRUCTION, and any deviation is already rejected
 * as SCHEMA_INVALID at shape time, so a correlation guard over it could never
 * fire -- and a guard that cannot fail is worse than no guard, because it reads
 * as coverage. `isLiteralField` reads the `lit()` declaration, so this stays in
 * lockstep with the tables by construction.
 *
 * Measured: raw intersection 21, fixed-literal-in-both 4 (`schema`,
 * `provider_abi`, `control_protocol`, `provider_name`), derived set 17.
 *
 * The three enum-valued keys (`coordination_mode`, `provider_manager_kind`,
 * `provider_manager_lifetime_profile`) are correctly RETAINED: they are closed
 * ENUMS, not single literals, so two individually-shape-valid records can
 * legitimately disagree and that disagreement is a genuine correlation failure.
 *
 * The count is asserted here rather than trusted. A drifted table is a toolkit
 * integrity defect, not a per-request condition, so it fails at module load --
 * the same discipline `ROUTING_POLICY_TABLE` uses below ("Fail fast at module
 * load, not at first dispatch").
 */
const R33_TUPLE_CORRELATION_KEYS = (() => {
  const shared = Object.keys(ROOT_PROFILE_V3_FIELDS).filter(
    (k) => Object.prototype.hasOwnProperty.call(PROVIDER_SESSION_V3_FIELDS, k),
  );
  const derived = shared.filter(
    (k) => !(isLiteralField(ROOT_PROFILE_V3_FIELDS, k) && isLiteralField(PROVIDER_SESSION_V3_FIELDS, k)),
  );
  if (derived.length !== 17) {
    throw new Error(
      'R33 tuple correlation set derived ' + derived.length + ' keys from the field tables; '
      + 'contract §8b requires exactly 17 (raw intersection 21 minus 4 fixed-literal-in-both). '
      + 'A field table changed -- re-derive deliberately rather than adjusting this number.',
    );
  }
  return Object.freeze(derived.slice().sort());
})();

/**
 * Three-record STATIC CONFORMANCE over the R33 tuple. NOT accreditation, and NOT
 * PLAN §3.1's selection rule -- see the section banner. §3.1 (PLAN.md ~L2676-2679)
 * requires that "El validator se selecciona primero por el tuple acreditado
 * `RuntimeProfileBindingV2 + RootProfileV3 + ProviderSessionV3`", and the word
 * doing the work there is *acreditado*: an accredited tuple, which needs the
 * receipt chain and live capabilities this section cannot reach. What this
 * function establishes is the CONFORMANCE PRECONDITION for that rule -- it proves
 * the three records are individually well-formed and mutually correlated, and
 * nothing about whether any of them is legitimate.
 *
 * It has NO CLI SURFACE. The `validate --kind` exposure was removed: a kind that
 * returned public SUCCESS while establishing no authority was reporting coverage
 * it did not have. The binding path is a parameter because it is the only one of
 * the three with no contract-defined location; both `C` records are DERIVED from
 * `coordRoot`, which is what lets one call cover all three.
 *
 * ONE THING IT STILL DOES NOT PROVE, deliberately: the binding leg is a
 * conformance check, not an identity binding. All six `RuntimeProfileBindingV2`
 * fields are fixed literals and no field ties a binding to a particular root, so
 * ANY conforming binding satisfies it. The tuple's force comes from the two `C`
 * records plus the 17-key and digest correlation below.
 *
 * PRECEDENCE IS STRUCTURAL, not incidental (PLAN.md ~L2896-2907). It holds by
 * CONTROL FLOW ACROSS PHASES, not by the order of checks inside any one
 * function: every record's shape is fully checked in phase 1 before the first
 * phase-2 statement is reachable, so a tuple carrying BOTH a shape defect and a
 * correlation defect can only ever report SCHEMA_INVALID.
 *
 *   phase 0  location/trust  -> SECURITY_INVALID / DURABILITY_UNPROVEN
 *   phase 1  shape+literal+encoding (all three, incl. temporal invariants)
 *                            -> SCHEMA_INVALID
 *   phase 2  correlation     -> CORRELATION_INVALID
 *   phase 3  authority       -> NOT IMPLEMENTED, see below
 *
 * Phase 0 preceding the entire ladder is DERIVED, not cited: PLAN.md ~L2896-2907
 * ranks only SCHEMA -> CORRELATION -> AUTHORITY and never places
 * SECURITY_INVALID or DURABILITY_UNPROVEN. The reasoning is that you cannot
 * trust bytes you have not proven you can trust. Concrete consequence, stated
 * so it is not a surprise: a `.provider-session` that is BOTH a symlink AND
 * correlation-defective reports SECURITY_INVALID, not CORRELATION_INVALID.
 *
 * NO AUTHORITY TIER. R3.3:2848-2851 makes receipt-level disagreement
 * AUTHORITY_INVALID, but there is no `BootstrapReceipt` record anywhere in this
 * codebase to compare against, so that tier is deliberately absent rather than
 * faked. Note for whoever adds it: `root_bootstrap_id` will then carry TWO
 * comparisons at TWO tiers -- record-vs-record here (CORRELATION_INVALID) and
 * record-vs-receipt there (AUTHORITY_INVALID). That is INTENTIONAL, not a
 * duplicate to be deduplicated.
 *
 * NO BINDING-vs-ROOT CORRELATION CHECK, deliberately (contract §8c). The only
 * keys `RuntimeProfileBindingV2` shares with `RootProfileV3` are
 * `protocol_profile`, `control_protocol`, `provider_abi` and `handle_protocol`,
 * and all four are the SAME fixed literal in both tables -- so a conforming pair
 * agrees by construction and any disagreement is already SCHEMA_INVALID in phase
 * 1. Adding the check would be exactly the vacuous guard the correlation-set
 * subtraction above rejects. Do not "restore" it.
 *
 * ZERO SIDE EFFECTS: `validate` is a no-mutation surface (PLAN.md ~L785), and
 * this path calls only read primitives plus pure comparisons -- no publish, no
 * lock, no unlink, no temp file. That is what discharges "reject BEFORE
 * reservation/cut" (PLAN.md ~L2914).
 *
 * @param {string} bindingPath - absolute path to the RuntimeProfileBindingV2.
 * @param {string} coordRoot - absolute coordination root `C`.
 * @returns {object} the CONFORMANT RootProfileV3 -- bytes proven to match a
 * closed schema, never an accredited root.
 */
function checkR33ProfileTupleConformance(bindingPath, coordRoot) {
  // ---- phase 1: shape, literals and encoding for ALL THREE, before any
  // correlation. Each check also performs its own phase-0 location/trust
  // checks. Ordered binding-first so a P32 binding fails the whole tuple even
  // when both `C` records are perfectly valid R33 -- no record is ever treated
  // as authoritative on its own.
  // ---- phase 0: confinement-check `C` ITSELF, and freeze a NON-AUTHORITATIVE
  // snapshot of its identity. The three reads below are three separate windows
  // in which `C` could be renamed, chmod'd or replaced; the snapshot is
  // re-sampled after each. This narrows those windows -- it does NOT close them,
  // because the reads re-resolve their own paths and an ABA cycle is invisible
  // to path-based sampling. See `snapshotCoordinationRootIdentity`.
  const rootSnapshot = snapshotCoordinationRootIdentity(coordRoot);

  const binding = checkRuntimeProfileBindingV2Conformance(bindingPath, coordRoot);
  assertCoordinationRootSnapshotUnchanged(coordRoot, rootSnapshot, 'binding read');
  const rootRec = checkRootProfileV3Conformance(path.join(coordRoot, ROOT_PROFILE_V3_BASENAME), coordRoot);
  assertCoordinationRootSnapshotUnchanged(coordRoot, rootSnapshot, 'root-profile read');
  const sessionRec = checkProviderSessionV3Conformance(path.join(coordRoot, PROVIDER_SESSION_V3_BASENAME), coordRoot);
  assertCoordinationRootSnapshotUnchanged(coordRoot, rootSnapshot, 'provider-session read');
  const root = rootRec.obj;
  const session = sessionRec.obj;

  // ---- phase 2: correlation. Every rule here is CORRELATION_INVALID; the
  // order among them is an implementation detail, NOT a contract -- the source
  // does not rank same-tier rules, so only status+detail_code are specified,
  // never which message a multi-defect tuple surfaces. Cheapest first: field
  // comparisons before a SHA-256.
  for (const key of R33_TUPLE_CORRELATION_KEYS) {
    if (root[key] !== session[key]) {
      throw new CliError('INVALID', 'CORRELATION_INVALID', 'root-profile.' + key + ' does not equal provider-session.' + key);
    }
  }

  // Temporal domain agreement (contract §8d, DERIVED from R3.3:1465 "different
  // domain values are incomparable, never converted" plus R3.3:1475-1476 "Si un
  // outer object tiene `clock_domain_id`, debe ser byte-identical a
  // `temporal.clock_domain_id`"). Checked against BOTH records -- the 17-key
  // rule above already proved the two top-level values agree, so this binds the
  // nested envelope to that same single domain.
  if (session.temporal.clock_domain_id !== session.clock_domain_id) {
    throw new CliError('INVALID', 'CORRELATION_INVALID', 'provider-session.temporal.clock_domain_id does not equal its own top-level clock_domain_id');
  }
  if (session.temporal.clock_domain_id !== root.clock_domain_id) {
    throw new CliError('INVALID', 'CORRELATION_INVALID', 'provider-session.temporal.clock_domain_id does not equal root-profile.clock_domain_id');
  }

  // The CITED digest chain (R3.3:3734-3735): "`ProviderSessionV3.
  // root_profile_digest` y binding `root_profile_digest` son
  // `rootProfileDigestV3(RootProfileV3)`". Operand is the canonical PAYLOAD via
  // rootProfileDigestV3, never the file's raw bytes -- the record carries a
  // trailing LF that is not part of `canonical(record)`.
  const expectedRootDigest = rootProfileDigestV3(root);
  if (session.root_profile_digest !== expectedRootDigest) {
    throw new CliError('INVALID', 'CORRELATION_INVALID', 'provider-session.root_profile_digest does not equal rootProfileDigestV3(root-profile)');
  }

  // `coordRootIdentitySnapshot` is part of the RESULT, not a test affordance:
  // `rootRec`/`sessionRec` carry dev/ino for the two record FILES, so without
  // this nothing in the return value identifies `C` itself and no caller could
  // tell which root a result came from. That opacity is where the
  // outside-worktree/0777/symlink defects hid.
  //
  // BOUNDED CLAIM. An earlier revision of this comment said exposing it "proves
  // ONE accredited identity was used throughout" and was "strictly stronger"
  // than racing a swap. Both are WITHDRAWN. It reports the identity observed at
  // the sampling points, nothing more; a mid-read swap is served from the
  // substitute while every sample still matches. Do not build an authority
  // argument on this field -- that needs a retained `C_fd` with same-FD reads,
  // which is Phase B.
  return {
    binding: binding, root: root, session: session,
    rootRec: rootRec, sessionRec: sessionRec,
    coordRootIdentitySnapshot: rootSnapshot,
  };
}

// R33-STAGE1-AUDIT-SCOPE:END
//
// CONSTRAINT FOR WHOEVER IMPLEMENTS THE PROVIDER-OWNED AUTHORITY COMPOSITION:
// put it OUTSIDE the markers above. The region they delimit is asserted to
// contain no filesystem-mutating primitive, and the bootstrap sequence's step 18
// -- `BootstrapReceipt` plus live capabilities transitioning the session to
// ACTIVE, the first authority-success point -- necessarily WRITES. Placing that
// code inside the markers would break the absence audit, and the tempting repair
// would be to weaken the audit rather than move the code. That is the same
// failure family as a marker duplicated into its own describing comment: a guard
// that cannot fail still reads as coverage. Move the code, never the assertion.

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
  'active-lease-v1': (artifact, coordRoot) => validateActiveLeaseV1(artifact, coordRoot),
  'activation-intent-v1': (artifact) => validateActivationIntentV1(artifact),
  'delivery-v1': (artifact) => validateDeliveryV1(artifact),
  'accepted-result-v1': (artifact) => validateAcceptedResultV1(artifact),
  'ack-v1': (artifact) => validateAckV1(artifact),
  'cancel-v1': (artifact, coordRoot) => validateCancelV1(artifact, coordRoot),
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

/**
 * Full coordination-root confinement primitive (RCR-confine-*): lstat
 * not-a-symlink, real directory, POSIX owner+0700 mode, Windows ACL probe
 * seam, git-worktree confinement, then a stable-identity re-check
 * (dev/ino/mode/uid/gid unchanged) across the measurably-slower `git`
 * confinement subprocess call.
 *
 * BOUNDED CLAIM, narrowed from "closes the TOCTOU window": the re-check DETECTS
 * a change that PERSISTS across that subprocess window. It does not close the
 * window, and it cannot: an ABA cycle -- swap the root, let the check run,
 * restore before the re-check -- leaves every sampled field identical. Nor does
 * the guarantee outlive the call: the caller resolves the path again afterwards,
 * and anything it then reads by name is re-resolved at that moment. Closing it
 * needs a retained directory fd with same-fd reads, which this function does not
 * provide. Wording narrowed after the same overclaim was withdrawn from the R33
 * snapshot helper; path-based sampling cannot establish continuity anywhere.
 *
 * Extracted from
 * `cmdRootValidate` (unchanged behavior/order/errors) so any OTHER caller
 * needing the SAME confined-root guarantee (e.g. the WP3 bridge's own
 * rendezvous root) reuses this exact primitive instead of a second, weaker
 * reimplementation.
 * @param {string} coordRoot - absolute path, already resolved by the caller.
 * @returns {string} coordRoot, unchanged, once every check passes.
 * @throws {CliError}
 */
function validateRootConfinement(coordRoot) {
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
  return coordRoot;
}

function cmdRootValidate(flags) {
  requireFlags(flags, ['coordination-root']);
  const coordRoot = resolveAbsolute(flags['coordination-root']);
  return { artifact_ref: validateRootConfinement(coordRoot) };
}
COMMANDS['root-validate'] = cmdRootValidate;

// ─────────────────────────────────────────────────────────────────────────────
// M7/WP4 second-pass correction (PLAN.md §15b, ~L592/~L604): role-command-
// grant/v1 -- CONSUME side. context-provider-gate.js mints REQUESTER grants
// (via a RequesterBinding); runtime-consultation-target-gate.js mints
// TARGET grants (via an existing RoleActorBinding); this file -- the CLI
// both hooks inject into -- atomically one-time-consumes and fully
// validates the referenced grant BEFORE any read or mutation, wired
// generically into main() below (see ROLE_COMMAND_GRANT_AUTHORITY_FOR_COMMAND).
//
// This file cannot `require('./runtime-role-lifecycle.cjs')`: that module
// ALREADY requires THIS one (`const rc = require('./runtime-consultation.cjs');`
// near its own top), so an rc -> rll require would be circular. The small
// set of host-private registry primitives this section needs (registry
// base/repo-dir path formula, secure directory creation, the
// RequesterBinding/RoleActorBinding closed-shape validators) are therefore
// a small, LOGIC-IDENTICAL local copy of runtime-role-lifecycle.cjs's own --
// mirrors this file's existing `hasExactKeys` duplication precedent (see its
// own doc comment above) rather than a weaker reimplementation. A grant file
// is a security boundary; nothing here trades rigor for brevity.
//
// SCOPE: M7 completeness pass (2026-08-09) extends grant-gating to the full
// PLAN.md §15b 18-command matrix -- 14 requester (root-init, root-validate,
// publish-blob, publish-request, dispatch, record-delivery, takeover,
// await-result, accept-result, transaction-ack, cancel, worker-stop,
// cleanup, validate) and 4 target (claim, lease-heartbeat, publish-result,
// worker-stop-ack). See context-provider-gate.js's own
// REQUESTER_ADMIN_SUBCOMMANDS comment for the requester-side injection
// wiring (the mint/injection mechanism itself is fully generic across every
// requester subcommand -- extending its scope needed no new logic, only
// this data change).
// ─────────────────────────────────────────────────────────────────────────────

const ROLE_COMMAND_GRANT_SCHEMA = 'runtime/role-command-grant/v1';
const ROLE_COMMAND_GRANT_TTL_SECONDS = 30; // PLAN.md §15b: "<=30s ceiling".
const ROLE_COMMAND_GRANT_KEYS = [
  'actor_instance_id', 'attempt_id', 'authority', 'binding_id',
  'canonical_argv_digest', 'created_at', 'expiry', 'grant_id', 'lease_epoch',
  'plan_digest', 'request_id', 'role', 'schema', 'subcommand', 'worktree_id',
].sort();
const REQUESTER_BINDING_SCHEMA = 'coordination/requester-binding/v1';
const REQUESTER_BINDING_KEYS = [
  'actor_instance_id', 'agent_key', 'binding_id', 'created_at', 'expiry',
  'plan_digest', 'role', 'runtime', 'runtime_session_key', 'schema', 'worktree_id',
].sort();
const ROOT_SOURCE_BINDING_SCHEMA_LOCAL = 'runtime/root-source-binding/v1';
// M7 completeness: the v2 sibling of ROOT_SOURCE_BINDING_SCHEMA_LOCAL/
// CLAUDE_ONE_SHOT_BINDING_SCHEMA below, mirroring runtime-role-lifecycle.cjs's
// own ROOT_SOURCE_BINDING_SCHEMA_V2/CLAUDE_ONE_SHOT_BINDING_SCHEMA_V2 literal
// values exactly. A fresh v2-migrated binding's grantContext.bindingSchema
// (derived from bindingResult.binding.schema, itself now sourced from the
// real v1/v2-aware runtime-role-lifecycle.cjs validators) must be recognized
// by every routing/security check below, not just the pre-migration v1 value.
const ROOT_SOURCE_BINDING_SCHEMA_V2 = 'runtime/root-source-binding/v2';
// M6-M7-ROOT-SOURCE-CONTINUATION-CLOSURE-20260820: the ONE private predicate
// for "this authenticated grantContext is backed by a root-source binding"
// (accepted v1 or v2 schema). Shared by main()'s publish-request
// serialization branch and by cmdDispatch's routing constraint -- never two
// divergent schema checks. A missing/undefined grantContext (a command that
// is not grant-gated, or an in-process caller such as the host bridge) is
// never root-source.
function isRootSourceGrantContext(grantContext) {
  return Boolean(grantContext)
    && (grantContext.bindingSchema === ROOT_SOURCE_BINDING_SCHEMA_LOCAL
      || grantContext.bindingSchema === ROOT_SOURCE_BINDING_SCHEMA_V2);
}
const ROOT_SOURCE_PRE_INGRESS_COMMANDS = new Set([
  'root-init', 'root-validate', 'validate', 'publish-blob', 'publish-request',
]);
const ROOT_SOURCE_POST_INGRESS_COMMANDS = new Set([
  'dispatch', 'await-result', 'accept-result', 'transaction-ack', 'cancel',
  'cleanup', 'record-delivery',
]);
const CLAUDE_ONE_SHOT_BINDING_SCHEMA = 'runtime/claude-one-shot-binding/v1';
const CLAUDE_ONE_SHOT_BINDING_SCHEMA_V2 = 'runtime/claude-one-shot-binding/v2';
// Logic-identical local copy of runtime-role-lifecycle.cjs's own
// CANONICAL_ROLES/IDENTITY_PROVIDER_ENUM (same circular-import constraint).
const GRANT_CANONICAL_ROLES = [
  'arch-platform', 'arch-testing', 'arch-integration', 'context-provider',
  'doc-updater', 'toolkit-specialist', 'test-specialist', 'verifier',
  'quality-gater', 'planner',
];
const GRANT_IDENTITY_PROVIDER_ENUM = ['claude-hook', 'codex-supervisor'];
const HEX_CSPRNG_32_RE = /^[0-9a-f]{32}$/;

// authority -> the bare (no leading "--") flag name carrying the grant id on
// the executed command. M7 completeness (2026-08-09): extended to the FULL
// PLAN.md §15b matrix -- all 14 requester subcommands ("Requester authority
// covers root-init, root-validate, publish-blob, publish-request, dispatch,
// requester-owned record-delivery, takeover, await-result, accept-result,
// transaction-ack, cancel, worker-stop, cleanup, and validate") plus the 4
// target subcommands ("Target authority covers native/external claim,
// lease-heartbeat, publish-result, and worker-stop-ack"). This is a pure
// data extension: main()'s own validateAndConsumeRoleCommandGrantForCommand
// call, the COMMAND_FLAGS-extension loop below, and the split grant-validation/
// consumption pipeline
// were all already generic (keyed off this map's own entries, never a
// hardcoded subcommand list) -- see RCG-REQ12-*-NOGRANT in
// runtime-consultation-role-gate.bats.
const ROLE_COMMAND_GRANT_AUTHORITY_FOR_COMMAND = Object.freeze({
  'root-init': 'requester',
  'root-validate': 'requester',
  'publish-blob': 'requester',
  'publish-request': 'requester',
  dispatch: 'requester',
  'record-delivery': 'requester',
  takeover: 'requester',
  'await-result': 'requester',
  'accept-result': 'requester',
  'transaction-ack': 'requester',
  cancel: 'requester',
  'worker-stop': 'requester',
  cleanup: 'requester',
  validate: 'requester',
  claim: 'target',
  'lease-heartbeat': 'target',
  'publish-result': 'target',
  'worker-stop-ack': 'target',
});
const ROLE_COMMAND_GRANT_FLAG_FOR_AUTHORITY = Object.freeze({ requester: 'requester-binding', target: 'target-binding' });
for (const grantCmdName of Object.keys(ROLE_COMMAND_GRANT_AUTHORITY_FOR_COMMAND)) {
  const grantAuthority = ROLE_COMMAND_GRANT_AUTHORITY_FOR_COMMAND[grantCmdName];
  COMMAND_FLAGS[grantCmdName] = COMMAND_FLAGS[grantCmdName].concat([ROLE_COMMAND_GRANT_FLAG_FOR_AUTHORITY[grantAuthority]]);
}

function localComputePrincipalId() {
  if (typeof process.getuid === 'function') return 'uid-' + process.getuid();
  return 'user-' + sha256String(os.userInfo().username);
}
function localRegistryRepoDir(repoId) {
  return path.join(os.tmpdir(), 'android-common-doc-runtime', localComputePrincipalId(), repoId);
}
function roleCommandGrantPathFor(repoId, grantId) {
  return path.join(localRegistryRepoDir(repoId), 'role-command-grants', grantId + '.json');
}
function roleCommandGrantConsumedMarkerPathFor(repoId, grantId) {
  return path.join(localRegistryRepoDir(repoId), 'role-command-grants', grantId + '.consumed');
}
// M7 completeness: requesterBindingPathForLocal/roleActorBindingPathForLocal/
// claudeOneShotBindingPathForLocal/claudeOneShotBindingRetiredMarkerPathForLocal
// are REMOVED -- every caller now uses runtime-role-lifecycle.cjs's own
// requesterBindingPathFor/roleActorBindingPathFor/claudeOneShotBindingPathFor/
// claudeOneShotBindingRetiredMarkerPathFor directly (lazy-required, same
// circular-load-safe pattern already established throughout this file).

/** Logic-identical local copy of runtime-role-lifecycle.cjs's own ensureSecureRegistryDir. */
function localEnsureSecureRegistryDir(dirPath) {
  try {
    const lst = fs.lstatSync(dirPath);
    if (lst.isSymbolicLink()) return { ok: false, reason: 'symlink' };
  } catch (err) {
    // ENOENT (does not exist yet) is the normal, expected case -- proceed.
  }
  try {
    fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
    fs.chmodSync(dirPath, 0o700);
  } catch (err) {
    return { ok: false, reason: 'mkdir-failed' };
  }
  if (process.platform !== 'win32') {
    let st;
    try {
      st = fs.lstatSync(dirPath, { bigint: true });
    } catch (err) {
      return { ok: false, reason: 'stat-failed' };
    }
    if (st.isSymbolicLink()) return { ok: false, reason: 'symlink' };
    if (typeof process.getuid === 'function' && st.uid !== BigInt(process.getuid())) {
      return { ok: false, reason: 'wrong-owner' };
    }
    if ((st.mode & 0o777n) !== 0o700n) return { ok: false, reason: 'wrong-mode' };
  }
  return { ok: true };
}

// M7 completeness: this file's former local-copy RoleActorBinding validator
// is REMOVED -- validateRoleCommandGrantOrThrow now calls
// runtime-role-lifecycle.cjs's own validateRoleActorBindingFor directly
// (lazy-required), which is already v1/v2+fence-aware. The ISO-8601-
// canonical-form checker and low-level registry-record reader just above
// this comment are NOT removed: validateRoleCommandGrantOrThrow also uses
// them to read/validate the grant file itself, a separate concern with no
// runtime-role-lifecycle.cjs equivalent.

// M7 completeness: this file's former local-copy Claude-one-shot-binding
// validator is REMOVED -- validateRoleCommandGrantOrThrow now calls
// runtime-role-lifecycle.cjs's own validateClaudeOneShotBindingFor directly
// (lazy-required), already v1/v2+fence-aware.

// M7 section 4/8.5: this file's former local-copy one-shot-family live-
// bindings scanner and its retirement writer are REMOVED along with their
// sole caller (cmdCancel's retirement-wiring branch, below) -- no new
// retirement artifact is written for a Claude one-shot binding; cancellation
// of a one-shot target is cut by canonical cancel.json directly, not a
// marker on the binding.

// M6+M7 FINAL AUTHORITY CORRECTION (agent_id binding closure) + HARD NO-GO
// correction (items 1/2/3), M7 completeness: claudeId01LookupKeyLocal/
// claudeId01RecordPathForLocal/sessionLookupKeyLocal/
// sessionGenerationPathForLocal/peekSessionGenerationLocal/
// isClaudeId01AttestationWellFormedLocal/checkClaudeId01ProofCompleteLocal/
// validateRequesterBindingForLocal/validateRootSourceBindingForLocal are
// REMOVED. The last two were already pure circular-load-safe delegations to
// runtime-role-lifecycle.cjs's own validateRequesterBindingFor/
// validateRootSourceBindingFor; every remaining caller now lazy-requires
// runtime-role-lifecycle.cjs and calls those directly, the same pattern
// already established throughout this file.

// M7 defect 9 (section 6): this file's former dual-family-probe helper pair
// (deciding whether a family's own binding directory genuinely holds
// nothing at a given id, used to disambiguate a "try both validators" grant
// backing lookup) is removed -- validateRoleCommandGrantOrThrow now
// discriminates the backing namespace directly via one fd-bound presence
// read per family, before ever calling either validator.

// M7 section 4/8.5: retireExpiredRootSourceBindingOrThrow is REMOVED --
// expiry is a read-only cut (validateRootSourceBindingFor's own fresh-read
// expiry check), never a retirement-artifact write. The caller above already
// throws AUTHORITY_INVALID for an expired root-source binding regardless.

// Genuinely still needed (not part of the deleted binding-validation Local
// family): validateRoleCommandGrantOrThrow reads/validates the
// role-command-grant/v1 file itself, which has no runtime-role-lifecycle.cjs
// equivalent -- grants are this file's own concept, not a binding.
function isCanonicalIsoUtcLocal(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)) return false;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return false;
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z') === value;
}

/**
 * Fd-bound secure read for this section's own local registry records
 * (role-command-grant/v1) -- mirrors runtime-role-lifecycle.cjs's own
 * readRegistryRecord exactly (the SAME classifyDurableRead primitive already
 * used throughout this file for every OTHER coordination-adjacent record,
 * same immutablePath:true default). Never a raw fs.readFileSync: a grant
 * file is a security boundary and must get the same fd-bound, no-follow,
 * owner/mode-checked, TOCTOU-resistant read every other record in this file
 * receives.
 */
function readLocalRegistryRecord(recordPath) {
  const classified = classifyDurableRead(recordPath, { parse: true });
  if (classified.state === DURABLE_ABSENT) return { ok: true, absent: true };
  if (classified.state === DURABLE_PENDING) return { ok: false, reason: 'pending' };
  return { ok: true, obj: classified.obj };
}

/**
 * Fully validates a role-command-grant/v1 without mutating its consumption
 * state (PLAN.md
 * §15b, ~L592; ~L604's revalidation list: schema/binding/authority/
 * subcommand/argv digest, then the backing binding's own scope). Every
 * check is independent and fails closed. Consumption is a no-clobber marker
 * create (EEXIST == replay), mirroring
 * validateAndConsumeLifecycleCommandGrant's own established discipline in
 * the sibling module.
 */
function validateRoleCommandGrantOrThrow(repoId, grantId, argvDigest, expectedAuthority, expectedSubcommand) {
  if (!HEX_CSPRNG_32_RE.test(grantId)) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'malformed role-command-grant id');
  }
  const grantPath = roleCommandGrantPathFor(repoId, grantId);
  const grantRead = readLocalRegistryRecord(grantPath);
  if (!grantRead.ok) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'role-command-grant not yet durable: ' + grantRead.reason);
  }
  if (grantRead.absent) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'role-command-grant absent');
  }
  const grant = grantRead.obj;
  if (!grant || !hasExactKeys(grant, ROLE_COMMAND_GRANT_KEYS)) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'role-command-grant shape invalid');
  }
  if (grant.grant_id !== grantId) throw new CliError('INVALID', 'AUTHORITY_INVALID', 'role-command-grant id/path mismatch');
  if (grant.schema !== ROLE_COMMAND_GRANT_SCHEMA) throw new CliError('INVALID', 'AUTHORITY_INVALID', 'role-command-grant schema invalid');
  if (grant.authority !== expectedAuthority) throw new CliError('INVALID', 'AUTHORITY_INVALID', 'role-command-grant authority mismatch');
  if (grant.subcommand !== expectedSubcommand) throw new CliError('INVALID', 'AUTHORITY_INVALID', 'role-command-grant subcommand mismatch');
  if (grant.canonical_argv_digest !== argvDigest) throw new CliError('INVALID', 'AUTHORITY_INVALID', 'role-command-grant argv digest mismatch (tampered argv)');
  if (!isHexId(grant.binding_id) || !isHexId(grant.actor_instance_id)) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'role-command-grant id-shape invalid');
  }
  if (!isHex64(grant.worktree_id) || !isHex64(grant.plan_digest)) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'role-command-grant scope-id-shape invalid');
  }
  if (grant.role !== null && !GRANT_CANONICAL_ROLES.includes(grant.role)) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'role-command-grant role-shape invalid');
  }
  if (grant.request_id !== null && (typeof grant.request_id !== 'string' || grant.request_id.length === 0)) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'role-command-grant request_id-shape invalid');
  }
  if (grant.attempt_id !== null && (typeof grant.attempt_id !== 'string' || grant.attempt_id.length === 0)) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'role-command-grant attempt_id-shape invalid');
  }
  if (grant.lease_epoch !== null && !(Number.isInteger(grant.lease_epoch) && grant.lease_epoch >= 0)) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'role-command-grant lease_epoch-shape invalid');
  }
  if (!isCanonicalIsoUtcLocal(grant.created_at) || !isCanonicalIsoUtcLocal(grant.expiry)) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'role-command-grant timestamp-shape invalid');
  }
  const createdAtMs = Date.parse(grant.created_at);
  const expiryMs = Date.parse(grant.expiry);
  if (createdAtMs > expiryMs) throw new CliError('INVALID', 'AUTHORITY_INVALID', 'role-command-grant timestamp invalid');
  if (expiryMs - createdAtMs > ROLE_COMMAND_GRANT_TTL_SECONDS * 1000) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'role-command-grant TTL exceeds the 30s ceiling');
  }
  const nowMs = currentClockMs();
  if (createdAtMs > nowMs) throw new CliError('INVALID', 'AUTHORITY_INVALID', 'role-command-grant created in the future');
  if (nowMs >= expiryMs) throw new CliError('INVALID', 'AUTHORITY_INVALID', 'role-command-grant expired');

  // M7 completeness Part C follow-up: a 'target'-authority grant may be
  // backed by EITHER RoleActorBinding/v1 (the pre-existing, unchanged
  // persistent path) OR ClaudeOneShotBinding/v1 (point 4) -- the two types'
  // binding_id CSPRNG namespaces are structurally disjoint (independently
  // minted, stored under different registry subdirectories), so trying
  // RoleActorBinding first and ClaudeOneShotBinding only if that fails is a
  // safe, unambiguous "which of two disjoint namespaces does this specific
  // id live in" lookup -- never the kind of driver-selection ambiguity the
  // "never fallback/probe-both" guidance addresses (that guidance governs
  // the MINT-side choice of which type to back a NEW grant with, made
  // deterministically by runtime-consultation-target-gate.js itself).
  // M7 completeness: the whole Local family of binding validators this
  // branch used to call (validateRequesterBindingForLocal/
  // validateRootSourceBindingForLocal/validateRoleActorBindingForLocal/
  // validateClaudeOneShotBindingForLocal) reimplemented v1-only shape/schema
  // checks -- a v2-backed binding failed EVERY one of them, so grant
  // CONSUMPTION (as opposed to minting, already v1/v2-aware) silently could
  // not succeed for any v2 binding. The stale circular-import justification
  // for that duplication no longer holds: ~19 other call sites in this same
  // file already safely `require('./runtime-role-lifecycle.cjs')` lazily,
  // inside a function body, well after both modules have finished loading.
  // Consuming the real, already v1/v2+fence-aware runtime-role-lifecycle.cjs
  // validators directly closes that gap.
  // M7 defect 9 (section 6): clean namespace discrimination -- exactly one
  // of the two disjoint registry subdirectories may hold a record at this
  // binding_id (each family's own binding_id is independently minted, never
  // reused across families); malformed or both-present is denied by the
  // SAME cardinality check, never a dual-family-probe fallback that tries
  // both validators and disambiguates after the fact.
  const rll = require('./runtime-role-lifecycle.cjs');
  let bindingResult;
  if (expectedAuthority === 'requester') {
    const stablePresence = rll.readRegistryRecord(rll.requesterBindingPathFor({ repoId }, grant.binding_id));
    if (!stablePresence.ok) {
      throw new CliError('INVALID', 'AUTHORITY_INVALID', 'stable requester binding namespace read failed: ' + stablePresence.reason);
    }
    const rootSourcePresence = rll.readRegistryRecord(rll.rootSourceBindingPathFor({ repoId }, grant.binding_id));
    if (!rootSourcePresence.ok) {
      throw new CliError('INVALID', 'AUTHORITY_INVALID', 'root-source requester binding namespace read failed: ' + rootSourcePresence.reason);
    }
    const stableHasRecord = !stablePresence.absent;
    const rootSourceHasRecord = !rootSourcePresence.absent;
    if (stableHasRecord === rootSourceHasRecord) {
      throw new CliError('INVALID', 'AUTHORITY_INVALID', 'requester grant backing binding namespace cardinality must equal exactly one');
    }
    bindingResult = stableHasRecord
      ? rll.validateRequesterBindingFor({ repoId }, grant.binding_id, grant.role, grant.worktree_id, grant.plan_digest)
      : rll.validateRootSourceBindingFor({ repoId }, grant.binding_id, grant.role, grant.worktree_id, grant.plan_digest);
  } else {
    const roleActorPresence = rll.readRegistryRecord(rll.roleActorBindingPathFor({ repoId }, grant.binding_id));
    if (!roleActorPresence.ok) {
      throw new CliError('INVALID', 'AUTHORITY_INVALID', 'target role-actor binding namespace read failed: ' + roleActorPresence.reason);
    }
    const oneShotPresence = rll.readRegistryRecord(rll.claudeOneShotBindingPathFor({ repoId }, grant.binding_id));
    if (!oneShotPresence.ok) {
      throw new CliError('INVALID', 'AUTHORITY_INVALID', 'target one-shot binding namespace read failed: ' + oneShotPresence.reason);
    }
    const roleActorHasRecord = !roleActorPresence.absent;
    const oneShotHasRecord = !oneShotPresence.absent;
    if (roleActorHasRecord === oneShotHasRecord) {
      throw new CliError('INVALID', 'AUTHORITY_INVALID', 'target grant backing binding namespace cardinality must equal exactly one');
    }
    // The one-shot side's own full validator (never a bare namespace check
    // alone) additionally proves the Claude-domain fence/generation cuts --
    // the discrimination above only decides WHICH validator to consult.
    bindingResult = roleActorHasRecord
      ? rll.validateRoleActorBindingFor({ repoId }, grant.binding_id, grant.role, grant.worktree_id, grant.plan_digest)
      : rll.validateClaudeOneShotBindingFor({ repoId }, grant.binding_id, {
        requestId: grant.request_id, attemptId: grant.attempt_id, leaseEpoch: grant.lease_epoch,
        role: grant.role, worktreeId: grant.worktree_id, planDigest: grant.plan_digest,
      });
  }
  if (!bindingResult.ok) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'role-command-grant backing binding invalid: ' + bindingResult.reason);
  }
  if (bindingResult.binding.actor_instance_id !== grant.actor_instance_id) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'role-command-grant actor_instance_id does not match its own backing binding');
  }

  return {
    repoId,
    bindingSchema: bindingResult.binding.schema,
    bindingId: grant.binding_id,
    requestId: grant.request_id,
    attemptId: grant.attempt_id,
    leaseEpoch: grant.lease_epoch,
    role: grant.role,
    actorInstanceId: grant.actor_instance_id,
    binding: bindingResult.binding,
    // M7 GREEN section 4.4: the durable GRANT's own expiry, internal/
    // non-wire -- consume-grant admission must bind its deadline to this
    // (the grant's own <=30s TTL), never the backing binding's own
    // (potentially much longer-lived) expiry.
    grantExpiry: grant.expiry,
  };
}

/**
 * Commits one-time role-command-grant consumption after every independent
 * grant, binding and transaction-scope check has passed. This is the first
 * mutation in the authority path; invalid transaction scope therefore leaves
 * no `.consumed` marker behind.
 */
function consumeValidatedRoleCommandGrantOrThrow(repoId, grantId) {
  // Atomic one-time consumption: no-clobber marker create. EEXIST == replay.
  const consumedPath = roleCommandGrantConsumedMarkerPathFor(repoId, grantId);
  const dirResult = localEnsureSecureRegistryDir(path.dirname(consumedPath));
  if (!dirResult.ok) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'unable to prepare role-command-grant consumption directory');
  }
  try {
    // suppressReplacePostRenameFaultInjection + suppressInternalFaultInjection
    // (M7 completeness, sibling fix): this write runs after independent
    // transaction accreditation but before any handler/business-logic lock,
    // so it must never be the one to "eat" a
    // RUNTIME_CONSULTATION_FAULT_REPLACE_POSTRENAME/TEMP_HARDEN/
    // NOCLOBBER_PRELINK/LOSER_UNLINK/DIR_FSYNC/DIR_CLOSE/TEMP_UNLINK/
    // NOCLOBBER_PREVALIDATE env var a test set to target a LATER, unrelated
    // publishReplace/publishNoClobber call inside the actual command handler
    // (e.g. cmdLeaseHeartbeat's own active-lease refresh, or
    // cmdPublishRequest's own plan_ref/routing-policy/subject-bundle/
    // request.json writes) -- see publishNoClobber's own doc comment for both
    // options. Test-instrumentation-scope only; zero effect in production
    // (every underlying isXFaultActive predicate is itself
    // isTestCapability()-gated regardless of either flag) -- every real
    // durability/replay/security check this write performs is completely
    // unaffected.
    publishNoClobber(consumedPath, Buffer.from(canonicalJSONStringify({ consumed_at: nowIso() }), 'utf8'), {
      suppressReplacePostRenameFaultInjection: true,
      suppressInternalFaultInjection: true,
    });
  } catch (err) {
    // publishNoClobber (called here with no allowIdenticalIdempotent/raceDetailCode
    // option) throws CliError(INVALID, AUTHORITY_INVALID, 'no-clobber race lost for
    // ...') ONLY for a genuine EEXIST collision whose own loser-cleanup succeeded --
    // i.e. exactly a replay of an already-consumed grant. Every OTHER failure mode it
    // can throw for this call shape -- DURABILITY_UNPROVEN (barrier/temp-harden/
    // post-publish-revalidation faults, including the shared assertDurableTargetMatches
    // fault-injection seams used by LOCK-10/UMASK-0600-03), SECURITY_INVALID (symlink/
    // tamper), or a raw non-CliError fs error -- is NOT a replay and must propagate
    // with its own real classification, never be relabeled as one (confirmed by
    // reading publishNoClobber's complete body: AUTHORITY_INVALID is unreachable from
    // any other branch when allowIdenticalIdempotent is unset, as it always is here).
    if (err instanceof CliError && err.detailCode === 'AUTHORITY_INVALID') {
      throw new CliError('INVALID', 'AUTHORITY_INVALID', 'role-command-grant already consumed (replay)');
    }
    throw err;
  }
}

// M6+M7 requester-authority closure (Group B): the closed null/non-null
// requester-grant-scope table (PLAN.md ~L592). Administrative/pre-request
// subcommands and a session-shutdown worker-stop carry no transaction scope
// at all; every other requester subcommand binds the exact request and its
// CURRENT authoritative attempt/epoch.
const REQUESTER_GRANT_NULL_SCOPE_SUBCOMMANDS = new Set([
  'root-init', 'root-validate', 'validate', 'publish-blob', 'publish-request',
]);
const REQUESTER_GRANT_TRANSACTIONAL_SUBCOMMANDS = new Set([
  'dispatch', 'takeover', 'await-result', 'accept-result', 'transaction-ack',
  'cancel', 'cleanup', 'record-delivery', 'worker-stop',
]);

// M7 GREEN section 4.10: the consultation-local shape table + duplicate
// correlation logic this used to be is superseded and removed -- delegates
// entirely to the ONE canonical rll.validateRootSourceIngressRecord instead
// (M7 section 6/12: every duplicated per-family shape-checker is superseded
// by the shared validator).
function readRootSourceIngressOrThrow(validated) {
  let rll;
  try { rll = require('./runtime-role-lifecycle.cjs'); }
  catch (err) { throw new CliError('INVALID', 'AUTHORITY_INVALID', 'root-source lifecycle unavailable'); }
  const ingressPath = rll.rootSourceIngressPathFor({ repoId: validated.repoId }, validated.bindingId);
  const read = rll.readRegistryRecord(ingressPath);
  if (!read || read.ok !== true) throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'root-source ingress read failed');
  if (read.absent) return null;
  const binding = validated.binding;
  const checked = rll.validateRootSourceIngressRecord(read.obj, {
    binding_id: binding.binding_id, action_id: binding.action_id,
    source_role: binding.role, requester_instance_id: binding.actor_instance_id,
    subject_scope_digest: binding.subject_scope_digest, request_expiry: binding.request_expiry,
    worktree_id: binding.worktree_id, plan_digest: binding.plan_digest,
  });
  if (!checked.ok) throw new CliError('INVALID', 'AUTHORITY_INVALID', 'root-source ingress does not correlate to its binding');
  return checked.record;
}

function enforceRootSourceGrantBoundary(validated, command, flags, expectedScope) {
  if (validated.bindingSchema !== ROOT_SOURCE_BINDING_SCHEMA_LOCAL && validated.bindingSchema !== ROOT_SOURCE_BINDING_SCHEMA_V2) return;
  const ingress = readRootSourceIngressOrThrow(validated);
  if (ingress === null) {
    if (!ROOT_SOURCE_PRE_INGRESS_COMMANDS.has(command)) {
      throw new CliError('INVALID', 'AUTHORITY_INVALID', 'root-source command is not admitted before ingress');
    }
    if (validated.requestId !== null || validated.attemptId !== null || validated.leaseEpoch !== null) {
      throw new CliError('INVALID', 'AUTHORITY_INVALID', 'pre-ingress root-source grant must have null transaction scope');
    }
    if (command === 'publish-request') {
      const intent = decodeIntentOrThrow(flags.intent);
      let lifecycleIntent;
      try {
        const rll = require('./runtime-role-lifecycle.cjs');
        lifecycleIntent = rll.decodeRootSourceBootstrapIntentForBinding(
          { repoId: validated.repoId }, validated.binding,
        );
      } catch (err) {
        lifecycleIntent = { ok: false, reason: 'root-source-bootstrap-decoder-unavailable' };
      }
      if (!lifecycleIntent || lifecycleIntent.ok !== true || !lifecycleIntent.intent) {
        throw new CliError('INVALID', 'AUTHORITY_INVALID', 'root-source bootstrap intent is not host-accredited');
      }
      const expectedIntent = lifecycleIntent.intent;
      if (
        intent.target_role !== 'arch-platform' || intent.target_role !== expectedIntent.target_role
        || intent.parent_request_id !== undefined || intent.content_ref !== undefined
        || intent.question !== expectedIntent.question
        || intent.expected_result_kind !== expectedIntent.expected_result_kind
        || intent.expiry !== expectedIntent.expiry
        || intent.expiry !== validated.binding.request_expiry
      ) throw new CliError('INVALID', 'AUTHORITY_INVALID', 'root-source publish intent violates its exact root topology/target/expiry');
      const planPath = resolveAbsolute(flags.plan);
      // S16-ROOT-SOURCE-E2E finding: subject_bundle_ref is a coordination-
      // root-RELATIVE ref (s16CoordinationRelativeRef's own output, mirrored
      // by every other reader of a *_ref field in this file, e.g.
      // requestPathFor(planRoot, ...) below) -- resolveAbsolute() alone
      // resolves it against the CLI process's cwd, not the coordination
      // root, so it could never equal the caller's own absolute
      // --subject-bundle path for any cwd other than the coordination root
      // itself. Join it against the same --coordination-root every other
      // check in this function already trusts.
      const coordRootForScope = resolveAbsolute(flags['coordination-root']);
      if (
        resolveAbsolute(flags['subject-bundle']) !== path.join(coordRootForScope, validated.binding.subject_bundle_ref)
        || sha256File(planPath) !== validated.binding.plan_digest
      ) throw new CliError('INVALID', 'AUTHORITY_INVALID', 'root-source publish intent violates its PLAN/subject scope');
    }
    return;
  }
  if (!ROOT_SOURCE_POST_INGRESS_COMMANDS.has(command)) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'root-source command is not admitted after ingress');
  }
  if (
    expectedScope.requestId !== ingress.request_id
    || expectedScope.sourceRole !== ingress.source_role
    || expectedScope.requesterInstanceId !== ingress.requester_instance_id
    || validated.requestId !== ingress.request_id
  ) throw new CliError('INVALID', 'AUTHORITY_INVALID', 'root-source post-ingress grant does not match its sole transaction');

  // M7 defect (task #30, symmetric to validateAndConsumeRoleCommandGrantForCommand's
  // own one-shot terminal recheck a few dozen lines below in the same file):
  // a root-source-backed requester grant minted while its transaction was
  // still live becomes stale the instant a terminal (ack or cancel) lands
  // afterward -- re-checked here, immediately before this function returns
  // control for consumption. Mirrors readRootSourceTerminalArtifacts's own
  // ack/cancel pair (never "result", a different concept at the root-source
  // layer). ackPathFor has no audited call-site count (unlike
  // cancelPathFor/CANCEL-AUDIT-02) so a direct presence-only
  // classifyDurableRead is used, symmetric with the one-shot fix's own
  // unaudited resultState check; cancelPathFor still goes through the one
  // sanctioned choke point. flags.request/--coordination-root are already
  // proven resolvable -- resolveRequesterGrantScope (this function's own
  // caller, immediately above) required both to reach expectedScope.ok.
  const requesterTxnDir = path.dirname(resolveAbsolute(flags.request));
  const ackState = classifyDurableRead(ackPathFor(requesterTxnDir), { parse: true });
  if (ackState.state === DURABLE_PENDING) {
    throw new CliError('INVALID', 'DURABILITY_UNPROVEN', command + ': root-source ack terminal is pending, durability unproven');
  }
  const cancelPresent = readCanonicalCancelRecordOptional(cancelPathFor(requesterTxnDir), resolveAbsolute(flags['coordination-root'])) !== null;
  if (ackState.state !== DURABLE_ABSENT || cancelPresent) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', command + ': role-command-grant backing root-source transaction already has a terminal (ack or cancel)');
  }
}

/**
 * M6+M7 requester-authority closure (Group B): the SINGLE shared resolver
 * for a requester subcommand's exact required request_id/attempt_id/
 * lease_epoch scope, plus (when a request already exists) its own
 * source_role/requester_instance_id -- used BOTH by the hook (to mint a
 * grant bound to the correct scope) and by this file's own main() (to
 * re-derive and cross-check the SAME scope before consuming a presented
 * grant, never trusting the grant's own claimed fields alone). Reuses the
 * existing accredited-request-read primitive and resolveAuthoritativeAttempt
 * -- never a second, weaker ad hoc parse. `record-delivery`'s own additional
 * "argv attempt/epoch must equal both the grant and current transaction"
 * requirement is satisfied by composition: this resolver already binds the
 * grant to the current authoritative attempt/epoch, and cmdRecordDelivery's
 * own existing, independent business logic already requires its
 * --attempt/--epoch argv to equal that SAME current authoritative pair.
 * @param {string} subcommand
 * @param {object} flags - parseFlags()-shaped (or an equivalent plain
 *   object carrying the SAME bare-flag-name keys a hook constructs from its
 *   own parsed argv).
 * @returns {{ok:true,requestId:string|null,attemptId:string|null,leaseEpoch:number|null,sourceRole:string|null,requesterInstanceId:string|null}|{ok:false,reason:string}}
 */
function resolveRequesterGrantScope(subcommand, flags) {
  if (REQUESTER_GRANT_NULL_SCOPE_SUBCOMMANDS.has(subcommand)) {
    return { ok: true, requestId: null, attemptId: null, leaseEpoch: null, sourceRole: null, requesterInstanceId: null };
  }
  if (subcommand === 'worker-stop' && flags && flags.kind === 'session-shutdown') {
    return { ok: true, requestId: null, attemptId: null, leaseEpoch: null, sourceRole: null, requesterInstanceId: null };
  }
  if (!REQUESTER_GRANT_TRANSACTIONAL_SUBCOMMANDS.has(subcommand)) {
    return { ok: false, reason: 'unrecognized-requester-subcommand' };
  }
  if (!flags || typeof flags.request !== 'string' || flags.request.length === 0) {
    return { ok: false, reason: 'missing-request-flag' };
  }
  if (typeof flags['coordination-root'] !== 'string' || flags['coordination-root'].length === 0) {
    return { ok: false, reason: 'missing-coordination-root-flag' };
  }
  let coordRoot;
  let requestPath;
  try {
    coordRoot = resolveAbsolute(flags['coordination-root']);
    requestPath = resolveAbsolute(flags.request);
  } catch (err) {
    return { ok: false, reason: 'invalid-scope-path' };
  }
  let preflight;
  try {
    preflight = accreditCanonicalRequest(coordRoot, requestPath);
  } catch (err) {
    // Preserve the specific accreditation failure (e.g. SECURITY_INVALID for
    // a path-segment mismatch, CORRELATION_INVALID for an unresolvable
    // request) so the caller below can surface it instead of a generic
    // AUTHORITY_INVALID -- only for the well-known CliError shape; any other
    // throw keeps the existing generic-only reason (fail safe, never assume
    // an unverified shape).
    if (err instanceof CliError) {
      return { ok: false, reason: 'request-not-accredited', status: err.status, detailCode: err.detailCode, message: err.message };
    }
    return { ok: false, reason: 'request-not-accredited' };
  }
  const reqObj = preflight.obj;
  const txnDir = path.dirname(requestPath);
  let auth;
  try {
    auth = resolveAuthoritativeAttempt(reqObj, txnDir);
  } catch (err) {
    return { ok: false, reason: 'attempt-not-resolvable' };
  }
  return {
    ok: true,
    requestId: reqObj.request_id,
    attemptId: auth.attemptId,
    leaseEpoch: auth.leaseEpoch,
    sourceRole: reqObj.source_role,
    requesterInstanceId: reqObj.requester_instance_id,
  };
}

/**
 * Generic entry point called from main() BEFORE the command handler runs
 * (PLAN.md ~L604: "before any read or mutation"). No-op for any command
 * outside ROLE_COMMAND_GRANT_AUTHORITY_FOR_COMMAND's deliberately narrow
 * scope. `rawArgv` is the exact pre-parseFlags flag-token array (argv.slice(1)
 * in main()) -- the grant flag+value pair is located and stripped from it
 * here, and the remainder, in original relative order, is re-hashed and
 * compared against the grant's own canonical_argv_digest (PLAN.md ~L604:
 * "strips only its own injected flag, recomputes the exact pre-injection
 * argv digest").
 */
function validateAndConsumeRoleCommandGrantForCommand(command, flags, rawArgv) {
  const authority = ROLE_COMMAND_GRANT_AUTHORITY_FOR_COMMAND[command];
  if (!authority) return undefined; // not grant-gated in this pass's scope.
  const grantFlagBare = ROLE_COMMAND_GRANT_FLAG_FOR_AUTHORITY[authority];
  const grantFlagToken = '--' + grantFlagBare;

  const idx = rawArgv.indexOf(grantFlagToken);
  if (idx === -1 || idx + 1 >= rawArgv.length) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'missing required --' + grantFlagBare + ' for ' + command);
  }
  if (rawArgv.indexOf(grantFlagToken, idx + 1) !== -1) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'duplicate --' + grantFlagBare);
  }
  const grantId = rawArgv[idx + 1];
  const preInjectionArgv = rawArgv.slice(0, idx).concat(rawArgv.slice(idx + 2));
  const argvDigest = sha256String(canonicalJSONStringify(preInjectionArgv));

  const coordRootRaw = flags['coordination-root'];
  if (typeof coordRootRaw !== 'string' || coordRootRaw.length === 0) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', command + ' requires --coordination-root to resolve grant scope');
  }
  const coordRoot = resolveAbsolute(coordRootRaw);

  let repoId;
  try {
    const { real } = realpathDeepestExisting(coordRoot);
    repoId = computeRepoId(real);
  } catch (err) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'unable to resolve role-command-grant registry scope for ' + command);
  }

  // Validate the durable grant and its backing binding without mutating the
  // one-shot consumption state. Requester transaction scope is independently
  // re-derived below before the consumption marker is allowed to exist.
  const validated = validateRoleCommandGrantOrThrow(repoId, grantId, argvDigest, authority, command);

  // M6+M7 requester-authority closure (Group B): the grant's own scope
  // fields are re-derived HERE, independently, from the CURRENT transaction
  // state -- never merely trusted as whatever was embedded at mint time.
  // Only 'requester' authority carries this exact scope contract; 'target'
  // authority is a disjoint schema this file does not mint.
  if (authority === 'requester') {
    const expectedScope = resolveRequesterGrantScope(command, flags);
    if (!expectedScope.ok) {
      // Re-surface the specific underlying accreditation failure when one is
      // available (see resolveRequesterGrantScope's own catch block) rather
      // than collapsing every failure reason to a generic AUTHORITY_INVALID.
      // The other resolveRequesterGrantScope failure reasons (missing-request
      // -flag, missing-coordination-root-flag, invalid-scope-path,
      // attempt-not-resolvable, unrecognized-requester-subcommand) never set
      // detailCode -- those are genuinely grant-scope-level problems, not the
      // underlying request's own validity, so they keep the generic behavior.
      if (expectedScope.detailCode) {
        throw new CliError(expectedScope.status, expectedScope.detailCode, expectedScope.message || ('unable to re-derive requester grant scope for ' + command));
      }
      throw new CliError('INVALID', 'AUTHORITY_INVALID', 'unable to re-derive requester grant scope for ' + command + ': ' + expectedScope.reason);
    }
    if (
      validated.requestId !== expectedScope.requestId
      || validated.attemptId !== expectedScope.attemptId
      || validated.leaseEpoch !== expectedScope.leaseEpoch
    ) {
      throw new CliError('INVALID', 'AUTHORITY_INVALID', 'role-command-grant request/attempt/epoch does not match the current authoritative transaction');
    }
    if (expectedScope.sourceRole !== null && expectedScope.sourceRole !== validated.role) {
      throw new CliError('INVALID', 'AUTHORITY_INVALID', 'role-command-grant role does not match the request\'s own source_role');
    }
    if (expectedScope.requesterInstanceId !== null && expectedScope.requesterInstanceId !== validated.actorInstanceId) {
      throw new CliError('INVALID', 'AUTHORITY_INVALID', 'role-command-grant actor does not match the request\'s own requester_instance_id');
    }
    enforceRootSourceGrantBoundary(validated, command, flags, expectedScope);
  }

  // M7 defect 5 (section 7): "validateAndConsumeRoleCommandGrantForCommand
  // obtains and consumes a consume-grant capability immediately before its
  // existing one-use grant marker, then returns it only to that in-process
  // handler invocation." Only a Claude v2-backed grant (requester/
  // root-source/one-shot, and for requester only when its own backing runs
  // on the claude-hook provider -- defect 11) goes through the classifier
  // pass; RoleActor/Codex-supervisor-backed grants keep their existing,
  // unchanged consumption path. The schema literals below are this file's
  // own frozen M7 v2 schema strings (section 4.1/4.2/4.3) -- runtime-role-
  // lifecycle.cjs does not export these as constants, only `bindingSchema`
  // (a plain string already returned by validateRoleCommandGrantOrThrow).
  const rllForConsumeGrant = require('./runtime-role-lifecycle.cjs');
  const claudeAuthorityFamily = (
    validated.bindingSchema === 'runtime/root-source-binding/v2' ? 'root-source'
      : validated.bindingSchema === 'runtime/claude-one-shot-binding/v2' ? 'one-shot'
        : validated.bindingSchema === 'coordination/requester-binding/v2' ? 'requester'
          : null
  );
  const isClaudeAuthorityV2Backing = (
    claudeAuthorityFamily === 'root-source' || claudeAuthorityFamily === 'one-shot'
    || (claudeAuthorityFamily === 'requester' && validated.binding.runtime === 'claude-hook')
  );

  let consumeCapability = null;
  if (isClaudeAuthorityV2Backing) {
    // M7 CORRECTION C2 (Codex final ruling, frozen contract SHA
    // 3341aff5c7ce1e7953bc82084542750241274807ee2ed36e0365095c7249e6a6):
    // resolve canonical PROJECT scope and prove --coordination-root really
    // is the canonical coordination root for it -- admission must receive
    // project scope only, never a bare {repoId} descriptor or any
    // caller-selected path/terminal summary.
    let projectRoot;
    let coordRootExistingAncestor;
    let coordRootTail;
    try {
      // coordRoot itself may not exist yet (e.g. root-init's own job is to
      // create it) -- resolve against the deepest EXISTING ancestor, exactly
      // like the repoId derivation above, never `git -C` on a possibly-
      // nonexistent leaf.
      const resolved = realpathDeepestExisting(coordRoot);
      coordRootExistingAncestor = resolved.real;
      coordRootTail = resolved.tail;
      projectRoot = gitRevParse(coordRootExistingAncestor, ['rev-parse', '--show-toplevel']);
    } catch (err) {
      throw new CliError('INVALID', 'AUTHORITY_INVALID', command + ': unable to resolve project scope from --coordination-root');
    }
    let canonicalCoordRoot;
    try {
      canonicalCoordRoot = rllForConsumeGrant.coordinationRootPathFor(projectRoot);
    } catch (err) {
      throw new CliError('INVALID', 'AUTHORITY_INVALID', command + ': unable to resolve canonical coordination root for its own project');
    }
    // coordRoot itself may not exist yet (root-init's own job is to create
    // it), so a naive realpathOrSelf(coordRoot) silently skips desymlinking
    // whenever ANY path segment is still missing -- on a platform where a
    // temp-dir prefix is itself a symlink (e.g. macOS /var -> /private/var),
    // that wrongly rejected a genuinely-canonical --coordination-root as
    // non-canonical, because canonicalCoordRoot's own deepest-existing-
    // ancestor resolution (coordinationRootPathFor) DOES desymlink that
    // exact prefix. Reconstruct coordRoot's own fully-resolved-as-far-as-
    // possible form the SAME way (mirrors assertGenuinelyConfinedUnderRoot's
    // own fullReal pattern, this file) before comparing.
    const coordRootFullyResolved = coordRootTail.length
      ? path.join(coordRootExistingAncestor, ...coordRootTail)
      : coordRootExistingAncestor;
    if (realpathOrSelf(canonicalCoordRoot) !== coordRootFullyResolved) {
      throw new CliError('INVALID', 'SECURITY_INVALID', command + ': --coordination-root is not the canonical coordination root for its own project');
    }

    // M7 CORRECTION C2: fd-accredit --request (when present -- worker-
    // stop-ack and the null-scope requester admin subcommands never carry
    // it) and correlate its OWN embedded scope against the validated grant
    // + backing binding BEFORE admission. Closes the confirmed argv-digest
    // decoupling exploit: mintRoleCommandGrant's argvDigest parameter is
    // caller-supplied and fully decoupled from its own requestId/attemptId/
    // leaseEpoch parameters, so a grant can be minted with requestId=A
    // (real) but an argv whose --request names an unrelated decoy
    // transaction B; a real CLI call using --request B then passes
    // validateRoleCommandGrantOrThrow cleanly (digest matches B), yet
    // nothing else ever proved THIS invocation's own --request is the SAME
    // transaction the grant's stored requestId names.
    if (typeof flags.request === 'string' && flags.request.length > 0) {
      let accreditedRequest;
      let requestPathForAccreditation;
      try {
        requestPathForAccreditation = resolveAbsolute(flags.request);
        accreditedRequest = accreditCanonicalRequest(coordRoot, requestPathForAccreditation);
      } catch (err) {
        throw new CliError('INVALID', 'AUTHORITY_INVALID', command + ': unable to accredit --request');
      }
      const accreditedReqObj = accreditedRequest.obj;
      const accreditedTxnDir = path.dirname(requestPathForAccreditation);
      let accreditedAuth;
      try {
        accreditedAuth = resolveAuthoritativeAttempt(accreditedReqObj, accreditedTxnDir);
      } catch (err) {
        throw new CliError('INVALID', 'AUTHORITY_INVALID', command + ": --request's authoritative attempt is not resolvable");
      }
      const expectedRoleField = authority === 'requester' ? accreditedReqObj.source_role : accreditedReqObj.target_role;
      // M7 GREEN correction round 2, R2: the classifier itself deliberately
      // does not filter candidates by worktree (a current unexpired v2
      // record is a candidate "even when its PLAN/worktree/role differs"),
      // so THIS Phase A correlation is the only layer that can reject a
      // cross-worktree replay -- confirmed by direct read that this block
      // previously checked repo_id/plan_digest/request_id/attempt_id/
      // lease_epoch/role but never worktree_id at all. Triple-correlates the
      // binding's own worktree_id, the accredited request's own worktree
      // field (subject_worktree_id for target authority,
      // requester_worktree_id for requester authority), and the CURRENT
      // project's own live worktree -- never merely two of the three.
      const expectedWorktreeField = authority === 'requester' ? accreditedReqObj.requester_worktree_id : accreditedReqObj.subject_worktree_id;
      if (
        accreditedReqObj.repo_id !== repoId || accreditedReqObj.plan_digest !== validated.binding.plan_digest
        || accreditedReqObj.request_id !== validated.requestId
        || accreditedAuth.attemptId !== validated.attemptId || accreditedAuth.leaseEpoch !== validated.leaseEpoch
        || expectedRoleField !== validated.role
        || expectedWorktreeField !== validated.binding.worktree_id
        || expectedWorktreeField !== computeWorktreeId(projectRoot)
      ) {
        throw new CliError('INVALID', 'AUTHORITY_INVALID', command + ': accredited --request does not correlate to the validated role-command-grant');
      }
    }

    const agentIdForIdentity = validated.binding.agent_key !== undefined ? validated.binding.agent_key : validated.binding.agent_id;
    const consumeAuthorityIdentity = {
      schema: rllForConsumeGrant.CLAUDE_AUTHORITY_IDENTITY_SCHEMA, provider: 'claude-hook',
      repo_id: repoId, runtime_session_key: validated.binding.runtime_session_key, agent_id: agentIdForIdentity,
    };
    // M7 CORRECTION C1 (Codex final ruling): the ONE authority
    // linearization point is successful final admission -- this rendezvous
    // now sits immediately before admission, after ALL Phase A validation
    // (grant, requester-scope, and the --request accreditation/correlation
    // above) has fully run.
    testM7Rendezvous('command-before-admission', coordRoot);
    // M7 GREEN section 4.4 (R15-GRANT-EXPIRY-IS-CONSUME-DEADLINE): the
    // consume-grant deadline is the durable GRANT's own expiry, never the
    // backing binding's -- a long-lived binding must never let a
    // short-lived (<=30s TTL) grant be consumed past its own expiry.
    const admission = rllForConsumeGrant.admitClaudeAuthorityOperation(
      projectRoot, consumeAuthorityIdentity, 'consume-grant', validated.grantExpiry,
      { family: claudeAuthorityFamily, bindingId: validated.bindingId },
    );
    if (!admission.ok) {
      throw new CliError('INVALID', 'AUTHORITY_INVALID', 'role-command-grant consume-grant admission failed: ' + admission.reason);
    }
    consumeCapability = admission.capability;
  }

  // M7 section 10.3 (M7-COMMAND-ADMISSION-RACE-15 positive control) / M7
  // CORRECTION C1: this rendezvous stays in its ORIGINAL position -- AFTER
  // admission (the ONE authority linearization point; its own fence/
  // classifier/terminal decision is now frozen) and BEFORE consumption. A
  // cut landing during this exact pause must NEVER retroactively deny an
  // already-admitted command -- no recheck of any kind runs here anymore.
  testM7Rendezvous('command-after-admission-before-consume', coordRoot);

  if (isClaudeAuthorityV2Backing) {
    const guardedResult = rllForConsumeGrant.writeGuardedByClaudeAuthorityAdmission(consumeCapability, 'consume-grant', () => {
      consumeValidatedRoleCommandGrantOrThrow(repoId, grantId);
      return { ok: true };
    });
    if (!guardedResult.ok) {
      throw new CliError('INVALID', 'AUTHORITY_INVALID', 'role-command-grant consumption denied: ' + guardedResult.reason);
    }
  } else {
    consumeValidatedRoleCommandGrantOrThrow(repoId, grantId);
  }
  return validated;
}

// ─────────────────────────────────────────────────────────────────────────────
// Retained Codex host capability (PLAN §15b) -- non-serializable and held only
// by runtime-bridge-codex.cjs.  The capability object carries no enumerable
// authority data; its exact scope lives solely in this module-private WeakMap.
// ─────────────────────────────────────────────────────────────────────────────

const hostBridgeCapabilityScopes = new WeakMap();
const hostBridgeCommittedTurnIds = new WeakMap();
const HOST_BRIDGE_SCOPE_KEYS = Object.freeze([
  'actorInstanceId', 'expiresAt', 'planDigest', 'projectRoot', 'role',
  'supervisorInstanceId', 'workerSessionId', 'worktreeId',
].sort());
const HOST_BRIDGE_ID_RE = /^[a-f0-9]{32}$/;

// M6+M7 SIXTEENTH CIERRE DEFINITIVO Phase 1 follow-up: requireHostBridgeCapability
// (hence every rc.hostBridge* call pollRetainedWorkers makes, several times
// per worker per ~250ms tick) reaches here on EVERY invocation, and this
// function independently spawns `git rev-parse` twice more (once directly,
// once again inside computeWorktreeId with the byte-identical
// '--show-toplevel' args) -- a SEPARATE redundant-git-spawn source from
// resolveLiveCodexAppServerWorkerUncached's own (already memoized, see
// runtime-bridge-codex.cjs), not fixed by that change. Measured live (a
// running retained supervisor's own POLLTICK/worker-start timing dump):
// per-worker tick time up to ~5s even after that first fix, matching NO-GO
// Correction B's own historical "~5s for a worker servicing a root-consult
// intent" figure almost exactly -- this is the remaining source. Same
// safety argument as that fix: scope.projectRoot's own git worktree
// toplevel cannot change for the life of this process, so this is a pure,
// immutable derivation (permitted), memoized once, forever, per distinct
// projectRoot string -- never a TTL, and never covering discoverPlan (plan
// CONTENT) or anything about owner/PID/birth/binding/presence/lease, all of
// which stay fully fresh on every call exactly as before.
const projectRealOnceForScope = new Map();
function resolveProjectGitFactsOnceForScope(projectRoot) {
  const sealed = resolveSealedGitCache(projectRealOnceForScope, projectRoot, (root) => {
    const projectReal = gitRevParse(root, ['rev-parse', '--show-toplevel']);
    const gitCommonDirReal = realpathOrSelf(gitRevParse(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']));
    return { ok: true, projectReal, gitCommonDirReal, worktreeId: computeWorktreeId(projectReal) };
  });
  // Preserves this function's pre-existing throw-on-failure contract (its
  // one caller below already wraps it in try/catch) -- a sealed-cache
  // rejection (unresolvable OR a topology-seal mismatch) is exactly as fatal
  // to this caller as the git spawn itself throwing always was.
  if (!sealed.ok) throw new Error(sealed.reason);
  return { projectReal: sealed.derived.projectReal, worktreeId: sealed.derived.worktreeId };
}

function validateHostBridgeCapabilityScopeInput(scope, requireLiveWorker) {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope) || !hasExactKeys(scope, HOST_BRIDGE_SCOPE_KEYS)) {
    return { ok: false, reason: 'host-bridge-scope-shape-invalid' };
  }
  if (
    typeof scope.projectRoot !== 'string' || !path.isAbsolute(scope.projectRoot)
    || !GRANT_CANONICAL_ROLES.includes(scope.role)
    || !HOST_BRIDGE_ID_RE.test(scope.supervisorInstanceId)
    || !HOST_BRIDGE_ID_RE.test(scope.workerSessionId)
    || !HOST_BRIDGE_ID_RE.test(scope.actorInstanceId)
    || !isHex64(scope.worktreeId) || !isHex64(scope.planDigest)
    || !isIsoTimestamp(scope.expiresAt) || Date.now() >= isoToMs(scope.expiresAt)
  ) return { ok: false, reason: 'host-bridge-scope-value-invalid' };

  let projectReal;
  let worktreeId;
  let rll;
  try {
    ({ projectReal, worktreeId } = resolveProjectGitFactsOnceForScope(scope.projectRoot));
    rll = require('./runtime-role-lifecycle.cjs');
  } catch (err) {
    return { ok: false, reason: 'host-bridge-project-unresolvable' };
  }
  const plan = rll.discoverPlan(projectReal);
  if (!plan.ok) return { ok: false, reason: 'host-bridge-plan-unresolvable' };
  if (
    worktreeId !== scope.worktreeId
    || plan.planDigest !== scope.planDigest
  ) return { ok: false, reason: 'host-bridge-scope-not-current' };
  let live = null;
  if (requireLiveWorker === true) {
    let bridge;
    try {
      bridge = require('./runtime-bridge-codex.cjs');
      live = bridge.resolveLiveCodexAppServerWorker(projectReal, scope.role);
    } catch (err) {
      return { ok: false, reason: 'host-bridge-worker-proof-unresolvable' };
    }
    if (!live || live.ok !== true || live.available !== true || !live.worker) {
      return { ok: false, reason: 'host-bridge-worker-not-live:' + ((live && live.reason) || 'unresolved') };
    }
    if (
      live.worker.pid !== process.pid
      || live.worker.worktreeId !== scope.worktreeId
      || live.worker.planDigest !== scope.planDigest
      || live.worker.role !== scope.role
      || live.worker.supervisorInstanceId !== scope.supervisorInstanceId
      || live.worker.workerSessionId !== scope.workerSessionId
    ) return { ok: false, reason: 'host-bridge-worker-process-mismatch' };
  }
  return { ok: true, projectReal, live };
}

/**
 * Mints one in-memory-only HostBridgeCapability.  The caller receives an
 * opaque frozen object; JSON/string/argv/disk cannot reconstruct its WeakMap
 * identity.  All transaction methods below revalidate current PLAN/worktree,
 * request/activation/attempt/epoch before invoking the canonical writers.
 */
function createHostBridgeCapability(scope) {
  // Minting is allowed only inside the exact retained supervisor process
  // corroborated by the live worker proof.  Exporting this factory for the
  // sibling bridge module does not make it an ambient mint primitive for an
  // unrelated Node process that merely knows the public scope fields.
  const validated = validateHostBridgeCapabilityScopeInput(scope, true);
  if (!validated.ok) return validated;
  const capability = Object.freeze(Object.create(null));
  hostBridgeCapabilityScopes.set(capability, Object.freeze(Object.assign({}, scope, { projectRoot: validated.projectReal })));
  return { ok: true, capability };
}

// M6+M7 SIXTEENTH CIERRE DEFINITIVO Phase 1 follow-up: rootConsultIntentContext
// (below) used to call requireHostBridgeCapability for scope, THEN
// independently re-derive resolveLiveCodexAppServerWorker(scope.projectRoot,
// scope.role) a few lines later for the EXACT SAME (projectRoot, role) pair
// -- a second full owner/action/binding/processOwner/presence re-read within
// the SAME synchronous function, not across operations. Measured live (a
// running retained supervisor's own POLLTICK timing dump, after the git-
// facts memoization fixes above): the ONE role servicing an active root-
// consult intent still took ~5s per tick, versus ~1s for the four roles
// with no intent to advance -- this redundant re-derivation, repeated across
// hostBridgeListRootConsultIntents/hostBridgeAdvanceRootConsult/
// hostBridgeObserveAndCompleteRootConsult each tick, is that remaining cost.
// This variant returns the SAME live-worker proof requireHostBridgeCapability
// itself already computed, so a caller that needs it immediately after
// (rootConsultIntentContext) can pass it along explicitly instead of asking
// the OS/disk the identical question again a few lines later -- explicit
// per-operation reuse, never a cache surviving across two DECISIONS.
// requireHostBridgeCapability's own return shape (bare scope) is unchanged
// for its many other existing callers.
function requireHostBridgeCapabilityWithLiveWorker(capability) {
  const scope = hostBridgeCapabilityScopes.get(capability);
  if (!scope) throw new CliError('INVALID', 'AUTHORITY_INVALID', 'unknown HostBridgeCapability');
  const current = validateHostBridgeCapabilityScopeInput(scope, true);
  if (!current.ok) throw new CliError('INVALID', 'AUTHORITY_INVALID', current.reason);
  return { scope, live: current.live };
}

function requireHostBridgeCapability(capability) {
  const scope = hostBridgeCapabilityScopes.get(capability);
  if (!scope) throw new CliError('INVALID', 'AUTHORITY_INVALID', 'unknown HostBridgeCapability');
  const current = validateHostBridgeCapabilityScopeInput(scope, true);
  if (!current.ok) throw new CliError('INVALID', 'AUTHORITY_INVALID', current.reason);
  return scope;
}

function requireHostBridgeRequestScope(capability, coordRootRaw, requestPathRaw) {
  const scope = requireHostBridgeCapability(capability);
  const coordRoot = resolveAbsolute(coordRootRaw);
  const requestPath = resolveAbsolute(requestPathRaw);
  const accredited = accreditCanonicalRequest(coordRoot, requestPath);
  const reqObj = accredited.obj;
  const resolved = resolveActivationForRequestPath(requestPath);
  if (
    !resolved.ok || !resolved.activation
    || resolved.activation.selected_driver !== 'codex-app-server'
    || resolved.targetRole !== scope.role
    || resolved.worktreeId !== scope.worktreeId
    || resolved.planDigest !== scope.planDigest
    || reqObj.target_role !== scope.role
    || reqObj.target_role_profile_digest !== resolved.activation.target_role_profile_digest
  ) throw new CliError('INVALID', 'AUTHORITY_INVALID', 'HostBridgeCapability does not match the current Codex activation');
  return { scope, coordRoot, requestPath, reqObj, requestDigest: accredited.digest, resolved };
}

function hostBridgeClaim(capability, coordRoot, requestPath) {
  const checked = requireHostBridgeRequestScope(capability, coordRoot, requestPath);
  return cmdClaim({
    'coordination-root': checked.coordRoot,
    request: checked.requestPath,
    role: checked.scope.role,
    'worker-session': checked.scope.workerSessionId,
  }, {
    actorInstanceId: checked.scope.actorInstanceId,
    role: checked.scope.role,
    workerSessionId: checked.scope.workerSessionId,
    driver: 'codex-app-server',
    hostBridge: true,
  });
}

function hostBridgeLeaseHeartbeat(capability, coordRoot, requestPath, claimPath) {
  const checked = requireHostBridgeRequestScope(capability, coordRoot, requestPath);
  return cmdLeaseHeartbeat({
    'coordination-root': checked.coordRoot,
    request: checked.requestPath,
    claim: resolveAbsolute(claimPath),
  }, {
    actorInstanceId: checked.scope.actorInstanceId,
    role: checked.scope.role,
    workerSessionId: checked.scope.workerSessionId,
    driver: 'codex-app-server',
    hostBridge: true,
  });
}

function assertHostBridgeClaimMatches(checked, claimPath) {
  const txnDir = path.dirname(checked.requestPath);
  const auth = resolveAuthoritativeAttempt(checked.reqObj, txnDir);
  const canonicalClaimPath = claimPathFor(txnDir, auth.attemptId);
  if (path.resolve(claimPath) !== path.resolve(canonicalClaimPath)) {
    throw new CliError('INVALID', 'SECURITY_INVALID', 'host bridge claim is not canonical');
  }
  const claimRec = readClosedRecord(canonicalClaimPath, CLAIM_V1_FIELDS, {
    absentDetail: 'CORRELATION_INVALID', absentMessage: 'host bridge claim does not resolve',
  });
  if (
    claimRec.obj.request_id !== checked.reqObj.request_id
    || claimRec.obj.attempt_id !== auth.attemptId
    || claimRec.obj.lease_epoch !== auth.leaseEpoch
    || claimRec.obj.claimant_role !== checked.scope.role
    || claimRec.obj.claimant_instance_id !== checked.scope.actorInstanceId
    || claimRec.obj.worker_session_id !== checked.scope.workerSessionId
    || claimRec.obj.driver !== 'codex-app-server'
  ) throw new CliError('INVALID', 'AUTHORITY_INVALID', 'host bridge claim does not match capability/current activation');
  return { auth, claimRec, claimPath: canonicalClaimPath };
}

function hostBridgeScheduleTurn(capability, coordRoot, requestPath, claimPath) {
  const checked = requireHostBridgeRequestScope(capability, coordRoot, requestPath);
  const claim = assertHostBridgeClaimMatches(checked, resolveAbsolute(claimPath));
  const txnDir = path.dirname(checked.requestPath);
  // CANCEL-AUDIT-01: reads cancel.json ONLY through the sanctioned choke
  // point, never an inline shape-check -- also strictly stronger than a bare
  // shape check, since it additionally accredits the record (matches
  // request_id, cancelled_by/cancelled_at semantics) rather than trusting an
  // unaccredited-but-shape-valid file.
  if (readCanonicalCancelRecordOptional(cancelPathFor(txnDir), coordRoot) !== null) {
    throw new CliError('CANCELLED', 'TRANSACTION_CANCELLED', 'transaction is cancelled');
  }
  if (readJsonDurableOptional(acceptedResultPathFor(txnDir), { shape: (o) => assertClosedShape(o, ACCEPTED_RESULT_V1_FIELDS) }) !== null) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'transaction is already accepted');
  }
  if (readJsonDurableOptional(resultPathFor(txnDir, claim.auth.attemptId), { shape: (o) => assertClosedShape(o, RESULT_V2_FIELDS) }) !== null) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'transaction already has a current result');
  }
  const intent = {
    schema: 'coordination/activation-intent/v1',
    request_digest: checked.requestDigest,
    attempt_id: claim.auth.attemptId,
    lease_epoch: claim.auth.leaseEpoch,
    driver: 'codex-app-server',
    commit_point_pending: true,
    created_at: nowIso(),
  };
  const intentPath = activationIntentPathFor(txnDir, claim.auth.attemptId);
  publishNoClobber(intentPath, Buffer.from(canonicalJSONStringify(intent), 'utf8'), { raceDetailCode: 'AUTHORITY_INVALID' });
  return {
    ok: true,
    requestId: checked.reqObj.request_id,
    request: checked.reqObj,
    requestDigest: checked.requestDigest,
    attemptId: claim.auth.attemptId,
    leaseEpoch: claim.auth.leaseEpoch,
    claimPath: claim.claimPath,
    claimDigest: claim.claimRec.digest,
    intentPath,
  };
}

function hostBridgeRecordTurnStartAccepted(capability, coordRoot, requestPath, claimPath, turnId) {
  const checked = requireHostBridgeRequestScope(capability, coordRoot, requestPath);
  const claim = assertHostBridgeClaimMatches(checked, resolveAbsolute(claimPath));
  const txnDir = path.dirname(checked.requestPath);
  const intentPath = activationIntentPathFor(txnDir, claim.auth.attemptId);
  const intentRec = readClosedRecord(intentPath, ACTIVATION_INTENT_V1_FIELDS, {
    absentDetail: 'CORRELATION_INVALID', absentMessage: 'Codex activation intent does not resolve',
  });
  if (
    intentRec.obj.request_digest !== checked.requestDigest
    || intentRec.obj.attempt_id !== claim.auth.attemptId
    || intentRec.obj.lease_epoch !== claim.auth.leaseEpoch
    || intentRec.obj.driver !== 'codex-app-server'
    || intentRec.obj.commit_point_pending !== true
  ) throw new CliError('INVALID', 'AUTHORITY_INVALID', 'Codex activation intent is not current');
  let byRequest = null;
  if (turnId !== undefined) {
    if (!isNonEmptyString(turnId) || utf8ByteLength(turnId) > 512) {
      throw new CliError('INVALID', 'SCHEMA_INVALID', 'host bridge turn id is invalid');
    }
    byRequest = hostBridgeCommittedTurnIds.get(capability);
    const existing = byRequest && byRequest.get(checked.reqObj.request_id);
    if (existing !== undefined && existing !== turnId) {
      throw new CliError('INVALID', 'AUTHORITY_INVALID', 'host bridge delivery already binds a different first turn');
    }
  }
  const delivery = {
    schema: 'coordination/delivery/v1',
    request_id: checked.reqObj.request_id,
    attempt_id: claim.auth.attemptId,
    lease_epoch: claim.auth.leaseEpoch,
    driver: 'codex-app-server',
    claim_digest: claim.claimRec.digest,
    commit_point: 'turn-start-accepted',
    commit_point_at: nowIso(),
    created_at: nowIso(),
    delivered: true,
    outcome: 'possibly-delivered',
    detail_code: 'NONE',
  };
  assertClosedShape(delivery, DELIVERY_V1_FIELDS);
  const deliveryPath = deliveryPathFor(txnDir, claim.auth.attemptId);
  publishNoClobber(deliveryPath, Buffer.from(canonicalJSONStringify(delivery), 'utf8'), { raceDetailCode: 'AUTHORITY_INVALID' });
  if (turnId !== undefined) {
    if (!byRequest) {
      byRequest = new Map();
      hostBridgeCommittedTurnIds.set(capability, byRequest);
    }
    byRequest.set(checked.reqObj.request_id, turnId);
  }
  return { ok: true, requestId: checked.reqObj.request_id, deliveryPath };
}

function ensureUtf8Bytes(value, maxBytes, label) {
  if (!Buffer.isBuffer(value) || value.length === 0 || value.length > maxBytes) {
    throw new CliError('INVALID', 'SCHEMA_INVALID', label + ' bytes are missing or exceed the bound');
  }
  try {
    // TextDecoder's fatal mode rejects malformed byte sequences instead of
    // silently normalizing them through U+FFFD.
    new TextDecoder('utf-8', { fatal: true }).decode(value);
  } catch (err) {
    throw new CliError('INVALID', 'SCHEMA_INVALID', label + ' bytes are not valid UTF-8');
  }
  return Buffer.from(value);
}

function publishEvidenceBlob(planRoot, bytes) {
  const digest = sha256Buffer(bytes);
  const blobPath = blobPathFor(planRoot, digest);
  const receipt = publishNoClobber(blobPath, bytes, { allowIdenticalIdempotent: true });
  assertArtifactMatchesReceipt(blobPath, receipt, bytes);
  return { blob: digest, digest, size: bytes.length };
}

/**
 * Sixteenth §16c host-only evidence writer.  External bytes are accepted only
 * in-process behind a current HostBridgeCapability/current claim, stored in
 * the digest-addressed blob store, and then correlated under the transaction
 * transition lock.  No serialized CLI surface can call this primitive.
 */
function hostBridgePublishPatternEvidence(capability, coordRoot, requestPath, claimPath, input) {
  const checked = requireHostBridgeRequestScope(capability, coordRoot, requestPath);
  const preClaim = assertHostBridgeClaimMatches(checked, resolveAbsolute(claimPath));
  if (checked.reqObj.target_role !== 'context-provider') {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'pattern evidence is context-provider-only');
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new CliError('INVALID', 'SCHEMA_INVALID', 'pattern evidence input is invalid');
  }
  if (!isNonEmptyString(input.turnId) || !isHex64(input.internalSearchDigest)) {
    throw new CliError('INVALID', 'SCHEMA_INVALID', 'pattern evidence turn/internal-search identity is invalid');
  }
  const committedTurns = hostBridgeCommittedTurnIds.get(capability);
  if (!committedTurns || committedTurns.get(checked.reqObj.request_id) !== input.turnId) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'pattern evidence turn does not match the committed first CP turn');
  }
  const gapValidation = validatePatternGap(input.gap);
  if (!gapValidation.ok) throw new CliError('INVALID', 'SCHEMA_INVALID', gapValidation.reason);
  if (!isCanonicalContext7LibraryId(input.libraryId)) {
    throw new CliError('INVALID', 'SCHEMA_INVALID', 'selected Context7 library id is invalid');
  }
  if (input.gap.library_id !== null && input.gap.library_id !== input.libraryId) {
    throw new CliError('INVALID', 'CORRELATION_INVALID', 'selected Context7 library id does not match the supplied gap id');
  }
  const queryDigest = sha256String(input.gap.query);
  if (input.queryDigest !== undefined && input.queryDigest !== queryDigest) {
    throw new CliError('INVALID', 'CORRELATION_INVALID', 'query digest does not match the exact gap query');
  }
  const gapDigest = sha256String(canonicalJSONStringify(input.gap));
  if (input.gapDigest !== undefined && input.gapDigest !== gapDigest) {
    throw new CliError('INVALID', 'CORRELATION_INVALID', 'gap digest does not match the exact validated gap');
  }
  const contentBytes = ensureUtf8Bytes(input.contentBytes, 1024 * 1024, 'Context7 content');
  const suppliedId = input.gap.library_id !== null;
  if (suppliedId !== (input.resolutionBytes === null || input.resolutionBytes === undefined)) {
    throw new CliError('INVALID', 'CORRELATION_INVALID', 'Context7 resolution bytes do not match supplied-id/search branch');
  }
  const planRoot = planRootFromArtifact(checked.coordRoot, checked.requestPath);
  const contentRef = publishEvidenceBlob(planRoot, contentBytes);
  let resolutionRef = null;
  if (!suppliedId) {
    const resolutionBytes = ensureUtf8Bytes(input.resolutionBytes, 256 * 1024, 'Context7 resolution');
    try { JSON.parse(resolutionBytes.toString('utf8')); }
    catch (err) { throw new CliError('INVALID', 'SCHEMA_INVALID', 'Context7 resolution bytes are not valid JSON'); }
    resolutionRef = publishEvidenceBlob(planRoot, resolutionBytes);
  }
  const txnDir = path.dirname(checked.requestPath);
  return withLock(txnDir, checked.coordRoot, (lockToken) => {
    assertLockedScopeIdentity(lockToken);
    const inLock = requireHostBridgeRequestScope(capability, checked.coordRoot, checked.requestPath);
    const claim = assertHostBridgeClaimMatches(inLock, preClaim.claimPath);
    if (claim.auth.attemptId !== preClaim.auth.attemptId || claim.auth.leaseEpoch !== preClaim.auth.leaseEpoch) {
      throw new CliError('INVALID', 'AUTHORITY_INVALID', 'pattern evidence attempt changed before publication');
    }
    const evidence = {
      schema: 'coordination/pattern-evidence/v1',
      request_id: inLock.reqObj.request_id,
      request_digest: inLock.requestDigest,
      attempt_id: claim.auth.attemptId,
      lease_epoch: claim.auth.leaseEpoch,
      turn_id: input.turnId,
      provider: 'context7',
      internal_search_digest: input.internalSearchDigest,
      gap_digest: gapDigest,
      library_id: input.libraryId,
      query_digest: queryDigest,
      resolution_ref: resolutionRef,
      resolution_digest: resolutionRef === null ? null : resolutionRef.digest,
      source_uri: 'https://context7.com/api/v2/context',
      content_ref: contentRef,
      created_at: nowIso(),
    };
    assertClosedShape(evidence, PATTERN_EVIDENCE_V1_FIELDS);
    if (isoToMs(evidence.created_at) >= isoToMs(inLock.reqObj.expiry)) {
      throw new CliError('INVALID', 'AUTHORITY_INVALID', 'request expired before pattern evidence publication');
    }
    const evidencePath = patternEvidencePathFor(txnDir);
    const evidenceBytes = Buffer.from(canonicalJSONStringify(evidence), 'utf8');
    assertLockedScopeIdentity(lockToken);
    const receipt = publishNoClobber(evidencePath, evidenceBytes, { allowIdenticalIdempotent: true, raceDetailCode: 'AUTHORITY_INVALID' });
    assertLockedScopeIdentity(lockToken);
    assertArtifactMatchesReceipt(evidencePath, receipt, evidenceBytes);
    const dependency = {
      evidence_ref: evidenceRelativeRefFor(evidence.request_id),
      evidence_digest: sha256Buffer(evidenceBytes),
      provider: 'context7',
      internal_search_digest: evidence.internal_search_digest,
      gap_digest: evidence.gap_digest,
      library_id: evidence.library_id,
      query_digest: evidence.query_digest,
      resolution_digest: evidence.resolution_digest,
    };
    return {
      ok: true, dependency, contentRef, contentDigest: contentRef.digest,
      evidencePath, evidenceDigest: dependency.evidence_digest,
    };
  });
}

function hostBridgePublishTerminalResult(capability, coordRoot, requestPath, claimPath, resultEnvelope, consultationDependencies, patternEvidenceDependency) {
  const checked = requireHostBridgeRequestScope(capability, coordRoot, requestPath);
  assertHostBridgeClaimMatches(checked, resolveAbsolute(claimPath));
  const validation = validateRuntimeTurnEnvelope({
    schema: 'coordination/runtime-turn-envelope/v1', kind: 'terminal-result', result: resultEnvelope,
  }, checked.reqObj.expected_result_kind, []);
  if (!validation.ok) throw new CliError('INVALID', 'SCHEMA_INVALID', 'invalid terminal result envelope: ' + validation.reason);
  const suppliedPatternDependency = patternEvidenceDependency === undefined ? null : patternEvidenceDependency;
  if (resultEnvelope.status === 'BLOCKED' && suppliedPatternDependency !== null) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'BLOCKED results must not depend on pattern evidence');
  }
  if (suppliedPatternDependency !== null && !isPatternEvidenceDependencyShape(suppliedPatternDependency)) {
    throw new CliError('INVALID', 'SCHEMA_INVALID', 'invalid host-derived pattern evidence dependency');
  }
  const planRoot = planRootFromArtifact(checked.coordRoot, checked.requestPath);
  const evidenceAuthority = resolveRootEvidenceAuthority(checked.reqObj, checked.requestDigest, checked.coordRoot, checked.scope);
  const evidencePolicy = evidenceAuthority.policy;
  if (
    resultEnvelope.status === 'ANSWERED' && checked.scope.role === 'context-provider'
    && evidencePolicy === 'context7-required' && suppliedPatternDependency === null
  ) throw new CliError('INVALID', 'AUTHORITY_INVALID', 'context7-required root answer has no host-derived pattern evidence');
  if (
    resultEnvelope.status === 'ANSWERED' && checked.scope.role === 'context-provider'
    && (evidencePolicy === 'context7-required' || evidencePolicy === 'context7-preferred') && evidenceAuthority.libraryId !== null
    && suppliedPatternDependency !== null && suppliedPatternDependency.library_id !== evidenceAuthority.libraryId
  ) throw new CliError('INVALID', 'AUTHORITY_INVALID', 'host-derived pattern evidence library_id does not match the approved directive');
  const dependencies = consultationDependencies === undefined ? [] : consultationDependencies;
  // M6/M7 terminal functional closure, point F: the SAME canonical
  // consultation_dependencies validator validateResultV2 later reuses on
  // every reopen -- never a lighter, publish-time-only shape check. The
  // architect-side "exactly one context-provider dependency, question
  // preserved" half only ever applies to an ANSWERED result (point F scopes
  // it to "Bajo un resultado ANSWERED de architect").
  validateConsultationDependencySet(
    dependencies, checked.reqObj, planRoot, checked.coordRoot,
    resultEnvelope.status === 'ANSWERED' ? evidenceAuthority : undefined,
  );
  const flags = {
    'coordination-root': checked.coordRoot,
    request: checked.requestPath,
    claim: resolveAbsolute(claimPath),
  };
  if (resultEnvelope.status === 'ANSWERED') {
    flags.content = Buffer.from(resultEnvelope.content, 'utf8').toString('base64url');
  } else {
    flags['blocked-reason'] = resultEnvelope.reason;
  }
  return cmdPublishResult(flags, {
    actorInstanceId: checked.scope.actorInstanceId,
    role: checked.scope.role,
    workerSessionId: checked.scope.workerSessionId,
    driver: 'codex-app-server',
    hostBridge: true,
    consultationDependencies: dependencies,
    patternEvidenceDependency: suppliedPatternDependency,
  });
}

function hostBridgeAllowedChildRoles(role) {
  if (role === 'arch-platform' || role === 'arch-testing' || role === 'arch-integration') {
    return ['context-provider'];
  }
  if (
    role === 'toolkit-specialist' || role === 'test-specialist'
    || role === 'verifier' || role === 'quality-gater'
  ) {
    return ['arch-platform', 'arch-testing', 'arch-integration'];
  }
  return [];
}

/**
 * Publishes and dispatches one nested consultation on behalf of the exact
 * in-process Codex role capability that owns the parent request.  The model
 * supplies only the closed consult intent; the host derives PLAN, subject
 * bundle, parent, actor, expiry and routing authority from accredited disk
 * state.  No serialized requester grant is minted or accepted on this path.
 */
function hostBridgePublishChildRequest(capability, coordRootRaw, parentRequestPathRaw, consult) {
  const checked = requireHostBridgeRequestScope(capability, coordRootRaw, parentRequestPathRaw);
  const allowed = hostBridgeAllowedChildRoles(checked.scope.role);
  if (
    !consult || typeof consult !== 'object' || Array.isArray(consult)
    || !hasExactKeys(consult, ['expected_result_kind', 'question', 'target_role'])
    || !allowed.includes(consult.target_role)
    || typeof consult.question !== 'string' || consult.question.length === 0
    || Buffer.byteLength(consult.question, 'utf8') > RUNTIME_TURN_ENVELOPE_MAX_QUESTION_BYTES
    || typeof consult.expected_result_kind !== 'string'
    || !RUNTIME_TURN_ENVELOPE_RESULT_KIND_PATTERN.test(consult.expected_result_kind)
  ) throw new CliError('INVALID', 'AUTHORITY_INVALID', 'nested consult intent is not allowed for this role');

  if (checked.reqObj.depth >= checked.reqObj.max_depth) {
    throw new CliError('INVALID', 'CORRELATION_INVALID', 'nested consult would exceed max_depth');
  }

  const planRoot = planRootFromArtifact(checked.coordRoot, checked.requestPath);
  const transactionsDir = path.join(planRoot, 'transactions');
  let entries;
  try { entries = fs.readdirSync(transactionsDir, { withFileTypes: true }); }
  catch (err) { throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'unable to inspect nested consultation inventory'); }
  if (entries.length > 4096) throw new CliError('INVALID', 'SECURITY_INVALID', 'nested consultation inventory cap exceeded');

  let existingChildren = 0;
  for (const entry of entries) {
    if (!entry.isDirectory() || !isHexId(entry.name)) continue;
    const candidatePath = requestPathFor(planRoot, entry.name);
    let candidate;
    try { candidate = readCanonicalRequestRecord(candidatePath, entry.name, {}).obj; }
    catch (err) { throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'nested consultation inventory contains an unaccredited request'); }
    if (candidate.parent_request_id === checked.reqObj.request_id) existingChildren += 1;
  }
  if (existingChildren >= 2) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'nested consultation intent budget exhausted');
  }

  const seenRoles = new Set();
  let cursor = checked.reqObj;
  for (let depth = 0; depth <= MAX_DEPTH_LIMIT; depth += 1) {
    seenRoles.add(cursor.source_role);
    seenRoles.add(cursor.target_role);
    if (cursor.parent_request_id === null) break;
    const ancestorPath = requestPathFor(planRoot, cursor.parent_request_id);
    cursor = validateConsultV2(ancestorPath, checked.coordRoot);
  }
  if (seenRoles.has(consult.target_role)) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'nested consultation repeats an ancestor role');
  }

  const nowMs = Date.now();
  const childExpiryMs = Math.min(isoToMs(checked.reqObj.expiry) - 20000, nowMs + 3600 * 1000);
  if (childExpiryMs - nowMs < 120000) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'parent deadline leaves no valid nested consultation lifetime');
  }

  let rll;
  try { rll = require('./runtime-role-lifecycle.cjs'); }
  catch (err) { throw new CliError('INVALID', 'INTERNAL_ERROR', 'role lifecycle module unavailable'); }
  const plan = rll.discoverPlan(checked.scope.projectRoot);
  if (!plan.ok || plan.planDigest !== checked.scope.planDigest) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'host bridge PLAN is not current');
  }
  const subjectBundlePath = path.join(
    planRoot, 'subject-bundles', checked.reqObj.subject_scope_digest, 'manifest.json',
  );
  const intent = {
    target_role: consult.target_role,
    question: consult.question,
    expected_result_kind: consult.expected_result_kind,
    expiry: new Date(childExpiryMs).toISOString(),
    parent_request_id: checked.reqObj.request_id,
  };
  const published = cmdPublishRequest({
    'coordination-root': checked.coordRoot,
    plan: plan.planPath,
    'subject-bundle': subjectBundlePath,
    intent: Buffer.from(canonicalJSONStringify(intent), 'utf8').toString('base64url'),
  }, {
    actorInstanceId: checked.scope.actorInstanceId,
    role: checked.scope.role,
    workerSessionId: checked.scope.workerSessionId,
    driver: 'codex-app-server',
    hostBridge: true,
  });
  // Sequence 46 (WAVE1-FUNCTIONAL-CLOSEOUT-REALISTIC-20260822) retained
  // child-driver repair: PLAN §16b requires the existing retained architect
  // to publish its context-provider child and resume the same architect
  // instance after the accepted child result. This HostBridgeCapability path
  // is already proven to run inside that retained Codex support plane, so its
  // child dispatch must call the same dispatchCanonical(...,
  // {requiredDriver:'codex-app-server'}) path retained-root dispatch already
  // uses (cmdDispatch's own isRootSourceGrantContext branch, ~L11542-11552) --
  // never ordinary cmdDispatch(), which lets requester-owned claude-agent win
  // whenever a live top-level Claude MainOrchestratorBinding exists. This
  // retained host neither owns nor executes a top-level-Claude
  // activation_action, so an unconstrained child dispatch stalls unclaimed
  // even though the exact retained codex-app-server target is READY --
  // WORKER_LEASE_EXPIRED at the parent is only the later downstream symptom
  // (Codex byte audit sequence45-child-driver-byte-audit.md). requiredDriver
  // already fails closed if the retained target is genuinely unavailable, so
  // this changes no TTL, routing-policy order or driver-eligibility rule --
  // only which candidate this opaque retained-host path is allowed to select.
  const dispatched = dispatchCanonical({
    'coordination-root': checked.coordRoot,
    request: published.artifact_ref,
  }, { requiredDriver: 'codex-app-server' });
  return {
    ok: true,
    requestId: published.request_id,
    requestPath: published.artifact_ref,
    activationPath: dispatched.artifact_ref,
    selectedDriver: resolveActivationForRequestPath(published.artifact_ref).activation.selected_driver,
  };
}

/**
 * Observes one nested result and, for ANSWERED, accepts it under the same
 * authenticated parent-role actor that published the child.  Absence is a
 * normal polling state; malformed, foreign, stale or BLOCKED results never
 * become accepted dependencies.
 */
function hostBridgeObserveChildResult(capability, coordRootRaw, childRequestPathRaw) {
  const scope = requireHostBridgeCapability(capability);
  const coordRoot = resolveAbsolute(coordRootRaw);
  const requestPath = resolveAbsolute(childRequestPathRaw);
  const accredited = accreditCanonicalRequest(coordRoot, requestPath);
  const reqObj = accredited.obj;
  if (
    reqObj.source_role !== scope.role
    || reqObj.requester_instance_id !== scope.actorInstanceId
    || reqObj.requester_worktree_id !== scope.worktreeId
    || reqObj.plan_digest !== scope.planDigest
  ) throw new CliError('INVALID', 'AUTHORITY_INVALID', 'nested child is not owned by this HostBridgeCapability');
  const txnDir = path.dirname(requestPath);
  const auth = resolveAuthoritativeAttempt(reqObj, txnDir);
  const candidatePath = resultPathFor(txnDir, auth.attemptId);
  const classified = classifyDurableRead(candidatePath, { shape: (o) => assertClosedShape(o, RESULT_V2_FIELDS) });
  if (classified.state === DURABLE_ABSENT || classified.state === DURABLE_PENDING) {
    return { ok: true, ready: false };
  }
  const validatedRecord = validateResultV2(candidatePath, coordRoot);
  const validated = validatedRecord.obj;
  if (validated.status === 'BLOCKED') {
    const ack = cmdTransactionAck({
      'coordination-root': coordRoot, request: requestPath, disposition: 'blocked',
    });
    const ackRecord = readDurableRecord(ack.artifact_ref);
    assertClosedShape(ackRecord.obj, ACK_V1_FIELDS);
    return {
      ok: true, ready: true, status: 'BLOCKED', reason: validated.reason,
      requestPath, requestDigest: accredited.digest,
      resultPath: candidatePath, resultDigest: validatedRecord.digest,
      acceptedPath: null, acceptedDigest: null,
      ackPath: ack.artifact_ref, ackDigest: ackRecord.digest,
    };
  }
  const accepted = cmdAcceptResult({ 'coordination-root': coordRoot, request: requestPath }, {
    actorInstanceId: scope.actorInstanceId,
    role: scope.role,
    workerSessionId: scope.workerSessionId,
    driver: 'codex-app-server',
    hostBridge: true,
  });
  // Dependency digests come from the same fd-bound durable reads that parsed
  // and validated the records.  Never reopen either pathname merely to hash
  // it: that would reintroduce a path-swap window after validation.
  const acceptedRecord = readDurableRecord(accepted.artifact_ref);
  assertClosedShape(acceptedRecord.obj, ACCEPTED_RESULT_V1_FIELDS);
  assertAcceptedResultCorrelates(acceptedRecord.obj, txnDir, reqObj, coordRoot);
  const ack = cmdTransactionAck({
    'coordination-root': coordRoot, request: requestPath, disposition: 'accepted',
  });
  const ackRecord = readDurableRecord(ack.artifact_ref);
  assertClosedShape(ackRecord.obj, ACK_V1_FIELDS);
  return {
    ok: true,
    ready: true,
    status: 'ANSWERED',
    content: validated.content,
    resultKind: validated.result_kind,
    acceptedPath: accepted.artifact_ref,
    acceptedDigest: acceptedRecord.digest,
    resultPath: candidatePath,
    resultDigest: validatedRecord.digest,
    requestPath,
    requestDigest: accredited.digest,
    ackPath: ack.artifact_ref,
    ackDigest: ackRecord.digest,
    dependency: {
      request_id: reqObj.request_id,
      accepted_result_digest: acceptedRecord.digest,
      result_digest: validatedRecord.digest,
      from_role: validated.from_role,
    },
  };
}

function hostBridgeListRootConsultIntents(capability, coordRootRaw) {
  const scope = requireHostBridgeCapability(capability);
  // Resolve and confine even though lifecycle records themselves are host-
  // private: the caller must not swap the coordination scope independently.
  const coordRoot = resolveAbsolute(coordRootRaw);
  if (computeCoordRootId(coordRoot) !== computeCoordRootId(path.resolve(coordRoot))) {
    throw new CliError('INVALID', 'SECURITY_INVALID', 'root-consult coordination root identity invalid');
  }
  let rll;
  try { rll = require('./runtime-role-lifecycle.cjs'); }
  catch (err) { throw new CliError('INVALID', 'INTERNAL_ERROR', 'role lifecycle module unavailable'); }
  const listed = rll.listRootConsultIntentsForActor(scope.projectRoot, scope.actorInstanceId);
  if (!listed || listed.ok !== true || !Array.isArray(listed.intents)) {
    throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'root-consult intent scan failed');
  }
  if (listed.intents.length > 1024) throw new CliError('INVALID', 'SECURITY_INVALID', 'root-consult intent scan cap exceeded');
  const output = listed.intents.map((intent) => {
    const valid = rll.validateRootConsultIntentRecord(intent, {
      requester_actor_instance_id: scope.actorInstanceId,
      requester_role: scope.role,
      worktree_id: scope.worktreeId,
      plan_digest: scope.planDigest,
    });
    if (!valid.ok) throw new CliError('INVALID', 'AUTHORITY_INVALID', 'root-consult intent does not match HostBridgeCapability');
    return {
      intentPath: rll.rootConsultIntentPathFor(scope.projectRoot, intent.intent_id),
      intentId: intent.intent_id,
      createdAt: intent.created_at,
    };
  });
  output.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.intentId.localeCompare(b.intentId));
  return output;
}

function readLifecycleRecordRequired(rll, recordPath, validator, expected, label) {
  const classified = classifyDurableRead(recordPath, { parse: true });
  if (classified.state === DURABLE_ABSENT) return null;
  if (classified.state === DURABLE_PENDING) {
    throw new CliError('INVALID', 'DURABILITY_UNPROVEN', label + ' is still pending durability');
  }
  const valid = validator(classified.obj, expected);
  if (!valid || valid.ok !== true) throw new CliError('INVALID', 'AUTHORITY_INVALID', label + ' is malformed or foreign');
  return {
    obj: valid.record, bytes: classified.bytes,
    digest: sha256Buffer(classified.bytes), path: recordPath,
  };
}

/**
 * Resolves host-private root-consult policy from the immutable lifecycle
 * intent.  The request is the lookup key, not the current target actor: the
 * intent belongs to the source architect while inbox polling runs under the
 * target capability.  Ordinary and nested requests have no matching intent
 * and therefore retain policy `none`.
 */
function findCorrelatedRootConsultIntent(reqObj, expectedTargetScope) {
  let rll;
  try { rll = require('./runtime-role-lifecycle.cjs'); }
  catch (err) { throw new CliError('INVALID', 'INTERNAL_ERROR', 'role lifecycle module unavailable'); }
  if (typeof rll.findRootConsultIntentByRequestId !== 'function') {
    throw new CliError('INVALID', 'INTERNAL_ERROR', 'root-consult request lookup unavailable');
  }
  const found = rll.findRootConsultIntentByRequestId({ repoId: reqObj.repo_id }, reqObj.request_id);
  if (!found || found.ok !== true) {
    throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'root-consult request lookup is malformed or ambiguous');
  }
  if (found.absent === true) return null;
  const expected = {
    request_id: reqObj.request_id,
    repo_id: reqObj.repo_id,
    coordination_root_id: reqObj.coordination_root_id,
    requester_role: reqObj.source_role,
    requester_actor_instance_id: reqObj.requester_instance_id,
    target_role: reqObj.target_role,
    worktree_id: reqObj.requester_worktree_id,
    plan_digest: reqObj.plan_digest,
    target_role_profile_version: reqObj.target_role_profile_version,
    target_role_profile_digest: reqObj.target_role_profile_digest,
    routing_policy_version: reqObj.routing_policy_version,
    routing_policy_digest: reqObj.routing_policy_digest,
    subject_repo_id: reqObj.subject_repo_id,
    subject_worktree_id: reqObj.subject_worktree_id,
    subject_head: reqObj.subject_head,
    subject_scope_digest: reqObj.subject_scope_digest,
    request_created_at: reqObj.created_at,
    request_expiry: reqObj.expiry,
  };
  const valid = rll.validateRootConsultIntentRecord(found.intent, expected);
  if (!valid || valid.ok !== true) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'root-consult intent does not correlate to its request');
  }
  if (
    reqObj.root_request_id !== reqObj.request_id
    || reqObj.parent_request_id !== null
    || reqObj.depth !== 0
  ) throw new CliError('INVALID', 'AUTHORITY_INVALID', 'root-consult intent correlates only to root topology');
  if (expectedTargetScope && (
    valid.record.target_role !== expectedTargetScope.role
    || valid.record.worktree_id !== expectedTargetScope.worktreeId
    || valid.record.plan_digest !== expectedTargetScope.planDigest
  )) throw new CliError('INVALID', 'AUTHORITY_INVALID', 'root-consult intent does not match target HostBridgeCapability');
  return valid.record;
}

/**
 * M6/M7 terminal functional closure, point C: the single canonical
 * root-aware evidence-authority resolver, superseding the old
 * root-consult-only rootConsultEvidencePolicyForRequest (which silently
 * returned 'none' for any root-source-originated request or descendant,
 * since findCorrelatedRootConsultIntent only ever matches a request whose
 * OWN request_id equals a minted root-consult intent's request_id -- true
 * only when reqObj already IS that intent's root).
 *
 * For ANY root or descendant reqObj: (1) reopens the ROOT's own canonical
 * request bytes from root_request_id (a no-op re-read when reqObj already is
 * the root); (2) resolves EITHER a root-consult intent (existing, byte-exact
 * unchanged private evidence_policy authority) OR root-source provenance
 * (point B's lookup, deriving policy+libraryId from the root's own question
 * text via point A's directive parser) -- never both; (3) revalidates the
 * descendant's own identity against its root before propagating; (4)
 * returns the SAME { policy, libraryId } to every descendant of that root.
 *
 * `expectedTargetScope`, when supplied, is applied only when reqObj already
 * is the root (the pre-existing root-consult semantic: "does this root's own
 * target correlate with the CURRENT worker checking its own obligations") --
 * never re-applied against a refetched root on behalf of an unrelated
 * descendant worker, which would compare the wrong role.
 *
 * @returns {{policy:'none'|'context7-required'|'context7-preferred', libraryId: string|null}}
 */
function resolveRootEvidenceAuthority(reqObj, reqDigest, coordRoot, expectedTargetScope) {
  const isRoot = reqObj.request_id === reqObj.root_request_id;
  let rootReqObj = reqObj;
  let rootDigest = reqDigest;
  if (!isRoot) {
    const rootPlanRoot = planRootPath(coordRoot, reqObj.repo_id, reqObj.wave_slug, reqObj.plan_digest);
    const rootPath = requestPathFor(rootPlanRoot, reqObj.root_request_id);
    const rootRec = readCanonicalRequestRecord(rootPath, reqObj.root_request_id, {
      absentDetail: 'CORRELATION_INVALID', absentMessage: 'root request does not resolve for evidence authority resolution',
    });
    rootReqObj = rootRec.obj;
    rootDigest = rootRec.digest;
    if (
      rootReqObj.root_request_id !== rootReqObj.request_id || rootReqObj.parent_request_id !== null || rootReqObj.depth !== 0
      || rootReqObj.repo_id !== reqObj.repo_id || rootReqObj.wave_slug !== reqObj.wave_slug
      || rootReqObj.plan_digest !== reqObj.plan_digest || rootReqObj.protocol_profile !== reqObj.protocol_profile
      || rootReqObj.subject_repo_id !== reqObj.subject_repo_id || rootReqObj.subject_worktree_id !== reqObj.subject_worktree_id
      || rootReqObj.subject_head !== reqObj.subject_head || rootReqObj.subject_scope_digest !== reqObj.subject_scope_digest
      || rootReqObj.routing_policy_version !== reqObj.routing_policy_version
      || rootReqObj.routing_policy_digest !== reqObj.routing_policy_digest
      || rootReqObj.coordination_root_id !== reqObj.coordination_root_id
    ) throw new CliError('INVALID', 'CORRELATION_INVALID', 'descendant does not correlate with its root for evidence authority resolution');
  }

  const rootConsultIntent = findCorrelatedRootConsultIntent(rootReqObj, isRoot ? expectedTargetScope : undefined);
  let rll;
  try { rll = require('./runtime-role-lifecycle.cjs'); }
  catch (err) { throw new CliError('INVALID', 'INTERNAL_ERROR', 'role lifecycle module unavailable'); }
  if (typeof rll.findRootSourceProvenanceForRequestId !== 'function') {
    throw new CliError('INVALID', 'INTERNAL_ERROR', 'root-source provenance lookup unavailable');
  }
  const provenance = rll.findRootSourceProvenanceForRequestId({ repoId: rootReqObj.repo_id }, rootReqObj.request_id);
  if (!provenance.ok) {
    throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'root-source provenance lookup is malformed or ambiguous: ' + provenance.reason);
  }
  const hasRootConsult = rootConsultIntent !== null;
  const hasRootSource = provenance.absent !== true;
  if (hasRootConsult && hasRootSource) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'root request has both root-consult and root-source evidence authority');
  }
  if (hasRootConsult) return { policy: rootConsultIntent.evidence_policy, libraryId: null };
  if (hasRootSource) {
    const p = provenance.provenance;
    if (
      rootReqObj.source_role !== 'toolkit-specialist' || rootReqObj.target_role !== 'arch-platform'
      || rootDigest !== p.ingress.request_digest
      || rootReqObj.requester_instance_id !== p.binding.actor_instance_id
      || rootReqObj.plan_digest !== p.ingress.plan_digest || rootReqObj.plan_digest !== p.binding.plan_digest
      || rootReqObj.question !== p.bootstrapIntent.question
      || rootReqObj.expected_result_kind !== p.bootstrapIntent.expected_result_kind
    ) throw new CliError('INVALID', 'CORRELATION_INVALID', 'root-source provenance does not correlate with its root request');
    const directive = parseApprovedContext7Directive(rootReqObj.question);
    const preferredDirective = parsePreferredContext7Directive(rootReqObj.question);
    if (directive.present && preferredDirective.present) {
      throw new CliError('INVALID', 'AUTHORITY_INVALID', 'root-source question carries both APPROVED_CONTEXT7_LIBRARY_ID and PREFERRED_CONTEXT7_LIBRARY_ID directives');
    }
    if (directive.present) return { policy: 'context7-required', libraryId: directive.libraryId };
    if (preferredDirective.present) return { policy: 'context7-preferred', libraryId: preferredDirective.libraryId };
    return { policy: 'none', libraryId: null };
  }
  return { policy: 'none', libraryId: null };
}

function rootConsultIntentContext(capability, coordRootRaw, intentPathRaw) {
  const { scope, live } = requireHostBridgeCapabilityWithLiveWorker(capability);
  const coordRoot = resolveAbsolute(coordRootRaw);
  const intentPath = resolveAbsolute(intentPathRaw);
  let rll;
  try { rll = require('./runtime-role-lifecycle.cjs'); }
  catch (err) { throw new CliError('INVALID', 'INTERNAL_ERROR', 'role lifecycle module unavailable'); }
  const intentId = path.basename(intentPath, '.json');
  if (!HOST_BRIDGE_ID_RE.test(intentId) || path.resolve(intentPath) !== path.resolve(rll.rootConsultIntentPathFor(scope.projectRoot, intentId))) {
    throw new CliError('INVALID', 'SECURITY_INVALID', 'root-consult intent path is not canonical');
  }
  const intentRec = readLifecycleRecordRequired(
    rll, intentPath, rll.validateRootConsultIntentRecord,
    {
      intent_id: intentId, requester_actor_instance_id: scope.actorInstanceId,
      requester_role: scope.role, worktree_id: scope.worktreeId,
      plan_digest: scope.planDigest, coordination_root_id: computeCoordRootId(coordRoot),
    }, 'root-consult intent',
  );
  if (!intentRec) throw new CliError('INVALID', 'AUTHORITY_INVALID', 'root-consult intent is absent');
  const intent = intentRec.obj;
  // live is the SAME proof requireHostBridgeCapabilityWithLiveWorker above
  // already obtained for this exact (scope.projectRoot, scope.role) pair,
  // moments earlier in this same synchronous call -- reused explicitly
  // rather than re-derived (see that function's own comment). The
  // bindingId/sessionGenerationId checks below are genuinely new (this
  // intent's own recorded actor), never covered by the capability's own
  // generic liveness proof.
  if (
    !live || live.ok !== true || live.available !== true || !live.worker
    || live.worker.bindingId !== intent.requester_binding_id
    || live.worker.sessionGenerationId !== intent.session_generation_id
    || live.worker.workerSessionId !== scope.workerSessionId
  ) return { scope, coordRoot, intentPath, intentId, intentRec, intent, rll, blocked: 'source-actor-retired' };
  // NO-GO Correction A (PLAN.md §16a line 53): intent.expiry (<=30s) gates
  // ONLY whether the source's WAL may still RESERVE this intent -- once
  // reserved, continued work (publish/dispatch/observe/complete) is bound
  // to intent.request_expiry (up to 3600s) instead, never re-blocked by the
  // activation window it already cleared. A raw existence check (not a full
  // validated read) is deliberate: this is a boolean "did activation
  // succeed" gate, not a trust decision -- hostBridgeAdvanceRootConsult
  // below fully re-reads and validates the reservation record itself before
  // relying on its content.
  const reservationPath = rll.rootConsultReservationPathFor(scope.projectRoot, intentId);
  const reservationExists = fs.existsSync(reservationPath);
  if (!reservationExists) {
    if (isoToMs(intent.expiry) <= Date.now()) {
      return { scope, coordRoot, intentPath, intentId, intentRec, intent, rll, blocked: 'intent-expired' };
    }
  } else if (isoToMs(intent.request_expiry) <= Date.now()) {
    return { scope, coordRoot, intentPath, intentId, intentRec, intent, rll, blocked: 'request-expired' };
  }
  return { scope, coordRoot, intentPath, intentId, intentRec, intent, rll, blocked: null };
}

function requestInputForRootIntent(context) {
  const i = context.intent;
  // ROOT-INGRESS-E2E finding: subject_bundle_ref is coordination-root-RELATIVE
  // (s16CoordinationRelativeRef's own output, same shape as root-source's
  // subject_bundle_ref -- see enforceRootSourceGrantBoundary's identical fix).
  // resolveAbsolute() alone resolves it against this long-running retained
  // worker's own process.cwd(), never the intent's own coordRoot -- proven by
  // a live retained worker crashing (APP_SERVER_POLL_FAILED, artifact not
  // found under the repo checkout root) the moment it tried to advance a
  // genuine root-consult intent.
  const manifestRec = readDurableRecord(path.join(context.coordRoot, i.subject_bundle_ref));
  const manifest = manifestRec.obj;
  assertClosedShape(manifest, SUBJECT_BUNDLE_MANIFEST_V1_FIELDS);
  for (const entry of manifest.entries) assertClosedShape(entry, SUBJECT_BUNDLE_ENTRY_FIELDS);
  if (sha256Buffer(Buffer.from(canonicalJSONStringify(manifest), 'utf8')) !== i.subject_scope_digest) {
    throw new CliError('INVALID', 'CORRELATION_INVALID', 'root-consult subject manifest digest mismatch');
  }
  const plan = context.rll.discoverPlan(context.scope.projectRoot);
  if (!plan.ok || plan.planDigest !== i.plan_digest) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'root-consult PLAN is not current');
  }
  return {
    coordinationRoot: context.coordRoot,
    planPath: plan.planPath,
    subjectBundleManifest: manifest,
    requestId: i.request_id,
    initialAttemptId: i.initial_attempt_id,
    createdAt: i.request_created_at,
    expiry: i.request_expiry,
    parentRequestId: null,
    targetRole: i.target_role,
    targetRoleProfileVersion: i.target_role_profile_version,
    targetRoleProfileDigest: i.target_role_profile_digest,
    question: i.question,
    expectedResultKind: i.expected_result_kind,
    routingPolicyVersion: i.routing_policy_version,
    routingPolicyDigest: i.routing_policy_digest,
  };
}

function assertBuiltRootRequestMatchesIntent(built, intent, scope) {
  const r = built.request;
  const expected = {
    request_id: intent.request_id,
    root_request_id: intent.request_id,
    parent_request_id: null,
    depth: 0,
    source_role: scope.role,
    requester_instance_id: scope.actorInstanceId,
    requester_worktree_id: intent.worktree_id,
    repo_id: intent.repo_id,
    coordination_root_id: intent.coordination_root_id,
    plan_digest: intent.plan_digest,
    target_role: intent.target_role,
    target_role_profile_version: intent.target_role_profile_version,
    target_role_profile_digest: intent.target_role_profile_digest,
    subject_repo_id: intent.subject_repo_id,
    subject_worktree_id: intent.subject_worktree_id,
    subject_head: intent.subject_head,
    subject_scope_digest: intent.subject_scope_digest,
    routing_policy_version: intent.routing_policy_version,
    routing_policy_digest: intent.routing_policy_digest,
    created_at: intent.request_created_at,
    expiry: intent.request_expiry,
    initial_attempt_id: intent.initial_attempt_id,
    question: intent.question,
    expected_result_kind: intent.expected_result_kind,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (r[key] !== value) {
      throw new CliError('INVALID', 'CORRELATION_INVALID', 'root-consult request field diverges from immutable intent: ' + key);
    }
  }
}

function rootConsultOperationResult(status, context, values) {
  return Object.assign({
    ok: true, status, intent: context.intent,
    intentPath: context.intentPath, intentId: context.intentId,
  }, values || {});
}

function canonicalRequestPathForRootIntent(c) {
  const plan = c.rll.discoverPlan(c.scope.projectRoot);
  if (!plan.ok || plan.planDigest !== c.intent.plan_digest) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'root-consult PLAN is not current');
  }
  const waveSlug = path.basename(path.dirname(plan.planPath)).replace(/^wave-/, '');
  return requestPathFor(
    planRootPath(c.coordRoot, c.intent.repo_id, waveSlug, c.intent.plan_digest),
    c.intent.request_id,
  );
}

/**
 * Read-only lifecycle-facing projection for the one root terminal state that
 * deliberately has no completion record: BLOCKED result + blocked ack.  It
 * reuses consultation's canonical request/result/ack schemas so lifecycle
 * never grows a second, weaker transaction parser.
 */
function readRootConsultTerminalStatus(projectRootRaw, intentInput) {
  try {
    const projectRoot = gitRevParse(resolveAbsolute(projectRootRaw), ['rev-parse', '--show-toplevel']);
    let rll;
    try { rll = require('./runtime-role-lifecycle.cjs'); }
    catch (err) { return { ok: false, reason: 'role-lifecycle-unavailable' }; }
    const initial = rll.validateRootConsultIntentRecord(intentInput);
    if (!initial || initial.ok !== true) return { ok: false, reason: 'root-consult-intent-invalid' };
    const intent = initial.record;
    const found = rll.findRootConsultIntentByRequestId({ repoId: intent.repo_id }, intent.request_id);
    if (!found || found.ok !== true || found.absent === true || !found.intent) {
      return { ok: false, reason: (found && found.reason) || 'root-consult-intent-not-current' };
    }
    if (canonicalJSONStringify(found.intent) !== canonicalJSONStringify(intent)) {
      return { ok: false, reason: 'root-consult-intent-input-mismatch' };
    }
    const plan = rll.discoverPlan(projectRoot);
    const coordRoot = rll.coordinationRootPathFor(projectRoot);
    if (
      !plan.ok || plan.planDigest !== intent.plan_digest
      || computeRepoId(projectRoot) !== intent.repo_id
      || computeWorktreeId(projectRoot) !== intent.worktree_id
      || computeCoordRootId(coordRoot) !== intent.coordination_root_id
    ) return { ok: false, reason: 'root-consult-project-scope-mismatch' };
    const waveSlug = path.basename(path.dirname(plan.planPath)).replace(/^wave-/, '');
    const planRoot = planRootPath(coordRoot, intent.repo_id, waveSlug, intent.plan_digest);
    const requestPath = requestPathFor(planRoot, intent.request_id);
    const requestState = classifyDurableRead(requestPath, { parse: true });
    if (requestState.state === DURABLE_ABSENT) return { ok: true, state: 'WAITING' };
    if (requestState.state === DURABLE_PENDING) return { ok: false, reason: 'root-consult-request-pending-durability' };
    const requestRec = accreditCanonicalRequest(coordRoot, requestPath);
    assertBuiltRootRequestMatchesIntent(
      { request: requestRec.obj }, intent,
      { role: intent.requester_role, actorInstanceId: intent.requester_actor_instance_id },
    );
    const txnDir = path.dirname(requestPath);
    const auth = resolveAuthoritativeAttempt(requestRec.obj, txnDir);
    const candidatePath = resultPathFor(txnDir, auth.attemptId);
    const resultState = classifyDurableRead(candidatePath, { parse: true });
    if (resultState.state === DURABLE_ABSENT) return { ok: true, state: 'WAITING' };
    if (resultState.state === DURABLE_PENDING) return { ok: false, reason: 'root-consult-result-pending-durability' };
    const resultRec = validateResultV2(candidatePath, coordRoot);
    if (resultRec.obj.status !== 'BLOCKED') return { ok: true, state: 'WAITING' };
    const acceptedState = classifyDurableRead(acceptedResultPathFor(txnDir), { parse: true });
    if (acceptedState.state !== DURABLE_ABSENT) {
      return { ok: false, reason: acceptedState.state === DURABLE_PENDING
        ? 'root-consult-accepted-result-pending-durability'
        : 'root-consult-blocked-has-accepted-result' };
    }
    const ackPath = ackPathFor(txnDir);
    const ackState = classifyDurableRead(ackPath, { parse: true });
    if (ackState.state === DURABLE_ABSENT) return { ok: true, state: 'WAITING' };
    if (ackState.state === DURABLE_PENDING) return { ok: false, reason: 'root-consult-ack-pending-durability' };
    assertClosedShape(ackState.obj, ACK_V1_FIELDS);
    if (
      ackState.obj.disposition !== 'blocked'
      || ackState.obj.in_reply_to_attempt_id !== auth.attemptId
    ) return { ok: false, reason: 'root-consult-blocked-ack-mismatch' };
    const ackDigest = sha256Buffer(ackState.bytes);
    return {
      ok: true,
      state: 'BLOCKED',
      request_ref: path.posix.join('transactions', intent.request_id, 'request.json'),
      request_digest: requestRec.digest,
      result_ref: path.posix.join('transactions', intent.request_id, 'results', auth.attemptId + '.json'),
      result_digest: resultRec.digest,
      ack_ref: path.posix.join('transactions', intent.request_id, 'ack.json'),
      ack_digest: ackDigest,
    };
  } catch (err) {
    return {
      ok: false,
      reason: (err && (err.detailCode || err.message)) || 'root-consult-terminal-status-failed',
    };
  }
}

/**
 * NO-GO Correction C, M7 section 9 update: the ONE canonical read-only
 * helper for a root-source operation's terminal artifacts -- and now the
 * SOLE classifier of which terminal (acked, cancelled, or neither yet)
 * governs, since M7 removes the retirement record that used to tell the
 * caller which reason to pass. Reopens/accredits request, authoritative
 * result, accepted-result (acked only) and ack-or-cancel through the SAME
 * fd-bound primitives production already trusts for ordinary consultation
 * (never a second, weaker parser -- mirrors readRootConsultTerminalStatus/
 * validateRootConsultCompletionArtifacts's established root-consult
 * pattern), and recomputes every digest fresh from disk before emission
 * (PLAN.md line 226: "any non-null digest is recomputed from fd-bound
 * bytes"). Returns null when neither ack.json nor cancel.json is durably
 * present yet -- an ordinary WAITING case, not an error.
 *
 * M6+M7 SIXTEENTH CODEX ACCEPTANCE Correction C: 'acked' still requires an
 * authoritative result (an ack can only ever follow one); 'cancelled' does
 * NOT -- a cancellation raised before any result ever landed is the common
 * case, not an error, and must reach BLOCKED/NONE with result_ref/digest
 * genuinely null rather than throwing (this function's own caller,
 * handleRootSourceStatus, previously observed that throw as an opaque
 * DURABILITY_UNPROVEN, indistinguishable from real corruption). ack.json and
 * cancel.json are mutually exclusive terminal markers for the SAME request
 * (each is written no-clobber, by disjoint code paths gated on opposite
 * terminal outcomes) -- both durably present at once is fail-closed here,
 * never silently resolved by trusting whichever one happens to be read first.
 */
function readRootSourceTerminalArtifacts(coordRoot, planRoot, requestId) {
  const requestPath = requestPathFor(planRoot, requestId);
  const requestRec = readCanonicalRequestRecord(requestPath, requestId, {
    absentDetail: 'CORRELATION_INVALID', absentMessage: 'root-source request is absent',
  });
  const txnDir = path.dirname(requestPath);
  const auth = resolveAuthoritativeAttempt(requestRec.obj, txnDir);
  const resultPath = resultPathFor(txnDir, auth.attemptId);

  const ackPath = ackPathFor(txnDir);
  const cancelPath = cancelPathFor(txnDir);
  // M7 CORRECTION C3 (Codex final ruling): a single SHAPE-FREE presence read
  // of each path decides mutual-exclusion FIRST (S16-RSTA-MUTUAL-EXCLUSION-01:
  // two contradictory terminal markers is a fail-closed condition in its own
  // right, and must win over -- never be masked by -- a shape problem in
  // either individual file). Shape/correlation validation for whichever ONE
  // terminal actually applies happens further below, from THIS SAME already
  // -read ack bytes/obj (never a second, independent reopen); the cancel
  // side stays routed through its own sanctioned choke-point reader
  // (CANCEL-AUDIT-01/02 restrict CANCEL_V1_FIELDS/accreditCancelRecord to
  // their three existing entry points, so a shape-free-then-validate split
  // is not achievable there without a fourth, unsanctioned call site).
  const ackClassified = classifyDurableRead(ackPath, { parse: true });
  if (ackClassified.state === DURABLE_PENDING) throw pendingDurableStop(ackPath);
  // M7 GREEN correction round 2, R3: ONE fd-bound read of cancel.json, via
  // the SAME sanctioned CANCEL-AUDIT-01 choke point classifyCanonicalCancelRecord
  // already uses elsewhere -- never a shape-free presence probe followed by
  // a second, independent reopen purely to obtain shape/correlation/digest.
  // Every value used below (state, obj, reqObj, bytes, digest) comes from
  // THIS SAME read.
  const cancelClassified = classifyCanonicalCancelRecord(cancelPath, coordRoot);
  if (cancelClassified.state === DURABLE_PENDING) throw pendingDurableStop(cancelPath);
  if (ackClassified.state !== DURABLE_ABSENT && cancelClassified.state !== DURABLE_ABSENT) {
    throw new CliError('INVALID', 'SECURITY_INVALID', 'root-source request has both ack and cancel terminal markers');
  }
  // M7 section 9: the sole fd-bound classifier/reader -- derives the exact
  // terminalState from that SAME pair of reads, never a caller-supplied
  // reason. Neither durably present yet is OPEN, a real, ordinary case
  // (WAITING at the handler), not an error.
  const terminalState = ackClassified.state !== DURABLE_ABSENT ? 'ACKED' : (cancelClassified.state !== DURABLE_ABSENT ? 'CANCELLED' : 'OPEN');

  // Result: required once ACKED (an acked request must have an authoritative
  // result); otherwise included, validated, whenever already durable --
  // OPEN validates any result already present (a genuine window exists
  // between publish-result and transaction-ack/cancel). CANCELLED also
  // reports a result if one happens to already exist (section 9: "ingress +
  // valid cancel -> ... with request/result-if-present/cancel refs").
  let resultRef = null;
  let resultDigest = null;
  const resultState = classifyDurableRead(resultPath, { parse: true });
  if (resultState.state === DURABLE_PENDING) throw pendingDurableStop(resultPath);
  if (resultState.state !== DURABLE_ABSENT) {
    const resultRec = validateResultV2(resultPath, coordRoot);
    resultRef = path.posix.join('transactions', requestId, 'results', auth.attemptId + '.json');
    resultDigest = resultRec.digest;
  } else if (terminalState === 'ACKED') {
    throw new CliError('INVALID', 'CORRELATION_INVALID', 'root-source acked request has no authoritative result');
  }

  // Accepted-result: required once ACKED; for OPEN, included/validated only
  // when already durable (the real accept-result-before-transaction-ack
  // window) -- never for CANCELLED, which section 9's own table never lists
  // it for.
  let acceptedResultRef = null;
  let acceptedResultDigest = null;
  if (terminalState !== 'CANCELLED') {
    const acceptedPath = acceptedResultPathFor(txnDir);
    const acceptedState = classifyDurableRead(acceptedPath, { parse: true });
    if (acceptedState.state === DURABLE_PENDING) throw pendingDurableStop(acceptedPath);
    if (acceptedState.state !== DURABLE_ABSENT) {
      const acceptedRec = readClosedRecord(acceptedPath, ACCEPTED_RESULT_V1_FIELDS, {
        absentDetail: 'CORRELATION_INVALID', absentMessage: 'root-source accepted-result is absent',
      });
      assertAcceptedResultCorrelates(acceptedRec.obj, txnDir, requestRec.obj, coordRoot);
      acceptedResultRef = path.posix.join('transactions', requestId, 'accepted-result.json');
      acceptedResultDigest = acceptedRec.digest;
    } else if (terminalState === 'ACKED') {
      throw new CliError('INVALID', 'CORRELATION_INVALID', 'root-source accepted-result is absent');
    }
  }

  // M7 GREEN section 4.7: ackRef/ackDigest and cancelRef/cancelDigest are
  // GENUINELY SEPARATE fields -- ACKED populates only ack*, CANCELLED
  // populates only cancel* (never reusing the ack* pair for a cancel.json
  // ref/digest as before), OPEN leaves all four null.
  let ackRef = null;
  let ackDigest = null;
  let cancelRef = null;
  let cancelDigest = null;
  if (terminalState === 'ACKED') {
    // M7 CORRECTION C3: shape+correlation validated from the SAME
    // ackClassified bytes/obj the presence/terminalState decision above
    // already read -- never a second, independent reopen.
    assertClosedShape(ackClassified.obj, ACK_V1_FIELDS);
    if (ackClassified.obj.disposition !== 'accepted' || ackClassified.obj.in_reply_to_attempt_id !== auth.attemptId) {
      throw new CliError('INVALID', 'CORRELATION_INVALID', 'root-source ack does not correlate to the authoritative attempt');
    }
    ackRef = path.posix.join('transactions', requestId, 'ack.json');
    ackDigest = sha256Buffer(ackClassified.bytes);
  } else if (terminalState === 'CANCELLED') {
    // M7 GREEN correction round 2, R3: shape+correlation already fully
    // validated by classifyCanonicalCancelRecord's own accreditCancelRecord
    // call above (the SAME fd-bound read the presence/terminalState
    // decision used) -- never a second, independent reopen.
    if (cancelClassified.reqObj.request_id !== requestId) {
      throw new CliError('INVALID', 'CORRELATION_INVALID', 'root-source cancel does not correlate to this request');
    }
    cancelRef = path.posix.join('transactions', requestId, 'cancel.json');
    cancelDigest = cancelClassified.digest;
  }

  return {
    terminalState,
    requestRef: path.posix.join('transactions', requestId, 'request.json'), requestDigest: requestRec.digest,
    resultRef, resultDigest,
    acceptedResultRef, acceptedResultDigest,
    ackRef, ackDigest,
    cancelRef, cancelDigest,
  };
}

function validateRootConsultCompletionArtifacts(c, completionRec) {
  const completion = completionRec.obj;
  const requestPath = canonicalRequestPathForRootIntent(c);
  const requestRec = readCanonicalRequestRecord(requestPath, c.intent.request_id, {
    absentDetail: 'CORRELATION_INVALID', absentMessage: 'completed root request is absent',
  });
  if (requestRec.digest !== completion.request_digest) {
    throw new CliError('INVALID', 'CORRELATION_INVALID', 'root completion request digest mismatch');
  }
  const txnDir = path.dirname(requestPath);
  const expectedResultPath = resultPathFor(txnDir, c.intent.initial_attempt_id);
  const expectedResultRef = path.posix.join('transactions', c.intent.request_id, 'results', c.intent.initial_attempt_id + '.json');
  if (completion.result_ref !== expectedResultRef) {
    throw new CliError('INVALID', 'CORRELATION_INVALID', 'root completion result ref is not canonical');
  }
  const resultRec = validateResultV2(expectedResultPath, c.coordRoot);
  if (resultRec.digest !== completion.result_digest || resultRec.obj.status !== 'ANSWERED') {
    throw new CliError('INVALID', 'CORRELATION_INVALID', 'root completion result is not the accepted answer');
  }
  const acceptedPath = acceptedResultPathFor(txnDir);
  const acceptedRef = path.posix.join('transactions', c.intent.request_id, 'accepted-result.json');
  if (completion.accepted_result_ref !== acceptedRef) {
    throw new CliError('INVALID', 'CORRELATION_INVALID', 'root completion accepted-result ref is not canonical');
  }
  const acceptedRec = readClosedRecord(acceptedPath, ACCEPTED_RESULT_V1_FIELDS, {
    absentDetail: 'CORRELATION_INVALID', absentMessage: 'root completion accepted-result is absent',
  });
  assertAcceptedResultCorrelates(acceptedRec.obj, txnDir, requestRec.obj, c.coordRoot);
  if (acceptedRec.digest !== completion.accepted_result_digest) {
    throw new CliError('INVALID', 'CORRELATION_INVALID', 'root completion accepted-result digest mismatch');
  }
  const ackPath = ackPathFor(txnDir);
  const ackRef = path.posix.join('transactions', c.intent.request_id, 'ack.json');
  if (completion.ack_ref !== ackRef) {
    throw new CliError('INVALID', 'CORRELATION_INVALID', 'root completion ack ref is not canonical');
  }
  const ackRec = readClosedRecord(ackPath, ACK_V1_FIELDS, {
    absentDetail: 'CORRELATION_INVALID', absentMessage: 'root completion ack is absent',
  });
  if (
    ackRec.digest !== completion.ack_digest || ackRec.obj.disposition !== 'accepted'
    || ackRec.obj.in_reply_to_attempt_id !== resultRec.obj.attempt_id
  ) throw new CliError('INVALID', 'CORRELATION_INVALID', 'root completion ack does not correlate');
  return {
    requestPath, requestDigest: requestRec.digest,
    resultPath: expectedResultPath, resultDigest: resultRec.digest,
    acceptedPath, acceptedDigest: acceptedRec.digest,
    ackPath, ackDigest: ackRec.digest,
    completionPath: completionRec.path, completionDigest: completionRec.digest,
    item: {
      ok: true,
      ready: true,
      status: 'ANSWERED',
      content: resultRec.obj.content,
      resultKind: resultRec.obj.result_kind,
      acceptedPath,
      acceptedDigest: acceptedRec.digest,
      resultPath: expectedResultPath,
      resultDigest: resultRec.digest,
      requestPath,
      requestDigest: requestRec.digest,
      ackPath,
      ackDigest: ackRec.digest,
      dependency: {
        request_id: requestRec.obj.request_id,
        accepted_result_digest: acceptedRec.digest,
        result_digest: resultRec.digest,
        from_role: resultRec.obj.from_role,
      },
    },
  };
}

function readExistingRootConsultCompletion(c) {
  const completionPath = c.rll.rootConsultCompletionPathFor(c.scope.projectRoot, c.intentId);
  const rec = readLifecycleRecordRequired(
    c.rll, completionPath, c.rll.validateRootConsultCompletionRecord,
    {
      intent_id: c.intentId, request_id: c.intent.request_id,
      requester_actor_instance_id: c.scope.actorInstanceId,
    }, 'root-consult completion',
  );
  if (!rec) return null;
  return Object.assign({ rec }, validateRootConsultCompletionArtifacts(c, rec));
}

/** Crash-resumable reserved -> request -> published -> required dispatch WAL. */
function hostBridgeAdvanceRootConsult(capability, coordRootRaw, intentPathRaw) {
  const c = rootConsultIntentContext(capability, coordRootRaw, intentPathRaw);
  if (c.blocked) return rootConsultOperationResult('blocked', c, { reason: c.blocked });
  const completed = readExistingRootConsultCompletion(c);
  if (completed) return rootConsultOperationResult('completed', c, completed);
  const input = requestInputForRootIntent(c);
  const built = buildCanonicalRequest(capability, input);
  assertBuiltRootRequestMatchesIntent(built, c.intent, c.scope);
  const lockDir = c.rll.rootConsultLockDirFor(c.scope.projectRoot, c.intentId);
  const locked = c.rll.withRegistryLock(lockDir, () => {
    const expectedReservation = {
      intent_id: c.intentId, intent_digest: c.intentRec.digest,
      request_id: c.intent.request_id, request_digest: built.digest,
      requester_actor_instance_id: c.scope.actorInstanceId,
    };
    const reservationPath = c.rll.rootConsultReservationPathFor(c.scope.projectRoot, c.intentId);
    let reservationRec = readLifecycleRecordRequired(
      c.rll, reservationPath, c.rll.validateRootConsultReservationRecord,
      expectedReservation, 'root-consult reservation',
    );
    if (!reservationRec) {
      const reservation = Object.assign({ schema: 'runtime/root-consult-reservation/v1' }, expectedReservation, {
        reserved_at: nowIso(), expiry: c.intent.expiry,
      });
      const valid = c.rll.validateRootConsultReservationRecord(reservation, expectedReservation);
      if (!valid.ok) throw new CliError('INVALID', 'SCHEMA_INVALID', 'root-consult reservation construction failed');
      const bytes = Buffer.from(canonicalJSONStringify(reservation), 'utf8');
      c.rll.publishNoClobber(reservationPath, bytes, { allowIdenticalIdempotent: true });
      reservationRec = { obj: reservation, bytes, digest: sha256Buffer(bytes), path: reservationPath };
    }
    const published = publishPreallocatedRequest(capability, input);
    if (published.request_digest !== built.digest) throw new CliError('INVALID', 'CORRELATION_INVALID', 'published root request digest changed');
    const requestRef = path.posix.join('transactions', c.intent.request_id, 'request.json');
    const publishedExpected = {
      intent_id: c.intentId, intent_digest: c.intentRec.digest,
      reservation_digest: reservationRec.digest, request_id: c.intent.request_id,
      request_ref: requestRef, request_digest: built.digest,
    };
    const publishedPath = c.rll.rootConsultPublishedPathFor(c.scope.projectRoot, c.intentId);
    let publishedRec = readLifecycleRecordRequired(
      c.rll, publishedPath, c.rll.validateRootConsultPublishedRecord,
      publishedExpected, 'root-consult published marker',
    );
    if (!publishedRec) {
      const marker = Object.assign({ schema: 'runtime/root-consult-published/v1' }, publishedExpected, { published_at: nowIso() });
      const valid = c.rll.validateRootConsultPublishedRecord(marker, publishedExpected);
      if (!valid.ok) throw new CliError('INVALID', 'SCHEMA_INVALID', 'root-consult published marker construction failed');
      const bytes = Buffer.from(canonicalJSONStringify(marker), 'utf8');
      c.rll.publishNoClobber(publishedPath, bytes, { allowIdenticalIdempotent: true });
      publishedRec = { obj: marker, bytes, digest: sha256Buffer(bytes), path: publishedPath };
    }
    return { published, publishedRec };
  });
  if (!locked || locked.ok !== true) {
    throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'root-consult WAL lock/advance failed');
  }
  const wal = locked.value;
  const dispatched = dispatchCanonical({
    'coordination-root': c.coordRoot, request: built.requestPath,
  }, { requiredDriver: 'codex-app-server', allowIdenticalIdempotent: true });
  return rootConsultOperationResult('ready', c, {
    requestPath: built.requestPath,
    requestRef: wal.publishedRec.obj.request_ref,
    requestDigest: built.digest,
    activationPath: dispatched.artifact_ref,
    item: {
      requestPath: built.requestPath, requestId: c.intent.request_id,
      evidencePolicy: c.intent.evidence_policy,
    },
  });
}

function hostBridgeObserveAndCompleteRootConsult(capability, coordRootRaw, intentPathRaw) {
  const c = rootConsultIntentContext(capability, coordRootRaw, intentPathRaw);
  if (c.blocked) return rootConsultOperationResult('blocked', c, { reason: c.blocked });
  const completed = readExistingRootConsultCompletion(c);
  if (completed) return rootConsultOperationResult('completed', c, completed);
  const publishedPath = c.rll.rootConsultPublishedPathFor(c.scope.projectRoot, c.intentId);
  const publishedRec = readLifecycleRecordRequired(
    c.rll, publishedPath, c.rll.validateRootConsultPublishedRecord,
    { intent_id: c.intentId, intent_digest: c.intentRec.digest, request_id: c.intent.request_id },
    'root-consult published marker',
  );
  if (!publishedRec) return rootConsultOperationResult('pending', c);
  const requestPath = canonicalRequestPathForRootIntent(c);
  const observed = hostBridgeObserveChildResult(capability, c.coordRoot, requestPath);
  if (!observed.ready) return rootConsultOperationResult('pending', c, { requestPath, requestDigest: publishedRec.obj.request_digest });
  const completionPath = c.rll.rootConsultCompletionPathFor(c.scope.projectRoot, c.intentId);
  if (observed.status === 'BLOCKED') {
    return rootConsultOperationResult('blocked', c, {
      reason: observed.reason, requestPath, requestDigest: observed.requestDigest,
      resultRef: path.posix.join('transactions', c.intent.request_id, 'results', path.basename(observed.resultPath)),
      resultDigest: observed.resultDigest,
      ackRef: path.posix.join('transactions', c.intent.request_id, 'ack.json'), ackDigest: observed.ackDigest,
    });
  }
  const completion = {
    schema: 'runtime/root-consult-completion/v1', intent_id: c.intentId,
    request_id: c.intent.request_id, request_digest: observed.requestDigest,
    result_ref: path.posix.join('transactions', c.intent.request_id, 'results', path.basename(observed.resultPath)),
    result_digest: observed.resultDigest,
    accepted_result_ref: path.posix.join('transactions', c.intent.request_id, 'accepted-result.json'),
    accepted_result_digest: observed.acceptedDigest,
    ack_ref: path.posix.join('transactions', c.intent.request_id, 'ack.json'), ack_digest: observed.ackDigest,
    requester_actor_instance_id: c.scope.actorInstanceId, created_at: nowIso(),
  };
  const valid = c.rll.validateRootConsultCompletionRecord(completion, {
    intent_id: c.intentId, request_id: c.intent.request_id,
    requester_actor_instance_id: c.scope.actorInstanceId,
  });
  if (!valid.ok) throw new CliError('INVALID', 'SCHEMA_INVALID', 'root-consult completion construction failed');
  const completionBytes = Buffer.from(canonicalJSONStringify(completion), 'utf8');
  const completionLock = c.rll.withRegistryLock(
    c.rll.rootConsultLockDirFor(c.scope.projectRoot, c.intentId),
    () => {
      // Same actor/capability remains current at the final publication point;
      // a successor cannot complete the predecessor's root operation.
      requireHostBridgeCapability(capability);
      c.rll.publishNoClobber(completionPath, completionBytes, { allowIdenticalIdempotent: true });
      return true;
    },
  );
  if (!completionLock || completionLock.ok !== true || completionLock.value !== true) {
    throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'root-consult completion lock/publication failed');
  }
  const completionRec = readLifecycleRecordRequired(
    c.rll, completionPath, c.rll.validateRootConsultCompletionRecord,
    completion, 'root-consult completion',
  );
  return rootConsultOperationResult('completed', c, {
    requestPath, requestDigest: observed.requestDigest,
    resultPath: observed.resultPath, resultDigest: observed.resultDigest,
    acceptedPath: observed.acceptedPath, acceptedDigest: observed.acceptedDigest,
    ackPath: observed.ackPath, ackDigest: observed.ackDigest,
    completionPath, completionDigest: completionRec.digest,
    item: observed,
  });
}

function hostBridgeListInbox(capability, coordRootRaw) {
  const scope = requireHostBridgeCapability(capability);
  const coordRoot = resolveAbsolute(coordRootRaw);
  const repoId = computeRepoId(scope.projectRoot);
  let rll;
  try { rll = require('./runtime-role-lifecycle.cjs'); } catch (err) { throw new CliError('INVALID', 'INTERNAL_ERROR', 'role lifecycle module unavailable'); }
  const plan = rll.discoverPlan(scope.projectRoot);
  if (!plan.ok || plan.planDigest !== scope.planDigest) throw new CliError('INVALID', 'AUTHORITY_INVALID', 'host bridge PLAN is not current');
  const waveSlug = path.basename(path.dirname(plan.planPath)).slice('wave-'.length);
  const planRoot = planRootPath(coordRoot, repoId, waveSlug, scope.planDigest);
  const inboxDir = path.join(planRoot, 'inbox', scope.role);
  let entries;
  try { entries = fs.readdirSync(inboxDir, { withFileTypes: true }); }
  catch (err) {
    if (err && err.code === 'ENOENT') return [];
    throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'unable to scan role inbox');
  }
  if (entries.length > 4096) throw new CliError('INVALID', 'SECURITY_INVALID', 'role inbox scan cap exceeded');
  const out = [];
  for (const entry of entries) {
    // ROOT-INGRESS-E2E finding: a root-consult request_id is the CLI's own
    // preallocated 32-hex id (crypto.randomBytes(16), same shape validated by
    // isHexId elsewhere in this file -- see INBOX_REF_V1_FIELDS.request_id
    // above), never genId()'s 64-hex. This filename filter hardcoded exactly
    // 64 hex chars and silently dropped every root-consult inbox entry before
    // the target worker ever saw it -- the retained plane advanced the WAL
    // and published the request (request_ref/request_digest went durable)
    // but nothing downstream ever claimed it, so consult-root-status stayed
    // WAITING forever with result_ref/accepted_result_ref/ack_ref all null.
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const inboxRequestId = entry.name.slice(0, -'.json'.length);
    if (!isHexId(inboxRequestId)) continue;
    const inboxPath = path.join(inboxDir, entry.name);
    const inbox = validateInboxRefV1(inboxPath, coordRoot);
    if (inbox.target_role !== scope.role) continue;
    const requestPath = requestPathFor(planRoot, inbox.request_id);
    // A request that has already expired is no longer live/executable authority,
    // so an unresolvable activation for it is benign, not a correlation failure --
    // check expiry (via a fresh accredited read, never skipping the correlation
    // check itself) before ever calling resolveActivationForRequestPath.
    const accredited = accreditCanonicalRequest(coordRoot, requestPath);
    if (
      accredited.digest !== inbox.request_digest
      || accredited.obj.target_role !== inbox.target_role
      || accredited.obj.target_role !== scope.role
    ) {
      throw new CliError('INVALID', 'CORRELATION_INVALID', 'accredited request does not correlate with its role inbox entry');
    }
    if (currentClockMs() >= isoToMs(accredited.obj.expiry)) continue;
    // A transaction that already reached a canonical terminal state (cancel,
    // accepted-result, or an authoritative result) is no longer schedulable
    // work -- its activation's own, much shorter, liveness naturally expires
    // once the work is done, so an unresolvable activation for an
    // already-terminal transaction is benign, not a correlation failure.
    // Check terminal state (via the SAME durable readers/shapes the
    // nonterminal path below still uses) before ever calling
    // resolveActivationForRequestPath.
    const preTerminalTxnDir = path.dirname(requestPath);
    const preTerminalAuth = resolveAuthoritativeAttempt(accredited.obj, preTerminalTxnDir);
    // CANCEL-AUDIT-01: reads cancel.json ONLY through the sanctioned choke
    // point (see hostBridgeScheduleTurn's identical comment).
    if (readCanonicalCancelRecordOptional(cancelPathFor(preTerminalTxnDir), coordRoot) !== null) continue;
    if (readJsonDurableOptional(acceptedResultPathFor(preTerminalTxnDir), { shape: (o) => assertClosedShape(o, ACCEPTED_RESULT_V1_FIELDS) }) !== null) continue;
    if (readJsonDurableOptional(resultPathFor(preTerminalTxnDir, preTerminalAuth.attemptId), { shape: (o) => assertClosedShape(o, RESULT_V2_FIELDS) }) !== null) continue;
    const activation = resolveActivationForRequestPath(requestPath);
    if (!activation.ok) {
      throw new CliError('INVALID', 'CORRELATION_INVALID', 'role inbox request activation is not resolvable');
    }
    // Persistent app-server polling is disk-visible but driver-specific.  A
    // request routed to Claude, MCP, runtime-spawn or noop remains owned by
    // that driver and is ignored here; it must never make the retained Codex
    // worker fail merely because all drivers share the same role inbox.
    if (!activation.activation || activation.activation.selected_driver !== 'codex-app-server') continue;
    const checked = requireHostBridgeRequestScope(capability, coordRoot, requestPath);
    const txnDir = path.dirname(requestPath);
    const auth = resolveAuthoritativeAttempt(checked.reqObj, txnDir);
    // Host-private correlation only; never part of consult/v2 and never
    // projected into model-controlled wire data as an authority field.
    const evidenceAuthority = resolveRootEvidenceAuthority(checked.reqObj, checked.requestDigest, coordRoot, scope);
    out.push({
      requestPath,
      requestId: checked.reqObj.request_id,
      createdAt: inbox.created_at,
      attemptId: auth.attemptId,
      leaseEpoch: auth.leaseEpoch,
      expectedResultKind: checked.reqObj.expected_result_kind,
      question: checked.reqObj.question,
      rootRequestId: checked.reqObj.root_request_id,
      parentRequestId: checked.reqObj.parent_request_id,
      depth: checked.reqObj.depth,
      maxDepth: checked.reqObj.max_depth,
      evidencePolicy: evidenceAuthority.policy,
      // M6/M7 terminal functional closure, point C/D: propagated so the
      // retained worker can host-enforce an exact gap.library_id lock
      // (never null/search) once a directive already named the library.
      approvedContext7LibraryId: evidenceAuthority.libraryId,
    });
  }
  out.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.requestId.localeCompare(b.requestId));
  return out;
}

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
    // M7/WP4 (PLAN.md ~L604): role-command-grant/v1 consume+validate,
    // strictly BEFORE handler(flags) performs any read or mutation.
    const grantContext = validateAndConsumeRoleCommandGrantForCommand(command, flags, argv.slice(1));
    // M7/WP4 group A correction: grantContext (undefined for any command
    // outside ROLE_COMMAND_GRANT_AUTHORITY_FOR_COMMAND) is now threaded to
    // the handler -- every other handler in COMMANDS keeps its existing
    // single-arg (flags) signature and simply ignores the extra argument
    // (JS silently drops an unused parameter), so this is a safe, additive
    // change for every command except cmdPublishRequest, which now consumes
    // it to derive an authenticated source_role.
    // Sixteenth §16b: a root-source-backed publish-request is serialized
    // under rootSourceLockDirFor(bindingId) -- revalidated fresh inside the
    // lock, recovered from a bounded actor-scoped scan instead of re-minting
    // when a prior attempt (this call, or a crashed one) already published,
    // and bound to exactly one durable root transaction via publishRootIngress
    // before the command is considered SUCCESS. Every other command/binding
    // keeps its existing unconditional single call, unchanged.
    const extra = (command === 'publish-request' && isRootSourceGrantContext(grantContext))
      ? serializeRootSourcePublishRequest(grantContext, flags, handler)
      : (handler(flags, grantContext) || {});
    // M7 section 4/8.5: the retirement-wiring this block used to perform
    // after transaction-ack/cancel/publish-result/cancel (root-source and
    // one-shot alike) is REMOVED -- no new retirement artifact is ever
    // written. root-source's own terminal is cut by canonical ack.json/
    // cancel.json directly (root-source-status's own section 9 rewrite
    // reads them, never a retirement marker); one-shot publish-result's
    // terminal is cut by its own no-clobber write to accepted-result.json
    // (already enforced at that write site, independent of this block);
    // cancellation of a one-shot target is cut by canonical cancel.json.
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

function routingOverrideInvalid(reason) {
  return new Error('RUNTIME_TEST_ROUTING_OVERRIDE_INVALID:' + reason);
}

/**
 * R2-C (M6-M7-R2C-TEST-SEAM-CLOSURE-20260820): the ONE test-only seam that
 * lets the REAL canonical runtime-consultation.cjs -- the exact file
 * root-source-initiated publish-request is structurally pinned to
 * (findLifecycleCliInvocation's exact CANONICAL_LIFECYCLE_CLI_PATH match +
 * decodeRootSourceBootstrapIntentFromAction's own __dirname-relative
 * runtime-consultation.cjs check, both untouched by this seam) -- load its
 * own ROUTING_POLICY_CONTENT from a private, TMPDIR-confined fixture instead
 * of the real repo file, so an E2E fixture can prove routing selection
 * without ever needing a private COPY of this script (which the two checks
 * above make structurally unreachable for that exact flow).
 *
 * Absent/empty RUNTIME_CONSULTATION_TEST_ROUTING_POLICY_PATH: byte-for-byte
 * the prior unconditional behavior (real scripts/lib/runtime-routing.json,
 * digest 9fd518e25f...406fa unchanged). Present: gated behind the SAME
 * isTestCapability() seam as --fixed-ids/--fixed-clock (cjs:208) -- checked
 * BEFORE the path is even read, so a missing gate never touches the
 * filesystem at all. Every rejection throws the deterministic
 * `RUNTIME_TEST_ROUTING_OVERRIDE_INVALID:<reason>` Error, mirroring the
 * sibling malformed-canonical-routing.json throw below (module-load-time
 * invariant, never a per-request CliError/detail_code -- there is no
 * fitting closed enum member for this, and adding one would be a bigger,
 * unauthorized surface change).
 */
function loadRoutingPolicyContent() {
  const raw = process.env.RUNTIME_CONSULTATION_TEST_ROUTING_POLICY_PATH;
  if (typeof raw !== 'string' || raw.length === 0) {
    return fs.readFileSync(path.join(__dirname, 'runtime-routing.json'));
  }
  if (!isTestCapability()) {
    throw routingOverrideInvalid('test-capability-required');
  }
  if (!path.isAbsolute(raw)) {
    throw routingOverrideInvalid('path-not-absolute');
  }
  let realOverridePath;
  try {
    realOverridePath = fs.realpathSync(raw);
  } catch (err) {
    throw routingOverrideInvalid('path-not-real');
  }
  if (realOverridePath !== path.resolve(raw)) {
    // Catches EITHER a symlink anywhere in the path (realpath follows it,
    // resolve does not) OR a lexical alias (e.g. case-folding on a
    // case-insensitive-but-case-preserving filesystem) -- one comparison,
    // no separate symlink-detection logic needed.
    throw routingOverrideInvalid('path-not-real');
  }
  let realTmpdir;
  try {
    realTmpdir = fs.realpathSync(os.tmpdir());
  } catch (err) {
    throw routingOverrideInvalid('tmpdir-not-secure');
  }
  let tmpdirLstat;
  try {
    tmpdirLstat = fs.lstatSync(realTmpdir);
  } catch (err) {
    throw routingOverrideInvalid('tmpdir-not-secure');
  }
  const isPosix = process.platform !== 'win32';
  if (
    !tmpdirLstat.isDirectory()
    || (isPosix && typeof process.getuid === 'function' && tmpdirLstat.uid !== process.getuid())
    || (isPosix && (tmpdirLstat.mode & 0o777) !== 0o700)
  ) {
    throw routingOverrideInvalid('tmpdir-not-secure');
  }
  if (realOverridePath === realTmpdir || !realOverridePath.startsWith(realTmpdir + path.sep)) {
    throw routingOverrideInvalid('path-outside-tmpdir');
  }
  let classified;
  try {
    classified = classifyDurableRead(realOverridePath, {});
  } catch (err) {
    if (err instanceof CliError) {
      throw routingOverrideInvalid(err.detailCode === 'DURABILITY_UNPROVEN' ? 'file-durability-unproven' : 'file-security-invalid');
    }
    throw err;
  }
  if (classified.state === DURABLE_ABSENT) {
    throw routingOverrideInvalid('file-not-found');
  }
  if (classified.state === DURABLE_PENDING) {
    throw routingOverrideInvalid('file-durability-unproven');
  }
  const bytes = classified.bytes;
  let obj;
  try {
    obj = JSON.parse(bytes.toString('utf8'));
  } catch (err) {
    throw routingOverrideInvalid('schema-invalid');
  }
  if (!obj || typeof obj !== 'object' || obj.schema !== ROUTING_POLICY_VERSION || !obj.routes || typeof obj.routes !== 'object' || Array.isArray(obj.routes)) {
    throw routingOverrideInvalid('schema-invalid');
  }
  return bytes;
}

const ROUTING_POLICY_CONTENT = loadRoutingPolicyContent();
const ROUTING_POLICY_DIGEST = sha256Buffer(ROUTING_POLICY_CONTENT);
const ROUTING_POLICY_TABLE = JSON.parse(ROUTING_POLICY_CONTENT.toString('utf8'));
if (ROUTING_POLICY_TABLE.schema !== ROUTING_POLICY_VERSION || !ROUTING_POLICY_TABLE.routes || typeof ROUTING_POLICY_TABLE.routes !== 'object') {
  // Fail fast at module load, not at first dispatch -- a malformed toolkit
  // routing.json is a harness integrity defect, never a per-request condition.
  // Unreachable for the test-override path above (loadRoutingPolicyContent
  // already enforces this exact check, deterministically, before returning),
  // so this stays exactly what it was: the canonical-file guard only.
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

/**
 * Pure canonical request constructor shared by ordinary CLI publication and
 * Sixteenth's preallocated retained-worker root WAL.  All entropy and time
 * are inputs; this function never reads a clock, generates an id, or writes.
 */
function buildCanonicalRequestFromFields(fields) {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
    throw new CliError('INVALID', 'SCHEMA_INVALID', 'canonical request fields are invalid');
  }
  const requestObj = {
    schema: 'coordination/consult/v2',
    request_id: fields.requestId,
    root_request_id: fields.rootRequestId || fields.requestId,
    parent_request_id: fields.parentRequestId === undefined ? null : fields.parentRequestId,
    depth: fields.depth === undefined ? 0 : fields.depth,
    max_depth: MAX_DEPTH_LIMIT,
    source_role: fields.sourceRole,
    target_role: fields.targetRole,
    target_role_profile_version: fields.targetRoleProfileVersion || TARGET_ROLE_PROFILE_VERSION,
    target_role_profile_digest: fields.targetRoleProfileDigest || targetRoleProfileDigestFor(fields.targetRole),
    requester_worktree_id: fields.worktreeId,
    requester_instance_id: fields.requesterInstanceId,
    repo_id: fields.repoId,
    wave_slug: fields.waveSlug,
    protocol_profile: 'runtime-consultation/v1',
    coordination_root_id: fields.coordinationRootId,
    plan_digest: fields.planDigest,
    subject_repo_id: fields.subjectRepoId || fields.repoId,
    subject_worktree_id: fields.subjectWorktreeId || fields.worktreeId,
    subject_head: fields.subjectHead,
    subject_scope_digest: fields.subjectScopeDigest,
    created_at: fields.createdAt,
    question: fields.question,
    expected_result_kind: fields.expectedResultKind,
    expiry: fields.expiry,
    recovery_budget: 1,
    routing_policy_version: fields.routingPolicyVersion || ROUTING_POLICY_VERSION,
    routing_policy_digest: fields.routingPolicyDigest || ROUTING_POLICY_DIGEST,
    initial_attempt_id: fields.initialAttemptId,
    initial_lease_epoch: 0,
  };
  if (fields.contentRef !== undefined && fields.contentRef !== null) requestObj.content_ref = fields.contentRef;
  assertClosedShape(requestObj, CONSULT_V2_FIELDS);
  return {
    request: requestObj,
    bytes: Buffer.from(canonicalJSONStringify(requestObj), 'utf8'),
  };
}

function deriveCanonicalRequestFields(coordRoot, planPath, subjectBundleManifest, authority, input) {
  const planDigest = sha256File(planPath);
  const waveSlug = path.basename(path.dirname(planPath)).replace(/^wave-/, '');
  const repoId = computeRepoId(coordRoot);
  const worktreeId = computeWorktreeId(coordRoot);
  const subjectScopeDigest = sha256String(canonicalJSONStringify(subjectBundleManifest));
  const planRoot = planRootPath(coordRoot, repoId, waveSlug, planDigest);
  const parentRequestId = input.parentRequestId === undefined ? null : input.parentRequestId;
  let depth = 0;
  let rootRequestId = input.requestId;
  if (parentRequestId !== null) {
    const parentObj = validateConsultV2(requestPathFor(planRoot, parentRequestId), coordRoot);
    depth = parentObj.depth + 1;
    rootRequestId = parentObj.root_request_id;
    if (depth > parentObj.max_depth) {
      throw new CliError('INVALID', 'CORRELATION_INVALID', 'nested request would exceed max_depth');
    }
  }
  const built = buildCanonicalRequestFromFields({
    requestId: input.requestId,
    initialAttemptId: input.initialAttemptId,
    createdAt: input.createdAt,
    expiry: input.expiry,
    rootRequestId,
    parentRequestId,
    depth,
    sourceRole: authority.role,
    requesterInstanceId: authority.actorInstanceId,
    targetRole: input.targetRole,
    targetRoleProfileVersion: input.targetRoleProfileVersion,
    targetRoleProfileDigest: input.targetRoleProfileDigest,
    question: input.question,
    expectedResultKind: input.expectedResultKind,
    contentRef: input.contentRef,
    repoId,
    worktreeId,
    waveSlug,
    coordinationRootId: computeCoordRootId(coordRoot),
    planDigest,
    subjectHead: computeSubjectHead(coordRoot),
    subjectScopeDigest,
    routingPolicyVersion: input.routingPolicyVersion,
    routingPolicyDigest: input.routingPolicyDigest,
  });
  if (built.request.content_ref) resolveContentRefOrThrow(planRoot, built.request.content_ref);
  assertRolePolicy(built.request.source_role, built.request.target_role);
  return Object.assign(built, {
    coordRoot, planPath, planRoot, planDigest, repoId, worktreeId,
    subjectBundleManifest, subjectScopeDigest,
    requestPath: requestPathFor(planRoot, built.request.request_id),
    digest: sha256Buffer(built.bytes),
  });
}

/**
 * Host-capability-only deterministic constructor for a preallocated request.
 * The public surface intentionally requires the non-serializable capability;
 * arbitrary callers cannot use it as a root-authority factory.
 */
function buildCanonicalRequest(capability, input) {
  const scope = requireHostBridgeCapability(capability);
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new CliError('INVALID', 'SCHEMA_INVALID', 'preallocated request input is invalid');
  }
  const coordRoot = resolveAbsolute(input.coordinationRoot);
  const planPath = resolveAbsolute(input.planPath);
  const manifest = input.subjectBundleManifest;
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new CliError('INVALID', 'SCHEMA_INVALID', 'subject bundle manifest is invalid');
  }
  assertClosedShape(manifest, SUBJECT_BUNDLE_MANIFEST_V1_FIELDS);
  for (const entry of manifest.entries) assertClosedShape(entry, SUBJECT_BUNDLE_ENTRY_FIELDS);
  if (input.parentRequestId !== null && input.parentRequestId !== undefined) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'preallocated root request must have parent_request_id:null');
  }
  if (
    input.routingPolicyVersion !== ROUTING_POLICY_VERSION
    || input.routingPolicyDigest !== ROUTING_POLICY_DIGEST
    || input.targetRoleProfileVersion !== TARGET_ROLE_PROFILE_VERSION
    || input.targetRoleProfileDigest !== targetRoleProfileDigestFor(input.targetRole)
    || !hostBridgeAllowedChildRoles(scope.role).includes(input.targetRole)
  ) throw new CliError('INVALID', 'AUTHORITY_INVALID', 'preallocated root request routing/topology/profile is not current');
  const built = deriveCanonicalRequestFields(coordRoot, planPath, manifest, {
    role: scope.role, actorInstanceId: scope.actorInstanceId,
  }, Object.assign({}, input, { parentRequestId: null }));
  if (
    built.worktreeId !== scope.worktreeId || built.planDigest !== scope.planDigest
    || built.request.source_role !== scope.role
    || built.request.requester_instance_id !== scope.actorInstanceId
    || built.request.root_request_id !== built.request.request_id
    || built.request.depth !== 0
  ) throw new CliError('INVALID', 'AUTHORITY_INVALID', 'preallocated request scope does not match HostBridgeCapability');
  return built;
}

/** Publish the exact bytes returned by buildCanonicalRequest; replay is legal only byte-identically. */
function publishPreallocatedRequest(capability, input) {
  const built = buildCanonicalRequest(capability, input);
  fs.mkdirSync(built.planRoot, { recursive: true });
  materializePlanRef(built.planRoot, built.planPath);
  materializeRoutingPolicy(built.planRoot);
  materializeSubjectBundle(built.planRoot, built.subjectScopeDigest, built.subjectBundleManifest);
  const receipt = publishNoClobber(built.requestPath, built.bytes, { allowIdenticalIdempotent: true });
  assertArtifactMatchesReceipt(built.requestPath, receipt, built.bytes);
  return {
    request_id: built.request.request_id,
    artifact_ref: built.requestPath,
    request_digest: built.digest,
    request: built.request,
  };
}

function cmdPublishRequest(flags, grantContext) {
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

  // M7/WP4 group A correction (dispatch arch-testing-20260810T142647Z):
  // source_role is now derived EXCLUSIVELY from the authenticated requester
  // grant/binding this exact command was already required to consume
  // before this handler ever ran (main()'s own
  // validateAndConsumeRoleCommandGrantForCommand call, strictly before any
  // read or mutation) -- never from a caller-supplied environment variable.
  // RUNTIME_CONSULTATION_SOURCE_ROLE was never reachable from a genuine
  // hook-mediated call in the first place: an env-var-PREFIXED command
  // (`FOO=bar node ...`) is not the canonical `node <script> <args...>`
  // token[0]==='node' shape the requester-grant-injecting hook recognizes,
  // so a live call always fell back to the literal 'cli-requester', which
  // could never pass assertRolePolicy's mediated-chain guard for
  // target_role:'context-provider'. A grant missing its role at this point
  // (strictly after full grant/binding consumption+validation) is a
  // genuine authority failure, never a value to silently default away.
  //
  // Main-review correction (orchestrating session, Phase 4): this check now
  // runs BEFORE planRoot's own materialization (mkdirSync/plan_ref/
  // routing-policy/subject-bundle below) -- mirrors the identical "validate
  // fully before the first write" discipline the parent-request validation
  // block above this already established (Codex NO-GO round 3). An
  // unauthorized-role grant (e.g. a legitimately-minted but non-arch-*
  // requester grant reaching this handler) must never be able to cause any
  // of these four writes before being rejected.
  if (!grantContext || typeof grantContext.role !== 'string' || grantContext.role.length === 0) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'publish-request requires an authenticated requester grant to derive source_role');
  }
  const sourceRole = grantContext.role;
  assertRolePolicy(sourceRole, intent.target_role);

  fs.mkdirSync(planRoot, { recursive: true });
  materializePlanRef(planRoot, planPath);
  materializeRoutingPolicy(planRoot);
  materializeSubjectBundle(planRoot, subjectScopeDigest, subjectBundleManifest);

  const requestId = genId();
  if (!parentRequestId) rootRequestId = requestId;

  const builtRequest = buildCanonicalRequestFromFields({
    requestId,
    rootRequestId,
    parentRequestId,
    depth,
    sourceRole,
    targetRole: intent.target_role,
    requesterInstanceId: grantContext.actorInstanceId,
    repoId,
    worktreeId,
    waveSlug,
    coordinationRootId: coordRootId,
    planDigest,
    subjectHead,
    subjectScopeDigest,
    createdAt: nowIso(),
    question: intent.question,
    expectedResultKind: intent.expected_result_kind,
    expiry: intent.expiry,
    initialAttemptId: genId(),
    contentRef: intent.content_ref,
  });
  const requestObj = builtRequest.request;

  // Gap#2 (WP2 conformance, PLAN.md ~L761): "content_ref must equal a freshly
  // revalidated publish-blob handle" -- a shape-valid-but-fabricated content_ref
  // (blob != digest, or no real backing file) must be rejected HERE, at publish
  // time, not only by a later optional `validate` call. Mirrors
  // validateConsultV2's own `if (obj.content_ref) resolveContentRefOrThrow(...)`
  // pattern (~L893-895), applied here to the not-yet-published request object.
  if (intent.content_ref) resolveContentRefOrThrow(planRoot, intent.content_ref);

  // Fail closed on any internal inconsistency rather than publishing a record
  // `validate --kind consult-v2` would later reject.
  const requestPath = requestPathFor(planRoot, requestId);
  publishNoClobber(requestPath, builtRequest.bytes, { allowIdenticalIdempotent: true });

  return { request_id: requestId, artifact_ref: requestPath };
}
COMMANDS['publish-request'] = cmdPublishRequest;

/**
 * PLAN.md §16b WAL serialization for the root-source one-shot requester.
 * Bounded scan of an ALREADY-owned transactions/ directory for a root
 * (parent_request_id:null) request this exact binding's actor already
 * published -- actor_instance_id is minted once per root-source binding and
 * stamped onto any request it publishes via cmdPublishRequest's own
 * requesterInstanceId field, so it is a reliable, already-existing
 * idempotency key. No new schema/record type is introduced. Mirrors
 * hostBridgePublishChildRequest's own bounded transactions/ scan (cap,
 * isHexId filter, fail-closed on an unaccredited entry) above.
 */
function findRootSourceActorRequest(planRoot, actorInstanceId) {
  const transactionsDir = path.join(planRoot, 'transactions');
  let entries;
  try { entries = fs.readdirSync(transactionsDir, { withFileTypes: true }); }
  catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'unable to inspect root-source publish inventory');
  }
  if (entries.length > 4096) throw new CliError('INVALID', 'SECURITY_INVALID', 'root-source publish inventory cap exceeded');
  let found = null;
  for (const entry of entries) {
    if (!entry.isDirectory() || !isHexId(entry.name)) continue;
    const candidatePath = requestPathFor(planRoot, entry.name);
    let candidate;
    try { candidate = readCanonicalRequestRecord(candidatePath, entry.name, {}); }
    catch (err) { throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'root-source publish inventory contains an unaccredited request'); }
    const obj = candidate.obj;
    if (obj.source_role === 'toolkit-specialist' && obj.parent_request_id === null && obj.requester_instance_id === actorInstanceId) {
      if (found) throw new CliError('INVALID', 'CORRELATION_INVALID', 'root-source publish inventory has more than one root request for the same actor');
      found = { requestId: obj.request_id, path: candidatePath, digest: candidate.digest };
    }
  }
  return found;
}

/**
 * PLAN.md §16b: serializes cmdPublishRequest+publishRootIngress under
 * rootSourceLockDirFor(bindingId) so two concurrent grants for the SAME
 * binding can never produce two roots, and a crash between request.json
 * durably publishing and root-ingress durably publishing recovers the
 * EXISTING request on the next attempt instead of minting another one.
 * Revalidates the binding fresh INSIDE the lock -- never trusts the
 * pre-lock grantContext snapshot for the liveness/retirement decision.
 */
function serializeRootSourcePublishRequest(grantContext, flags, handler) {
  const rll = require('./runtime-role-lifecycle.cjs');
  const repoDescriptor = { repoId: grantContext.repoId };
  const bindingId = grantContext.bindingId;
  const lockDir = rll.rootSourceLockDirFor(repoDescriptor, bindingId);
  const locked = rll.withRegistryLock(lockDir, () => {
    const revalidated = rll.validateRootSourceBindingFor(
      repoDescriptor, bindingId, 'toolkit-specialist',
      grantContext.binding.worktree_id, grantContext.binding.plan_digest,
    );
    if (!revalidated.ok) {
      throw new CliError('INVALID', 'AUTHORITY_INVALID', 'root-source binding is no longer valid: ' + revalidated.reason);
    }

    const coordRoot = resolveAbsolute(flags['coordination-root']);
    const planPath = resolveAbsolute(flags.plan);
    const planDigest = sha256File(planPath);
    const waveSlug = path.basename(path.dirname(planPath)).replace(/^wave-/, '');
    const repoId = computeRepoId(coordRoot);
    const planRoot = planRootPath(coordRoot, repoId, waveSlug, planDigest);
    const existing = findRootSourceActorRequest(planRoot, revalidated.binding.actor_instance_id);

    const extra = existing
      ? { request_id: existing.requestId, artifact_ref: existing.path }
      : (handler(flags, grantContext) || {});
    const reqPath = resolveAbsolute(extra.artifact_ref);
    const reqRec = readCanonicalRequestRecord(reqPath, extra.request_id, {});

    const existingIngress = rll.readRegistryRecord(rll.rootSourceIngressPathFor(repoDescriptor, bindingId));
    if (!existingIngress.ok) throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'root-source ingress registry unreadable');
    if (!existingIngress.absent) {
      if (existingIngress.obj.request_id !== reqRec.obj.request_id || existingIngress.obj.request_digest !== reqRec.digest) {
        throw new CliError('INVALID', 'CORRELATION_INVALID', 'root-source ingress does not correlate with the recovered request');
      }
      return extra;
    }

    const ingress = rll.publishRootIngress(repoDescriptor, revalidated.binding, {
      requestId: reqRec.obj.request_id, requestDigest: reqRec.digest,
    });
    if (!ingress || ingress.ok !== true) {
      throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'request published but root-source ingress could not be proven durable');
    }
    return extra;
  });
  if (!locked || locked.ok !== true) {
    throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'root-source publish-request WAL lock/advance failed');
  }
  return locked.value;
}

function minIso(a, b) {
  return isoToMs(a) <= isoToMs(b) ? a : b;
}

// ─────────────────────────────────────────────────────────────────────────────
// `claim` (PLAN.md ~L764) -- win claim/v1, then publish the initial active-lease
// ─────────────────────────────────────────────────────────────────────────────

function cmdClaim(flags, grantContext) {
  requireFlags(flags, ['coordination-root', 'request', 'role']);
  const coordRoot = resolveAbsolute(flags['coordination-root']);
  const requestPath = resolveAbsolute(flags.request);
  const txnDir = path.dirname(requestPath);
  // Codex NO-GO round 17 (P0): this preflight used to be
  // readRequestForTxnOrCorrelationInvalid(txnDir) (no coordRoot confinement/
  // geometry check, and no in-lock identity re-check against it at all) --
  // accreditCanonicalRequest's own doc comment already named claim as sharing
  // this exact asymmetry with the pre-round-10/11 cmdCancel/cmdAcceptResult,
  // deliberately left unfixed until now. A request.json substitution that
  // preserves initial_attempt_id/initial_lease_epoch (so auth/auth2 still
  // match) but changes another field -- expiry, target_role_profile_digest --
  // would previously go undetected: the claim's own target_role_profile_digest
  // is baked in from this pre-lock read, and leaseObj's own lease_expiry is
  // derived from the in-lock re-read, with nothing ever proving the two reads
  // saw the identical, unmutated file. Aligned here with cmdCancel/
  // cmdAcceptResult/cmdTakeover's own established pattern: preflight, then
  // in-lock re-read + assertRequestIdentityMatches before trusting any field.
  const preflight = accreditCanonicalRequest(coordRoot, requestPath);
  const reqObj = preflight.obj;
  const auth = resolveAuthoritativeAttempt(reqObj, txnDir);
  if (
    !grantContext
    || typeof grantContext.actorInstanceId !== 'string'
    || !isHexId(grantContext.actorInstanceId)
    || grantContext.role !== flags.role
    || reqObj.target_role !== flags.role
  ) throw new CliError('INVALID', 'AUTHORITY_INVALID', 'claim target identity does not match its target grant/capability');
  const activation = resolveActivationForRequestPath(requestPath);
  if (
    !activation.ok || !activation.activation
    || activation.requestId !== reqObj.request_id
    || activation.attemptId !== auth.attemptId
    || activation.leaseEpoch !== auth.leaseEpoch
    || activation.targetRole !== reqObj.target_role
    || activation.activation.target_role_profile_digest !== reqObj.target_role_profile_digest
  ) throw new CliError('INVALID', 'AUTHORITY_INVALID', 'claim does not match the current activation');
  const claimDriver = activation.activation.selected_driver;
  if (
    grantContext.driver !== undefined
    && grantContext.driver !== claimDriver
  ) throw new CliError('INVALID', 'AUTHORITY_INVALID', 'claim capability driver does not match activation');
  const workerSessionId = grantContext.workerSessionId !== undefined
    ? grantContext.workerSessionId
    : (flags['worker-session'] || null);
  testRendezvous(txnDir, 'claim-preflight-pre-election');

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
    claimant_instance_id: grantContext.actorInstanceId,
    worker_session_id: workerSessionId,
    target_role_profile_digest: reqObj.target_role_profile_digest,
    driver: claimDriver,
    created_at: nowIso(),
  };
  const claimPath = claimPathFor(txnDir, auth.attemptId);
  const claimBytes = Buffer.from(canonicalJSONStringify(claimObj), 'utf8');
  // Codex HARD NO-GO (round 17 -> 18 -> 19): the election publish below is a
  // no-clobber, first-writer-wins WRITE -- once it durably lands, a
  // SUBSEQUENT, legitimate claimant racing against the CURRENT (possibly
  // different) request.json can never overwrite it; they only ever observe
  // EEXIST/AUTHORITY_INVALID, regardless of whose data was actually correct.
  // Round 18 re-accredited request.json immediately before CALLING
  // publishNoClobber, and claimed that closed the window "to the tightest
  // achievable" -- Codex HARD NO-GO (round 19): it did not. publishNoClobber's
  // OWN internal sequence (mkdir, temp create/harden/write/fsync/fstat/close)
  // still ran entirely unrevalidated between that check and the actual
  // linkSync election, and fsync in particular is not instantaneous.
  // `revalidateBeforeLink` (see publishNoClobber's own doc comment) runs this
  // SAME check as the LAST statement before linkSync itself, closing that
  // remaining window too -- down to the gap between the callback returning
  // and linkSync executing, the tightest achievable without a hypothetical
  // atomic compare-then-link primitive.
  const claimReceipt = publishNoClobber(claimPath, claimBytes, {
    raceDetailCode: 'AUTHORITY_INVALID',
    revalidateBeforeLink: () => {
      testRendezvous(txnDir, 'claim-pre-link-revalidate');
      const freshAccredited = accreditCanonicalRequest(coordRoot, requestPath);
      assertRequestIdentityMatches(preflight, freshAccredited, requestPath);
      // M7 section 8.5: claim gains the SAME final cancel/terminal absence
      // read already applied by publish-result (cmdPublishResult, below),
      // at its own last existing no-clobber write boundary -- claim stays
      // outside the transaction lock exactly as before; this
      // revalidateBeforeLink callback IS the admission point.
      const freshExistingAccepted = readJsonDurableOptional(acceptedResultPathFor(txnDir), { shape: (o) => assertClosedShape(o, ACCEPTED_RESULT_V1_FIELDS) });
      if (freshExistingAccepted !== null) {
        assertAcceptedResultCorrelates(freshExistingAccepted, txnDir, freshAccredited.obj, coordRoot);
        throw new CliError('INVALID', 'AUTHORITY_INVALID', 'transaction already has an accepted-result.json');
      }
      if (readCanonicalCancelRecordOptional(cancelPathFor(txnDir), coordRoot) !== null) {
        throw new CliError('CANCELLED', 'TRANSACTION_CANCELLED', 'transaction was already cancelled');
      }
      // M7 CORRECTION C3 (Codex final ruling): the AUTHORITATIVE result
      // (results/<attempt>.json) is a SEPARATE terminal from
      // accepted-result.json (a downstream, requester-side artifact, never a
      // substitute for it) -- resolved fresh from the just-reaccredited
      // request, checked directly here at the admission point via the SAME
      // canonical fd-bound validateResultV2 pipeline every other
      // authoritative surface uses (never durability+shape alone). PENDING
      // fails closed DURABILITY_UNPROVEN before ever attempting validation. A
      // malformed/non-correlating durable record (validateResultV2's own
      // CORRELATION_INVALID) is DURABILITY_UNPROVEN too -- never treated as
      // "no terminal" and never conflated with a genuinely valid, denying
      // terminal. Only a result that VALIDATES cleanly denies at this frozen
      // boundary (AUTHORITY_INVALID).
      const freshAuth = resolveAuthoritativeAttempt(freshAccredited.obj, txnDir);
      const freshResultPath = resultPathFor(txnDir, freshAuth.attemptId);
      const freshResultState = classifyDurableRead(freshResultPath, { parse: true });
      if (freshResultState.state === DURABLE_PENDING) {
        throw new CliError('INVALID', 'DURABILITY_UNPROVEN', "the current attempt's authoritative result is still in the nlink==2 in-flight window");
      }
      if (freshResultState.state !== DURABLE_ABSENT) {
        try {
          validateResultV2(freshResultPath, coordRoot);
        } catch (err) {
          if (err instanceof CliError && err.detailCode === 'CORRELATION_INVALID') {
            throw new CliError('INVALID', 'DURABILITY_UNPROVEN', "the current attempt's authoritative result exists but does not correlate to its own request");
          }
          throw err;
        }
        throw new CliError('INVALID', 'AUTHORITY_INVALID', 'transaction already has an authoritative result for the current attempt');
      }
      testM7Rendezvous('claim-after-admission-before-link', coordRoot);
    },
  });

  // Section 4: the initial active-lease publish moves INSIDE the transition lock -- a
  // takeover racing between the claim election above and lock acquisition must be
  // re-checked under the SAME durable lock a heartbeat/takeover itself uses, never
  // assumed still current just because we won the election.
  testRendezvous(txnDir, 'claim-pre-lock');
  return withLock(txnDir, coordRoot, (lockToken) => {
    // Codex NO-GO round 16: a fresh scope check as the FIRST thing inside
    // this callback -- withLock's own pre-fn check happens once, before fn
    // starts; every read fn itself performs afterward (reqObj2 below,
    // claimRec further down) had no check of its own closer to it.
    assertLockedScopeIdentity(lockToken);
    // Re-read/revalidate the request and CURRENT attempt/epoch UNDER the lock -- a
    // takeover could have committed between the election above and lock acquisition.
    // Codex NO-GO round 17 (P0): re-accredit the FULL request identity (not
    // just the narrower attempt/epoch projection resolveAuthoritativeAttempt
    // derives from it) and reject any divergence from the preflight -- see
    // this function's own preflight comment above.
    const inLock = accreditCanonicalRequest(coordRoot, requestPath);
    assertRequestIdentityMatches(preflight, inLock, requestPath);
    const reqObj2 = inLock.obj;
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
    // Codex NO-GO round 16 (P0): the checks above prove SOME valid claim for
    // the current attempt/epoch resolves at claimPath -- never that it is
    // the EXACT bytes THIS invocation's own election published (a
    // substituted-but-still-attempt/epoch-matching claim, e.g. a different
    // claimant_role/claimant_instance_id/driver, would pass them). Reuse the
    // SAME fd-bound comparator every other hardened write in this file
    // trusts, against the receipt THIS invocation's own election publish
    // returned.
    assertArtifactMatchesReceipt(claimPath, claimReceipt, claimBytes);

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
    const leaseBytes = Buffer.from(canonicalJSONStringify(leaseObj), 'utf8');
    // Codex NO-GO round 15 ("los cinco callers del lock"): withLock's own
    // entry/exit checks bracket this ENTIRE callback, but cannot catch a
    // txnDir/.lock swap that happens THEN GETS SWAPPED BACK before withLock's
    // own post-fn check runs (empirically confirmed this session via
    // RCC-claim-withlock-systemic-txndir-swap-detected: the write still lands
    // in a swapped substitute even with that systemic check active). A fresh
    // scope check immediately before AND after this specific write shrinks
    // that window to the minimum, mirroring cmdCancel/cmdAcceptResult/
    // cmdTakeover's own established pattern.
    assertLockedScopeIdentity(lockToken);
    const leaseReceipt = publishNoClobber(leasePath, leaseBytes, { allowIdenticalIdempotent: true });
    testRendezvous(txnDir, 'claim-post-lease-publish-pre-recheck');
    try {
      assertLockedScopeIdentity(lockToken);
      // Codex NO-GO round 17 (P0): mirrors cmdTakeover's own post-publish
      // request-identity recheck -- proves request.json is STILL the exact
      // preflight bytes at the moment this invocation is about to report
      // SUCCESS, not merely at lock entry several reads/writes earlier.
      assertRequestIdentityMatches(preflight, accreditCanonicalRequest(coordRoot, requestPath), requestPath);
      assertArtifactMatchesReceipt(leasePath, leaseReceipt, leaseBytes);
    } catch (err) {
      throw isPoisoned(err) ? err : markPoisoned(err);
    }

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
  // Codex NO-GO round 15: coordRoot was previously required by requireFlags
  // above but never actually resolved/used anywhere in this function -- now
  // threaded into withLock/acquireLock for the ancestor-confinement check.
  const coordRoot = resolveAbsolute(flags['coordination-root']);
  const requestPath = resolveAbsolute(flags.request);
  const txnDir = path.dirname(requestPath);
  const claimPath = resolveAbsolute(flags.claim);

  testRendezvous(txnDir, 'heartbeat-pre-lock');
  return withLock(txnDir, coordRoot, (lockToken) => {
    // Codex NO-GO round 16: a fresh scope check as the FIRST thing inside
    // this callback -- withLock's own pre-fn check happens once, before fn
    // starts; every read below (reqObj, claimRec, existingRec) had no check
    // of its own closer to it.
    assertLockedScopeIdentity(lockToken);
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
    // Codex NO-GO round 15 ("los cinco callers del lock"): a fresh scope check
    // immediately before this write, mirroring cmdClaim/cmdCancel/
    // cmdAcceptResult/cmdTakeover's own established pattern.
    //
    // Codex NO-GO round 16 (P0): round 15's own justification for skipping a
    // byte-exact check here ("a legitimate concurrent heartbeat is expected
    // to change its content") was WRONG -- only ONE process can ever hold
    // this lock at a time; a second heartbeat call BLOCKS in acquireLock's
    // own mkdir-wait loop until this one releases, so nothing legitimate can
    // race THIS invocation's own write while it holds the lock. A byte-exact
    // receipt check is exactly as meaningful here as for any other hardened
    // write in this file.
    assertLockedScopeIdentity(lockToken);
    // M7 section 8.5: lease-heartbeat gains the SAME final cancel/terminal
    // absence read already applied by publish-result (cmdPublishResult),
    // performed here under this function's own existing lock -- a terminal
    // already durable before this read blocks the effect, and no operation
    // admitted after cancellation can mutate the target.
    const heartbeatExistingAccepted = readJsonDurableOptional(acceptedResultPathFor(txnDir), { shape: (o) => assertClosedShape(o, ACCEPTED_RESULT_V1_FIELDS) });
    if (heartbeatExistingAccepted !== null) {
      assertAcceptedResultCorrelates(heartbeatExistingAccepted, txnDir, reqObj, coordRoot);
      throw new CliError('INVALID', 'AUTHORITY_INVALID', 'transaction already has an accepted-result.json');
    }
    if (readCanonicalCancelRecordOptional(cancelPathFor(txnDir), coordRoot) !== null) {
      throw new CliError('CANCELLED', 'TRANSACTION_CANCELLED', 'transaction was already cancelled');
    }
    const leaseBytes = Buffer.from(canonicalJSONStringify(merged), 'utf8');
    testM7Rendezvous('heartbeat-after-admission-before-write', coordRoot);
    // M7 CORRECTION C1/C3 (Codex final ruling, two-boundary linearization):
    // this check is heartbeat's own LP2 -- it must run AFTER the rendezvous
    // pause above, not before, so it can OBSERVE an authoritative result
    // landing in the exact LP1 (general authority admission, already
    // resolved earlier in the call chain, before this function's own body
    // even started)-to-LP2 window the pause simulates ("section 8.5 LP2
    // observes the result"; a terminal ordered genuinely after LP2 releases
    // is never retroactively checked and is allowed to complete, per M7's
    // general "already-admitted may complete bounded" positive-control
    // semantics). The AUTHORITATIVE result is a SEPARATE terminal from
    // accepted-result.json -- checked via the SAME canonical fd-bound
    // validateResultV2 pipeline claim's own revalidateBeforeLink admission
    // point uses (see its matching comment for the full PENDING/
    // CORRELATION_INVALID mapping rationale). A terminal that VALIDATES
    // cleanly denies AUTHORITY_INVALID and leaves the lease bytes unwritten;
    // malformed/pending is DURABILITY_UNPROVEN.
    const heartbeatResultPath = resultPathFor(txnDir, auth.attemptId);
    const heartbeatResultState = classifyDurableRead(heartbeatResultPath, { parse: true });
    if (heartbeatResultState.state === DURABLE_PENDING) {
      throw new CliError('INVALID', 'DURABILITY_UNPROVEN', "the current attempt's authoritative result is still in the nlink==2 in-flight window");
    }
    if (heartbeatResultState.state !== DURABLE_ABSENT) {
      try {
        validateResultV2(heartbeatResultPath, coordRoot);
      } catch (err) {
        if (err instanceof CliError && err.detailCode === 'CORRELATION_INVALID') {
          throw new CliError('INVALID', 'DURABILITY_UNPROVEN', "the current attempt's authoritative result exists but does not correlate to its own request");
        }
        throw err;
      }
      throw new CliError('INVALID', 'AUTHORITY_INVALID', 'transaction already has an authoritative result for the current attempt');
    }
    const leaseReceipt = publishReplace(leasePath, leaseBytes);
    testRendezvous(txnDir, 'heartbeat-post-publish-pre-recheck');
    try {
      assertLockedScopeIdentity(lockToken);
      assertArtifactMatchesReceipt(leasePath, leaseReceipt, leaseBytes);
    } catch (err) {
      throw isPoisoned(err) ? err : markPoisoned(err);
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
  const coordRoot = resolveAbsolute(flags['coordination-root']);
  const requestPath = resolveAbsolute(flags.request);
  const txnDir = path.dirname(requestPath);
  // Codex NO-GO round 15: this preflight used to be readRequestForTxnOrCorrelationInvalid(txnDir)
  // (no coordRoot confinement/geometry check at all) with NO in-lock re-read or
  // identity-match against it -- the SAME TOCTOU class cmdCancel/cmdAcceptResult
  // needed rounds 10-12 to close (accredit once before the lock, then TRUST a
  // fresh in-lock read unconditionally, silently adopting a mid-wait
  // request.json mutation instead of rejecting it). accreditCanonicalRequest's
  // own doc comment already named takeover as sharing this exact asymmetry,
  // deliberately left unfixed by that earlier round. Aligned here with
  // cmdCancel's own established pattern: preflight, then in-lock re-read +
  // assertRequestIdentityMatches before trusting any field.
  const preflight = accreditCanonicalRequest(coordRoot, requestPath);

  return withLock(txnDir, coordRoot, (lockToken) => {
    testRendezvous(txnDir, 'takeover-in-lock-pre-read');
    assertLockedScopeIdentity(lockToken);
    const inLock = accreditCanonicalRequest(coordRoot, requestPath);
    assertRequestIdentityMatches(preflight, inLock, requestPath);
    const reqObj = inLock.obj;
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
    const takeoverBytes = Buffer.from(canonicalJSONStringify(takeoverObj), 'utf8');
    assertLockedScopeIdentity(lockToken);
    const takeoverReceipt = publishNoClobber(takeoverPath, takeoverBytes, { raceDetailCode: 'AUTHORITY_INVALID' });
    // Codex NO-GO round 15: takeover.json is a one-time immutable record (like
    // cancel.json/accepted-result.json) -- gets the SAME post-publish
    // discipline: fresh scope + request-identity re-check, plus a byte+identity
    // re-verification against the receipt publishNoClobber itself returned.
    testRendezvous(txnDir, 'takeover-post-publish-pre-recheck');
    try {
      assertLockedScopeIdentity(lockToken);
      assertRequestIdentityMatches(preflight, accreditCanonicalRequest(coordRoot, requestPath), requestPath);
      assertArtifactMatchesReceipt(takeoverPath, takeoverReceipt, takeoverBytes);
    } catch (err) {
      throw isPoisoned(err) ? err : markPoisoned(err);
    }
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

/**
 * Codex NO-GO round 15: confines a subdirectory the caller is ABOUT TO join
 * an attempt-pair/attempt-id filename onto. Deliberately tolerates absence
 * (returns without error) rather than requiring pre-existence like
 * cmdPublishBlob's own per-component symlink walk (a different precondition
 * -- that walk assumes a fully-materialized staging root; this one is called
 * for subdirectories, like `conflict/`, that are lazily created by whichever
 * publishNoClobber call first targets them). Rejects an EXISTING symlink
 * outright.
 *
 * Codex NO-GO round 16 (P0): previously tolerated ANY lstat error as
 * "absent", not only ENOENT -- an EACCES or EIO (a real, reportable
 * problem) would have been silently treated the same as "doesn't exist
 * yet", masking a genuine failure instead of propagating it.
 */
function assertConfinedSubdirectory(txnDir, subdirName) {
  const candidate = path.join(txnDir, subdirName);
  let lst;
  try {
    lst = fs.lstatSync(candidate);
  } catch (err) {
    if (err && err.code === 'ENOENT') return;
    throw new CliError('INVALID', 'DURABILITY_UNPROVEN', subdirName + ' could not be stat-verified (' + (err && err.code) + '): ' + candidate);
  }
  if (lst.isSymbolicLink()) {
    throw new CliError('INVALID', 'SECURITY_INVALID', subdirName + ' is a symlink (rejected): ' + candidate);
  }
  if (!lst.isDirectory()) {
    throw new CliError('INVALID', 'SCHEMA_INVALID', subdirName + ' is not a directory: ' + candidate);
  }
}

/**
 * Codex NO-GO round 15: this function used to swallow EVERY error from BOTH
 * of its own operations unconditionally (`catch (err) { return; }` /
 * `catch (err) { /* diagnostic only *\/ }`) -- a genuine SECURITY_INVALID (a
 * planted symlink at the conflict-diagnostic path) or DURABILITY_UNPROVEN
 * would have been completely invisible, with cmdCancel still reporting
 * overall SUCCESS. `listResultFiles` itself already correctly distinguishes
 * ENOENT (returns `[]`) from a genuine enumeration failure (throws
 * DURABILITY_UNPROVEN) -- the removed try/catch around it was wrongly
 * swallowing that already-correct throw too.
 *
 * Codex NO-GO round 16 (P0), on top of round 15's own fix: `results/` itself
 * (read from) was never confinement-checked, only `conflict/` (written to)
 * -- `fs.opendirSync` follows a symlink at `results/` transparently, same as
 * any other directory open. The names `listResultFiles` returns were never
 * validated as genuine hex attempt IDs before being joined into a path/
 * schema field. Tolerating a race-lost AUTHORITY_INVALID (a different
 * diagnostic already exists for this exact pair) never validated that
 * EXISTING, WINNING diagnostic at all -- an attacker-plantable
 * schema-invalid file at that exact path would have been silently accepted
 * as "good enough, someone else already wrote it".
 */
function writeConflictDiagnosticIfApplicable(txnDir) {
  assertConfinedSubdirectory(txnDir, 'results');
  const entries = listResultFiles(txnDir);
  if (entries.length < 2) return;
  const a = path.basename(entries[0], '.json');
  const b = path.basename(entries[1], '.json');
  if (!isHexId(a) || !isHexId(b)) {
    throw new CliError('INVALID', 'SCHEMA_INVALID', 'results/ entry name is not a well-formed attempt_id: ' + txnDir);
  }
  const conflictObj = { schema: 'coordination/conflict/v1', attempt_id: a, other_attempt_id: b, detected_at: nowIso() };
  assertClosedShape(conflictObj, CONFLICT_V1_FIELDS);
  const conflictBytes = Buffer.from(canonicalJSONStringify(conflictObj), 'utf8');
  assertConfinedSubdirectory(txnDir, 'conflict');
  const conflictPath = path.join(txnDir, 'conflict', a + '-' + b + '.json');
  let receipt;
  try {
    receipt = publishNoClobber(conflictPath, conflictBytes, { allowIdenticalIdempotent: true });
  } catch (err) {
    // A DIFFERENT diagnostic already durably exists for this exact
    // attempt-pair (a race loss allowIdenticalIdempotent did not accept as
    // byte-identical) -- diagnostic only, and whichever writer landed first
    // is definitive; tolerated, but ONLY once that existing, WINNING
    // diagnostic is itself fully re-validated (fd-bound durable + closed
    // shape), never blindly trusted merely because "some file already
    // exists at this path". Any OTHER failure (SECURITY_INVALID,
    // DURABILITY_UNPROVEN) is a real problem and must propagate.
    //
    // Codex NO-GO round 17 (P0): validateConflictV1 proves SHAPE only
    // (schema/field-types) -- it never confirmed the existing diagnostic's
    // OWN attempt_id/other_attempt_id equal THIS invocation's specific a/b
    // pair, nor that they are in the expected order. A durable, well-formed
    // conflict/v1 diagnostic belonging to a COMPLETELY DIFFERENT attempt pair
    // (e.g. a stray left by an unrelated bug, or planted) would previously
    // have been silently accepted as "good enough". conflictPath's own
    // filename already encodes (a, b); the CONTENT must match it exactly.
    if (err instanceof CliError && err.detailCode === 'AUTHORITY_INVALID') {
      const existing = validateConflictV1(conflictPath);
      if (existing.attempt_id !== a || existing.other_attempt_id !== b) {
        throw new CliError('INVALID', 'SECURITY_INVALID', 'existing conflict diagnostic at ' + conflictPath + ' does not correlate with the expected attempt pair (' + a + ', ' + b + ')');
      }
      return;
    }
    throw err;
  }
  // Re-confirm conflict/ itself is still a genuine, non-symlinked directory
  // -- publishNoClobber's own internal mkdirSync(dir,{recursive:true}) does
  // not reject a symlink planted between the check above and this write, so
  // this closes as much of that window as re-verification after the fact
  // can (the same "shrink, don't claim to eliminate" honesty this file
  // already applies to other TOCTOU windows it cannot fully close).
  assertConfinedSubdirectory(txnDir, 'conflict');
  assertArtifactMatchesReceipt(conflictPath, receipt, conflictBytes);
}

function cmdCancel(flags) {
  requireFlags(flags, ['coordination-root', 'request', 'reason']);
  const coordRoot = resolveAbsolute(flags['coordination-root']);
  const requestPath = resolveAbsolute(flags.request);
  if (!CANCEL_REASON_ENUM.includes(flags.reason)) {
    throw new CliError('USAGE_ERROR', 'INVALID_ARGUMENT', 'invalid --reason: ' + flags.reason);
  }
  // Codex NO-GO round 6/8/9: `--coordination-root`/`--request` confinement,
  // canonical filename, exact geometry, and full validateConsultV2 pipeline.
  // Codex NO-GO round 10 (empirically reproduced): accrediting ONLY before
  // acquiring the lock is a genuine TOCTOU -- block .lock, start cancel (it
  // accredits request A, then blocks in acquireLock's poll), swap
  // request.json to an equally-valid request B, release the lock: cancel
  // returns SUCCESS using stale A, and the cancel.json it wrote is
  // immediately rejected by any reader checking it against the now-current B.
  //
  // Codex NO-GO round 11 P0(1) (empirically reproduced): removing the
  // pre-lock accreditation entirely traded the TOCTOU for a WORSE bug --
  // acquireLock's own fs.mkdirSync(txnDir, {recursive:true}) unconditionally
  // creates the ENTIRE directory tree for whatever `--request` names, BEFORE
  // any confinement/geometry check ever runs. An out-of-root/garbage
  // `--request` was reproduced returning SECURITY_INVALID correctly, while
  // still leaving a created, 0755 directory tree behind on disk -- fail-CLOSED
  // in status, but not in effect.
  //
  // Codex NO-GO round 12 (both empirically reproduced): round 11's fix
  // discarded this preflight's result and let the FRESH, in-lock read simply
  // be trusted -- silently ADOPTING a mid-wait request.json mutation instead
  // of detecting and rejecting it. request.json is IMMUTABLE (PLAN.md ~L813);
  // a legitimate authority change requires takeover.json, never a rewrite of
  // this path -- exactly the principle round 11 already applied to
  // cmdAwaitResult but never carried over here. This preflight's result is
  // now KEPT as the frozen baseline: the in-lock read below must match it
  // (digest AND fd-bound dev/ino -- a byte-identical replacement changes
  // neither digest nor content, only the underlying file) or this STOPs,
  // never adopts.
  const preflight = accreditCanonicalRequest(coordRoot, requestPath);
  const txnDir = path.dirname(requestPath);
  return withLock(txnDir, coordRoot, (lockToken) => {
    // Codex NO-GO round 11: moved from before withLock to here -- a rendezvous
    // firing before withLock only proves a swap happened before the lock was
    // even entered, not that the read below genuinely happens while holding
    // it. Firing here (after acquireLock has already returned) makes that
    // unambiguous.
    testRendezvous(txnDir, 'cancel-in-lock-pre-read');
    // Codex NO-GO round 12: assertLockedScopeIdentity supersedes round 11's
    // txnDir-only check -- txnDir AND .lock must BOTH still be the exact
    // directories this token was minted for.
    assertLockedScopeIdentity(lockToken);
    const inLock = accreditCanonicalRequest(coordRoot, requestPath);
    assertRequestIdentityMatches(preflight, inLock, requestPath);
    const reqObj = inLock.obj;
    // Terminal mutual exclusion (PLAN.md ~L474/~L690): accepted-result.json and
    // cancel.json are mutually exclusive terminal records. `cmdAcceptResult` already
    // rejects when a cancel exists (symmetric check); this is the other half.
    // DUR-J: each terminal is read fd-bound-durable -- a durable one blocks as before;
    // a genuinely absent one lets the cancel proceed; an nlink==2 / symlink / malformed
    // terminal STOPs (readJsonDurableOptional throws) rather than being counted by mere
    // existsSync presence.
    //
    // HARD NO-GO (post round 17, corrected round 19): shape+durability alone
    // previously let a planted/foreign schema-valid accepted-result.json
    // permanently block this transaction. Round 18's fix used a narrower,
    // request-digest-only correlator, reasoning the fuller
    // assertAcceptedResultCorrelates would incorrectly reject a legitimate
    // cross-attempt terminal accept -- round 19 found that scenario cannot
    // occur under PLAN's own transition table (see
    // assertAcceptedResultCorrelates's own doc comment, and the removed
    // function's former doc comment left in place above as history), so this
    // now calls the SAME full correlator every other authoritative surface
    // uses.
    const existingAccepted = readJsonDurableOptional(acceptedResultPathFor(txnDir), { shape: (o) => assertClosedShape(o, ACCEPTED_RESULT_V1_FIELDS) });
    if (existingAccepted !== null) {
      assertAcceptedResultCorrelates(existingAccepted, txnDir, reqObj, coordRoot);
      throw new CliError('INVALID', 'AUTHORITY_INVALID', 'transaction already has an accepted-result.json');
    }
    // Codex NO-GO round 8: single choke point -- see readCanonicalCancelRecordOptional's
    // own doc comment (the CANCEL-AUDIT-01 source-audit test enforces this mechanically).
    const existing = readCanonicalCancelRecordOptional(cancelPathFor(txnDir), coordRoot);
    if (existing !== null) {
      // A second cancel (matching or different --reason) observes the SAME
      // terminal CANCELLED disposition as accept-result-after-cancel (PLAN.md
      // ~L781 rc6 rule) -- not RESULT_CONFLICT (reserved for differing RESULT
      // candidates, record #10 ~L476-484), and not a generic AUTHORITY_INVALID.
      throw new CliError('CANCELLED', 'TRANSACTION_CANCELLED', 'transaction was already cancelled');
    }
    // Codex NO-GO round 6 (PLAN.md record #9, ~L480: "requester instance id,
    // or timeout-authority"): a fresh, unconnected genId() was neither -- it
    // matched no real identity at all. 'expired' is the one system/deadline-
    // driven reason with no live requester decision behind it; every other
    // reason is a requester-initiated action and must carry the ACTUAL
    // requester's own identity from the request it is cancelling, mirrored by
    // accreditCancelRecord's own read-side check.
    //
    // Codex NO-GO round 8: the bare `--reason expired` VALUE is a caller
    // claim, never proof -- a caller could declare `expired` for a request
    // whose deadline never passed. `cancelled_at` (the timestamp this write
    // is ABOUT to stamp) must itself be at or after the request's own
    // `expiry` before `timeout-authority` is accepted, mirroring exactly the
    // read-side re-proof `accreditCancelRecord` now performs on any EXISTING
    // cancel.json (same comparison, same fields, so a genuine expiry at
    // write time always survives a later re-read). `cancelledAt` is stamped
    // via `nowIso()`/`currentClockMs()` -- unlike a planted artifact, this
    // writer cannot itself claim an implausible future value.
    //
    // Codex NO-GO round 9 (PENDING_WP4): `cancelled_by` here is CORRELATION
    // (an identity already recorded in the request), never CRYPTOGRAPHIC or
    // GRANT-BASED AUTHORITY that this CALLER is entitled to invoke `cancel` at
    // all -- see `accreditCancelRecord`'s own matching doc comment for the
    // PLAN.md `role-command-grant/v1` (~L580-592) reference and why that
    // remains unimplemented and unclaimed here.
    const cancelledAt = nowIso();
    if (flags.reason === 'expired' && isoToMs(cancelledAt) < isoToMs(reqObj.expiry)) {
      throw new CliError('INVALID', 'AUTHORITY_INVALID', "--reason expired requires the request's own expiry to have genuinely passed");
    }
    const cancelledBy = flags.reason === 'expired' ? 'timeout-authority' : reqObj.requester_instance_id;
    const cancelObj = {
      schema: 'coordination/cancel/v1',
      request_id: reqObj.request_id,
      reason: flags.reason,
      cancelled_at: cancelledAt,
      cancelled_by: cancelledBy,
    };
    const cancelPath = cancelPathFor(txnDir);
    const cancelBytes = Buffer.from(canonicalJSONStringify(cancelObj), 'utf8');
    // Codex NO-GO round 11 P0(2)/round 12: re-verify immediately before
    // publish too -- the read above and this write are not atomic with each
    // other; closing the window at only one of the two ends would leave the
    // other exposed.
    assertLockedScopeIdentity(lockToken);
    const cancelReceipt = publishNoClobber(cancelPath, cancelBytes, { raceDetailCode: 'AUTHORITY_INVALID' });
    // Codex NO-GO round 12: a single pre-publish lstat does not cover the
    // write itself -- publishNoClobber's own temp-write/fsync/link/unlink
    // sequence takes real time, during which the SAME class of swap could
    // still happen. Re-verify ONE more time immediately after; if identity
    // was lost DURING the publish, we can no longer trust what was actually
    // written or where -- POISON (retain the lock) rather than release into
    // an unproven state, exactly the same principle DUR-J already applies to
    // a POST_RENAME_UNPROVEN publishReplace failure.
    testRendezvous(txnDir, 'cancel-post-publish-pre-recheck');
    try {
      assertLockedScopeIdentity(lockToken);
      assertRequestIdentityMatches(preflight, accreditCanonicalRequest(coordRoot, requestPath), requestPath);
      // Codex NO-GO round 15: round 14's own "byte-exact" check parsed
      // cancelPath, re-serialized the PARSED object, and compared digests --
      // proving only that the re-read VALUES canonicalize the same way, never
      // that the on-disk bytes or inode are what this invocation actually
      // published (a same-value-different-whitespace file, or a brand-new
      // byte-identical file at a DIFFERENT inode, both would have passed).
      // Reuse the SAME fd-bound comparator publishNoClobber trusts for its
      // own revalidation, against the receipt IT returned at publish time --
      // real bytes, real identity, no reconstruction step.
      assertArtifactMatchesReceipt(cancelPath, cancelReceipt, cancelBytes);
      // Codex NO-GO round 13: moved inside this same protected region, with
      // its OWN fresh scope re-check immediately before it -- being inside
      // the same try block does not make it atomic with the checks above;
      // a swap could still happen in the narrow window between the last
      // accreditation and this specific write.
      if (flags.reason === 'conflict') {
        assertLockedScopeIdentity(lockToken);
        writeConflictDiagnosticIfApplicable(txnDir);
      }
    } catch (err) {
      throw isPoisoned(err) ? err : markPoisoned(err);
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
  // A duplicate/racing transaction-ack for the SAME semantic decision
  // (disposition + attempt correlation) must succeed, never collide on
  // acked_at (which legitimately differs call to call) -- but any OTHER
  // attempt/disposition for an already-acked transaction still fails
  // closed. Checked both before publishing (the plain duplicate-call case)
  // and after a lost publishNoClobber race (another writer won first); no
  // other publishNoClobber failure is ever treated as success.
  const ackSemanticsMatch = (existing) => Boolean(
    existing && existing.schema === 'coordination/ack/v1'
    && existing.disposition === disposition
    && existing.in_reply_to_attempt_id === auth.attemptId,
  );
  const existingAck = readJsonDurableOptional(ackPath, { shape: (o) => assertClosedShape(o, ACK_V1_FIELDS) });
  if (existingAck !== null) {
    if (!ackSemanticsMatch(existingAck)) {
      throw new CliError('INVALID', 'AUTHORITY_INVALID', 'a durable ack already exists for this transaction with a different disposition or attempt');
    }
    return { request_id: reqObj.request_id, artifact_ref: ackPath };
  }
  try {
    publishNoClobber(ackPath, Buffer.from(canonicalJSONStringify(ackObj), 'utf8'), { allowIdenticalIdempotent: true });
  } catch (err) {
    // Only publishNoClobber's genuine EEXIST/race-loss classification may be
    // recovered semantically.  Durability, security, I/O, and every other
    // failure remain failures even if an equal ack happens to be observable.
    if (!(err instanceof CliError) || err.status !== 'INVALID' || err.detailCode !== 'AUTHORITY_INVALID') {
      throw err;
    }
    const raced = readJsonDurableOptional(ackPath, { shape: (o) => assertClosedShape(o, ACK_V1_FIELDS) });
    if (raced !== null && ackSemanticsMatch(raced)) {
      return { request_id: reqObj.request_id, artifact_ref: ackPath };
    }
    throw err;
  }
  return { request_id: reqObj.request_id, artifact_ref: ackPath };
}
COMMANDS['transaction-ack'] = cmdTransactionAck;

// ─────────────────────────────────────────────────────────────────────────────
// `accept-result` (PLAN.md ~L769) -- under lock, requester-only accepted-result.json
// ─────────────────────────────────────────────────────────────────────────────

/**
 * M6+M7 requester-authority closure (Group C): the actor holding the
 * consumed requester grant must be the SAME actor that originally published
 * this transaction's request.json -- checked independently at each mutation
 * boundary (never trusted from a single earlier read), mirroring this file's
 * own established re-verify-under-lock/re-verify-before-publish TOCTOU
 * discipline for request identity elsewhere.
 */
function assertRequesterActorMatchesRequest(grantContext, reqObj) {
  if (!grantContext || typeof grantContext.actorInstanceId !== 'string' || grantContext.actorInstanceId.length === 0) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'requires an authenticated requester grant/binding');
  }
  if (grantContext.actorInstanceId !== reqObj.requester_instance_id) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'requester grant does not match the actor that published this request');
  }
}

function cmdAcceptResult(flags, grantContext) {
  requireFlags(flags, ['coordination-root', 'request']);
  const coordRoot = resolveAbsolute(flags['coordination-root']);
  const requestPath = resolveAbsolute(flags.request);
  // Codex NO-GO round 8/9: confinement, canonical filename, exact geometry,
  // full validateConsultV2 pipeline. Codex NO-GO round 10 (same empirically-
  // reproduced TOCTOU as cmdCancel): accrediting ONLY before the lock lets a
  // request.json swap during the lock-acquisition wait go unnoticed.
  //
  // Codex NO-GO round 11 P0(1) (same empirically-reproduced mkdir-before-
  // validate gap as cmdCancel): a preliminary accreditation runs here, before
  // the lock, so acquireLock's own recursive mkdir never runs for an
  // invalid/out-of-root --request in the first place.
  //
  // Codex NO-GO round 12 (same bug as cmdCancel -- see its own matching
  // comment for the full reproduction): round 11 discarded this preflight and
  // let the fresh in-lock read be trusted outright, silently ADOPTING a
  // mid-wait mutation instead of rejecting it. request.json is IMMUTABLE
  // (PLAN.md ~L813) -- this preflight's result is now KEPT as the frozen
  // baseline every later read (digest AND fd-bound dev/ino) must match, or
  // this STOPs, never adopts.
  const preflight = accreditCanonicalRequest(coordRoot, requestPath);
  const txnDir = path.dirname(requestPath);
  return withLock(txnDir, coordRoot, (lockToken) => {
    // Codex NO-GO round 11: moved from before withLock -- see cmdCancel's
    // matching comment for why firing here (genuinely inside the lock) is the
    // only placement that unambiguously proves what this rendezvous claims to.
    testRendezvous(txnDir, 'accept-result-in-lock-pre-read');
    // Codex NO-GO round 12: assertLockedScopeIdentity supersedes round 11's
    // txnDir-only check -- txnDir AND .lock must BOTH still be the exact
    // directories this token was minted for.
    assertLockedScopeIdentity(lockToken);
    const reqRec = accreditCanonicalRequest(coordRoot, requestPath);
    assertRequestIdentityMatches(preflight, reqRec, requestPath);
    const reqObj = reqRec.obj;
    // M6+M7 requester-authority closure (Group C): before any mutation, the
    // authenticated grant's own actor must be the same actor that opened
    // this transaction.
    assertRequesterActorMatchesRequest(grantContext, reqObj);
    // DUR-J: terminal mutual exclusion reads each terminal fd-bound-durable -- a durable
    // accepted-result/cancel blocks as before; a genuinely absent one lets accept
    // proceed; an nlink==2 / symlink / malformed terminal STOPs rather than being
    // counted by mere existsSync presence.
    //
    // HARD NO-GO (post round 17, corrected round 19): see cmdCancel's
    // matching call for the full rationale -- this now uses the SAME full
    // correlator (assertAcceptedResultCorrelates), not the reversed,
    // narrower assertAcceptedResultTiedToTransaction.
    const existingAccepted = readJsonDurableOptional(acceptedResultPathFor(txnDir), { shape: (o) => assertClosedShape(o, ACCEPTED_RESULT_V1_FIELDS) });
    if (existingAccepted !== null) {
      assertAcceptedResultCorrelates(existingAccepted, txnDir, reqObj, coordRoot);
      throw new CliError('INVALID', 'AUTHORITY_INVALID', 'transaction already has an accepted-result.json');
    }
    // Codex NO-GO round 8: single choke point -- see readCanonicalCancelRecordOptional's
    // own doc comment (the CANCEL-AUDIT-01 source-audit test enforces this mechanically).
    const existingCancel = readCanonicalCancelRecordOptional(cancelPathFor(txnDir), coordRoot);
    if (existingCancel !== null) {
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
      requester_instance_id: grantContext.actorInstanceId,
      accepted_at: nowIso(),
      schema_version: 1,
    };
    const acceptedPath = acceptedResultPathFor(txnDir);
    const acceptedBytes = Buffer.from(canonicalJSONStringify(acceptedObj), 'utf8');
    // Codex NO-GO round 11 P0(2)/round 12: re-verify immediately before
    // publish too -- the reads above and this write are not atomic with each
    // other.
    assertLockedScopeIdentity(lockToken);
    // M6+M7 requester-authority closure (Group C): re-verified again at this
    // exact transaction-authority (write) boundary -- never solely relying
    // on the earlier check.
    assertRequesterActorMatchesRequest(grantContext, reqObj);
    // A double-accept no-clobber race lost here is a RACE (another accept won
    // first), not a cancellation -- matches cmdClaim's own claim-race labeling
    // (AUTHORITY_INVALID), not the unrelated TRANSACTION_CANCELLED detail code.
    const acceptedReceipt = publishNoClobber(acceptedPath, acceptedBytes, { raceDetailCode: 'AUTHORITY_INVALID' });
    // Codex NO-GO round 12: re-verify ONE more time immediately after --
    // publishNoClobber's own multi-step sequence takes real time, during
    // which the same class of swap could still happen. A mismatch here means
    // we can no longer trust what was actually written or where -- POISON
    // rather than release into an unproven state.
    testRendezvous(txnDir, 'accept-result-post-publish-pre-recheck');
    try {
      assertLockedScopeIdentity(lockToken);
      const postReqRec = accreditCanonicalRequest(coordRoot, requestPath);
      assertRequestIdentityMatches(preflight, postReqRec, requestPath);
      // Codex NO-GO round 15: round 13/14's own checks (assertAcceptedResultCorrelates
      // plus a reserialize-then-hash digest compare) proved the re-read record
      // correlates and canonicalizes to the same VALUE -- never that the on-disk
      // bytes or inode are what this invocation actually published. Reuse the
      // SAME fd-bound comparator publishNoClobber trusts for its own
      // revalidation, against the receipt IT returned at publish time.
      assertArtifactMatchesReceipt(acceptedPath, acceptedReceipt, acceptedBytes);
    } catch (err) {
      throw isPoisoned(err) ? err : markPoisoned(err);
    }
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
  // authoritative id in cleanup's own response. Reuses the SAME canonical
  // durability+shape+identity validation every other authoritative reader uses; on ANY
  // failure (absent, non-durable, or malformed) the response simply omits the id (`null`)
  // rather than displaying an unearned one -- reconciliation semantics above are
  // completely unaffected either way.
  //
  // M6+M7 requester-authority closure (Group B): the exact confused-deputy shape this
  // comment originally targeted (a request.json whose content contradicts its own
  // canonical path) can no longer reach this code at all in practice -- cleanup is a
  // transactional requester operation under PLAN §15b's own accreditation requirement
  // like every other transactional command, so grant-scope resolution
  // (resolveRequesterGrantScope -> accreditCanonicalRequest, which independently runs
  // this SAME readCanonicalRequestRecord content/path identity check) now rejects that
  // exact request.json with SECURITY_INVALID before cmdCleanup's own handler --
  // including this display-fallback -- is ever invoked. The identity check right below
  // is kept as genuine defense-in-depth, never assumed redundant/removed just because
  // an earlier gate now also catches this one shape; it remains the live, load-bearing
  // check for the OTHER, still-reachable untrustworthy-but-not-confused-deputy failure
  // modes this fallback was always meant to cover (absent, non-durable, malformed).
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

/**
 * M67-MATRIX3-LIVENESS-REPAIR-FINAL-20260821: the ONE canonical liveness
 * assessor for cmdAwaitResult's poll loop. A dead/unclaimed worker or an
 * expired request must be reported promptly (BLOCKED/WORKER_LEASE_EXPIRED,
 * BLOCKED/WORKER_LEASE_MISSING, BLOCKED/WORKER_NOT_CLAIMED,
 * TIMEOUT/REQUEST_EXPIRED) -- never silently polled all the way to the CLI's
 * own --timeout as a generic DEADLINE_EXCEEDED. Called once per iteration,
 * strictly AFTER the terminal checks (accepted-result/cancel/result -- a
 * valid terminal observed the same iteration always wins) and strictly
 * BEFORE the CLI deadline check.
 *
 * Pure observer: never writes, cancels, releases, takes over, or repairs
 * state. Returns `{status, detailCode, message}` when a liveness verdict is
 * reached this iteration, or `null` when none applies yet (the caller falls
 * through to its own deadline check, exactly as before this function
 * existed). Reuses the SAME canonical validators/helpers every other caller
 * in this file trusts (validateClaimV1, validateActivationV1,
 * validateActiveLeaseV1, CLAIM_NO_LEASE_WINDOW_S, activationLivenessDeadline)
 * -- never a duplicated parser.
 *
 * Fail-closed discipline: validateClaimV1/validateActivationV1/
 * validateActiveLeaseV1 each throw on anything that is not a clean,
 * durable, shape-valid, correctly-correlated record -- malformed JSON, a
 * symlink, wrong owner/mode, or (for claim, via its own internal check) a
 * wrong attempt/epoch. Only TWO outcomes of that throw are ever caught and
 * interpreted here: `.durableAbsent` (the record genuinely does not exist
 * yet) and `.durablePending` (the record is mid-publish, the SAME nlink==2
 * in-flight window the rest of this loop already treats as "keep waiting").
 * Every other error propagates completely unmodified -- it is NEVER
 * downgraded to a liveness verdict and never swallowed into "keep waiting".
 * validateActivationV1/validateActiveLeaseV1 do not themselves correlate
 * attempt_id/lease_epoch/request_id against the current authoritative
 * attempt (only validateClaimV1 does, internally) -- the explicit checks
 * below close that gap for activation/lease the same way, throwing the same
 * AUTHORITY_INVALID a wrong-attempt claim already throws.
 */
function assessAwaitResultLiveness(reqObj, txnDir, coordRoot, auth) {
  const nowMs = currentClockMs();

  let claimObj = null;
  try {
    claimObj = validateClaimV1(claimPathFor(txnDir, auth.attemptId), coordRoot);
  } catch (err) {
    if (err && err.durableAbsent) {
      claimObj = null;
    } else if (err && err.durablePending) {
      return null;
    } else {
      throw err;
    }
  }

  if (claimObj === null) {
    let activationObj = null;
    try {
      activationObj = validateActivationV1(activationPathFor(txnDir, auth.attemptId));
    } catch (err) {
      if (err && err.durableAbsent) {
        activationObj = null;
      } else if (err && err.durablePending) {
        return null;
      } else {
        throw err;
      }
    }
    if (activationObj !== null) {
      if (
        activationObj.request_id !== reqObj.request_id
        || activationObj.attempt_id !== auth.attemptId
        || activationObj.lease_epoch !== auth.leaseEpoch
      ) {
        throw new CliError('INVALID', 'AUTHORITY_INVALID', 'activation request_id/attempt_id/lease_epoch is not the current authoritative triple');
      }
      if (nowMs >= isoToMs(activationObj.activation_liveness_expiry)) {
        return { status: 'BLOCKED', detailCode: 'WORKER_NOT_CLAIMED', message: 'await-result observed a valid activation past its own activation_liveness_expiry with no claim' };
      }
    }
  } else {
    let leaseObj = null;
    try {
      leaseObj = validateActiveLeaseV1(activeLeasePathFor(txnDir, auth.attemptId), coordRoot);
    } catch (err) {
      if (err && err.durableAbsent) {
        leaseObj = null;
      } else if (err && err.durablePending) {
        return null;
      } else {
        throw err;
      }
    }
    if (leaseObj === null) {
      const deadline = minIso(
        isoPlusSeconds(claimObj.created_at, CLAIM_NO_LEASE_WINDOW_S),
        minIso(activationLivenessDeadline(reqObj), isoPlusSeconds(reqObj.expiry, -REQUEST_EXPIRY_MARGIN_S)),
      );
      if (nowMs >= isoToMs(deadline)) {
        return { status: 'BLOCKED', detailCode: 'WORKER_LEASE_MISSING', message: 'await-result observed an authoritative claim with no active-lease past the claim-no-lease grace window' };
      }
    } else {
      if (leaseObj.attempt_id !== auth.attemptId || leaseObj.lease_epoch !== auth.leaseEpoch) {
        throw new CliError('INVALID', 'AUTHORITY_INVALID', 'active-lease attempt_id/lease_epoch is not the current authoritative pair');
      }
      if (nowMs >= isoToMs(leaseObj.lease_expiry)) {
        return { status: 'BLOCKED', detailCode: 'WORKER_LEASE_EXPIRED', message: 'await-result observed the authoritative active-lease past its own lease_expiry' };
      }
    }
  }

  if (nowMs >= isoToMs(reqObj.expiry)) {
    return { status: 'TIMEOUT', detailCode: 'REQUEST_EXPIRED', message: 'await-result observed the request past its own expiry with no terminal and no higher-precedence liveness failure' };
  }
  return null;
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
  // Codex NO-GO round 8: `--request` had NO confinement check at all in this
  // command. Codex NO-GO round 9: even after that fix, only MINIMUM depth +
  // shape+ID -- never the EXACT geometry or FULL validateConsultV2 pipeline.
  // accreditCanonicalRequest is the ONE canonical accreditor shared with
  // cmdCancel/cmdAcceptResult/accreditCancelRecord -- see its own doc
  // comment. Positioned after --timeout's own argv-grammar check, preserving
  // this command's existing "argv-grammar problems fail before any content
  // read" ordering.
  //
  // Codex NO-GO round 10: unlike cmdCancel/cmdAcceptResult (a single write
  // under one lock hold, where re-accrediting once INSIDE withLock closes the
  // TOCTOU), this command polls across MANY iterations and deliberately never
  // holds the lock continuously (other processes must be free to publish a
  // result/accept/cancel between polls). Accrediting reqObj only ONCE before
  // the loop and reusing it for every iteration has the same class of gap:
  // a stale accreditation could act on outdated information. accreditCanonicalRequest
  // now runs fresh at the top of EVERY iteration -- the same full accreditation,
  // paid once per poll cycle (already dominated by the
  // classifyDurableRead/validateResultV2 work each iteration already does)
  // rather than once for the whole wait.
  //
  // Codex NO-GO round 11 P0(3): round 10's fix ADOPTED whatever request.json
  // said on each fresh re-read -- but PLAN.md ~L813 declares request.json
  // IMMUTABLE (published once via temp fsync -> link -> unlink temp -> flush;
  // never rewritten), and a legitimate change of which attempt is
  // authoritative goes through takeover.json, never a mutation of this path.
  // Silently adopting a new `initial_attempt_id` on a later poll is
  // substituting authority without takeover.json -- exactly the kind of
  // unaccredited authority change this whole file exists to reject elsewhere.
  // The fix is not "reject every re-read" (a single, once-only accreditation
  // would resurrect round 10's own staleness gap) but "freeze the IDENTITY
  // observed on the very first read, and require every later read -- each
  // iteration, AND immediately before completing -- to still match it
  // exactly; any divergence STOPs (fail-closed), it is never adopted."
  //
  // Codex NO-GO round 12: comparing DIGEST alone missed a byte-identical
  // REPLACEMENT between iterations (delete + rewrite the exact same bytes) --
  // same content, same digest, but a genuinely different underlying file.
  // Codex NO-GO round 13: dev/ino alone still missed an IN-PLACE rewrite that
  // restores the original bytes before a later check runs. Rather than
  // hand-tracking an ever-growing subset of fields a second time, this now
  // freezes the FULL initial record and reuses assertRequestIdentityMatches
  // (the same comprehensive, single-sourced comparison cmdCancel/
  // cmdAcceptResult's own preflight-vs-in-lock check already uses) directly.
  let initialReqRec = null;
  function assertRequestIdentityUnchanged(freshRec) {
    assertRequestIdentityMatches(initialReqRec, freshRec, requestPath);
  }
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
    // Codex NO-GO round 10: fresh, full accreditation every iteration -- see
    // this function's own header comment above for why a single pre-loop
    // accreditation is unsafe across a long, multi-iteration poll. Codex
    // NO-GO round 11 P0(3): the freshly-read digest is now compared against
    // the FROZEN first-read digest, never adopted -- see the header comment.
    const reqRec = accreditCanonicalRequest(coordRoot, requestPath);
    if (initialReqRec === null) {
      initialReqRec = reqRec;
    } else {
      assertRequestIdentityUnchanged(reqRec);
    }
    const reqObj = reqRec.obj;
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
      // Codex NO-GO round 11 P0(3): one more, freshest-possible re-check
      // immediately before completing -- shrinks the window between "this
      // iteration's own top-of-loop read" and the actual return to as close
      // to zero as a synchronous re-read allows.
      assertRequestIdentityUnchanged(accreditCanonicalRequest(coordRoot, requestPath));
      return { request_id: reqObj.request_id, artifact_ref: acceptedResultPathFor(txnDir) };
    }
    if (acc.state === DURABLE_PENDING) pendingObservedThisPass = true;
    // Codex NO-GO round 8: single choke point -- see classifyCanonicalCancelRecord's
    // own doc comment (the CANCEL-AUDIT-01 source-audit test enforces this mechanically).
    const can = classifyCanonicalCancelRecord(cancelPathFor(txnDir), coordRoot);
    if (can.state === DURABLE_PRESENT) {
      // CLI-RESULT-08 / CONFLICT-vs-CANCELLED: DESIGN-BLOCKED (see this file's
      // history for the rejected prior attempts and why). Not yet settled:
      // WHERE a genuine conflict is legitimately detected. `cmdPublishResult`
      // publishes to the single `results/<attempt_id>.json` path for the one
      // current `(attempt_id, lease_epoch)`; a second, differing write today
      // just loses the no-clobber race as a generic rejection, with no
      // recorded evidence of what the losing candidate claimed. The existing
      // `conflict/v1` schema has two separate attempt-identifying fields
      // (`attempt_id`, `other_attempt_id`) sized for two DIFFERENT ATTEMPTS --
      // it does not fit "one attempt, two competing byte-streams for the SAME
      // (attempt_id, lease_epoch)", which is what the PLAN's own text actually
      // names. (This schema does not itself require `attempt_id !==
      // other_attempt_id` as a rule -- whether the reconciled design keeps two
      // attempt fields, moves to two digest fields, or something else is an
      // open design question, not assumed here.) Until that is designed and,
      // if needed, the PLAN/schema is amended and authorized, this observer
      // deliberately does NOT attempt to distinguish CONFLICT from CANCELLED.
      // rc6 terminal (PLAN.md ~L781), mirroring cmdCancel's/cmdAcceptResult's own
      // CANCELLED/TRANSACTION_CANCELLED terminal-cancel status -- not INVALID/rc3.
      // Codex NO-GO round 11 P0(3): re-check immediately before this terminal too.
      assertRequestIdentityUnchanged(accreditCanonicalRequest(coordRoot, requestPath));
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
        // Codex NO-GO round 11 P0(3): re-check immediately before either
        // terminal below -- both reference reqObj's identity in their output.
        assertRequestIdentityUnchanged(accreditCanonicalRequest(coordRoot, requestPath));
        if (validated.obj.status === 'BLOCKED') {
          // CLI-RESULT-06: a protocol-valid BLOCKED candidate is a terminal state
          // (PLAN.md ~L768: "or terminal state"; ~L781 rc6), never silent success.
          throw new CliError('BLOCKED', 'RESULT_BLOCKED', 'await-result observed a protocol-valid BLOCKED candidate', { request_id: reqObj.request_id, artifact_ref: candidatePath });
        }
        return { request_id: reqObj.request_id, artifact_ref: candidatePath };
      }
    }

    // M67-MATRIX3-LIVENESS-REPAIR-FINAL-20260821: liveness is evaluated AFTER
    // every terminal check above (a valid accepted-result/cancel/result observed
    // this same iteration always wins -- never converted into a false liveness
    // failure) and BEFORE the CLI deadline check below (a dead/unclaimed worker
    // or an expired request must be reported promptly, never silently polled
    // all the way to a generic DEADLINE_EXCEEDED).
    const liveness = assessAwaitResultLiveness(reqObj, txnDir, coordRoot, currentAuth);
    if (liveness !== null) {
      assertRequestIdentityUnchanged(accreditCanonicalRequest(coordRoot, requestPath));
      throw new CliError(liveness.status, liveness.detailCode, liveness.message);
    }

    if (currentClockMs() >= deadlineMs) {
      // Codex NO-GO round 12: rechecked immediately before EITHER exit below
      // too -- the claim "no mutation occurred during this entire wait" must
      // hold for every possible exit from this loop, not only the ones that
      // happen to echo reqObj fields in their own JSON output.
      assertRequestIdentityUnchanged(accreditCanonicalRequest(coordRoot, requestPath));
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
    // Codex NO-GO round 11: this command's poll interval previously had no
    // rendezvous seam at all (a plain timing sleep was the only way to test
    // it), which the reviewer correctly flagged as not proving a test
    // genuinely observed the OLD state before a mid-poll mutation. Firing
    // here -- after a full iteration has completed (including its own
    // top-of-loop accreditation) and found no terminal yet -- lets a test
    // deterministically prove "at least one full read of the ORIGINAL
    // request.json already happened" before it mutates the file out from
    // under this loop.
    testRendezvous(txnDir, 'await-result-post-iteration');
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
// publish `inbox-ref`, return one non-authoritative `ActivationAction`. WP3
// The `claude-agent` mechanism-readiness check is wired, but it is only a
// necessary precondition: selection remains unavailable until the active
// top-level host supplies the distinct §15d foreground-Agent correlation.
// The remaining non-noop driver branches (SendMessage/bridge argv for
// claude-sendmessage/codex-app-server/codex-mcp/runtime-spawn) still have no
// wired per-request capability-detection machinery and stay WP3-in-progress.
// ─────────────────────────────────────────────────────────────────────────────

// PLAN.md record 5b (~L416): the three driver names whose initial `dispatch`
// durably publishes an `activation-intent/v1` WAL (never `noop`, which has no
// WAL writer at all -- the core writes its delivery record directly instead).
// `codex-app-server`/`codex-mcp` are the two Codex frontends -- their OWN WAL
// writer is the trusted bridge host, only once the scheduler admits/selects
// the item for service, never this per-request `dispatch` call -- so they are
// deliberately NOT members of this set.
const REQUESTER_OWNED_DISPATCH_DRIVERS = Object.freeze(['claude-sendmessage', 'claude-agent', 'runtime-spawn']);

/**
 * Derives the project/repo root `checkClaudeAgentCapabilityAvailable` expects
 * (it reads `.claude/settings.json`'s own hook registrations). `.claude/`
 * config is a property of the CHECKOUT this script itself is installed into
 * -- never of an arbitrary `--coordination-root` target, which for a
 * sibling-worktree/cross-project consultation may point at a coordination
 * tree with no `.claude/settings.json` (or a different one) at all. Resolved
 * `__dirname`-relative (this file lives at `scripts/lib/runtime-consultation.cjs`,
 * two levels below the repo root) -- the SAME "find my own repo" convention
 * `context-provider-gate.js`'s own `CANONICAL_LIFECYCLE_CLI_PATH`/
 * `CANONICAL_CONSULTATION_CLI_PATH` already use, never derived from
 * `coordRoot`. Fails soft by construction, never by exception: every caller
 * of this helper is already wrapped in its own try/catch, so a genuinely
 * relocated/vendored copy of this file only ever costs
 * `checkClaudeAgentCapabilityAvailable` a real `{available:false}` -- never a
 * false grant.
 * @returns {string}
 */
function claudeAgentCapabilityProjectRoot() {
  return path.resolve(__dirname, '..', '..');
}

function dispatchCanonical(flags, options) {
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
  // R2-B (M6-M7-R2-INTEGRITY-CLOSURE-20260820): the path above is
  // content-addressed by NAMING CONVENTION only -- it does not itself prove
  // the bytes just read are genuinely the ones the request was correlated
  // against at publish time. Hash the SAME bytes already read (never a
  // second read) and require exact equality with the request's own
  // routing_policy_digest before parsing or selecting any driver. A mismatch
  // means the materialized snapshot was rewritten in place after publish
  // (same path, different content) -- fail closed with the same
  // INVALID/CORRELATION_INVALID shape every other request<->artifact
  // correlation check in this file already uses, before any
  // ActivationAction/grant/driver selection can occur.
  if (sha256Buffer(routingPolicyBytes) !== reqObj.routing_policy_digest) {
    throw new CliError('INVALID', 'CORRELATION_INVALID', 'materialized routing policy bytes do not match request routing_policy_digest: ' + routingPolicyPath);
  }
  // WP3 fix: real per-role route-table selection (PLAN.md Routing Registry:
  // "runtime-routing.json chooses a connector for one consultation attempt").
  // Uses the request's OWN pinned, content-addressed snapshot -- never the live
  // scripts/lib/runtime-routing.json -- so a routing.json edit after publish
  // can never silently change an in-flight request's route table. Iterates
  // the pinned, routing-preference-ordered driver list and selects the FIRST
  // one this dispatch can honestly prove capable: `claude-agent` is the one
  // non-noop driver with a real, wired mechanism-readiness check today
  // (`checkClaudeAgentCapabilityAvailable`, PLAN.md §15d), but that check is
  // not itself sufficient to select the driver.
  // `claude-sendmessage`/`codex-app-server`/`codex-mcp`/`runtime-spawn` still
  // require the RoleLifecycleController/runtime-bridge-codex.cjs
  // capability-detection machinery that does not exist yet for a PER-REQUEST
  // dispatch (WP3-in-progress) and are therefore never selected without real
  // proof -- `noop` is guaranteed present in `allowedDrivers` (checked above)
  // and remains the honest final fallback.
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
  // M6-M7-LIVE-FUNCTIONAL-ACCEPTANCE-20260820 fix round 1: requiredDriver is
  // validated and applied as a hard candidate filter BEFORE/DURING ordinary
  // priority-order selection, never merely checked against whatever ordinary
  // selection already picked -- an already-live higher-priority candidate
  // (e.g. claude-agent) must never win over a live REQUIRED lower-priority
  // one (e.g. codex-app-server); each candidate's own existing liveness proof
  // is unchanged, only which candidates are even considered.
  // WAVE1-FUNCTIONAL-CLOSEOUT-REALISTIC-20260822 mandatory driver fallback:
  // resolved here (moved up from just before activationPath below) because
  // the exclusion logic that follows needs the CURRENT authoritative attempt
  // -- if a canonical takeover has already superseded the initial attempt,
  // every candidate below is being selected for that NEW attempt, never the
  // superseded one.
  const auth = resolveAuthoritativeAttempt(reqObj, txnDir);
  const attemptId = auth.attemptId;
  const leaseEpoch = auth.leaseEpoch;
  let requiredDriver = options && options.requiredDriver;
  if (requiredDriver !== undefined && (!DRIVER_ENUM.includes(requiredDriver) || requiredDriver === 'noop')) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'required dispatch driver is invalid');
  }
  // Once a canonical takeover has superseded this request's initial attempt,
  // this dispatch call is for the NEW attempt -- the driver selected for the
  // superseded attempt must never be reselected here, even if it currently
  // reports itself live again (it already failed THIS request once). Read
  // straight off the superseded attempt's own durable activation record; no
  // new schema field is needed (the takeover binding itself never needs to
  // know which driver it superseded, only that one did). A caller-required
  // driver (the root-source caller always requires codex-app-server) that
  // turns out to be exactly the excluded one is never honored -- silently
  // fall through to ordinary priority-order selection among the remaining
  // candidates instead of throwing; that is precisely what this recovery
  // must do once codex-app-server itself is the excluded driver.
  let excludedDriver = null;
  if (attemptId !== reqObj.initial_attempt_id) {
    const supersededActivationRead = classifyDurableRead(activationPathFor(txnDir, reqObj.initial_attempt_id), { parse: true });
    if (supersededActivationRead.state === DURABLE_PRESENT) {
      assertClosedShape(supersededActivationRead.obj, ACTIVATION_V1_FIELDS);
      excludedDriver = supersededActivationRead.obj.selected_driver;
    }
  }
  if (requiredDriver !== undefined && requiredDriver === excludedDriver) {
    requiredDriver = undefined;
  }
  let selectedDriver = 'noop';
  let selectedClaudePeerBinding = null;
  let rll = null;
  for (const candidate of allowedDrivers) {
    if (requiredDriver !== undefined && candidate !== requiredDriver) continue;
    if (excludedDriver !== null && candidate === excludedDriver) continue;
    if (candidate === 'noop') {
      selectedDriver = 'noop';
      break;
    }
    if (candidate === 'claude-sendmessage') {
      // PLAN §15c: this accelerator is selectable only for exactly one
      // current, live peer in the same Claude session/worktree/PLAN/role.
      // The main-orchestrator binding is the host-observed source of the raw
      // session key; the coordination activation stores only the peer's
      // opaque binding id and the transient action exposes only its exact
      // registered teammate name.
      try {
        rll = rll || require('./runtime-role-lifecycle.cjs');
      } catch (err) {
        rll = null;
        continue;
      }
      let projectRoot;
      let manifest;
      let mainBinding;
      let peer;
      try {
        projectRoot = gitRevParse(coordRoot, ['rev-parse', '--show-toplevel']);
        manifest = rll.getCapabilityManifest(projectRoot);
        if (!manifest || manifest.ok !== true
            || !Array.isArray(manifest.availableDrivers)
            || !manifest.availableDrivers.includes('claude-sendmessage')) continue;
        mainBinding = rll.findLiveMainOrchestratorBindingForScope(
          projectRoot, reqObj.requester_worktree_id, reqObj.plan_digest,
        );
        if (!mainBinding || mainBinding.ok !== true) continue;
        peer = rll.findUniqueClaudePeerBindingForTarget(projectRoot, {
          sessionDigest: sha256String(mainBinding.binding.runtime_session_key),
          worktreeId: reqObj.requester_worktree_id,
          planDigest: reqObj.plan_digest,
          targetRole: reqObj.target_role,
        });
      } catch (err) {
        continue;
      }
      if (!peer || peer.ok !== true || !peer.record) continue;
      selectedClaudePeerBinding = peer.record;
      selectedDriver = 'claude-sendmessage';
      break;
    }
    if (candidate === 'claude-agent') {
      // Lazily require()s the sibling module -- runtime-role-lifecycle.cjs
      // requires THIS file at its own top level (WP3: reuse the sibling
      // module's already-proven fd-bound durability primitives), so a
      // top-level require() here would be a load-time cycle. Mirrors
      // resolveSupervisorStartability's own lazy require of
      // runtime-bridge-codex.cjs for the identical reason.
      try {
        rll = require('./runtime-role-lifecycle.cjs');
      } catch (err) {
        rll = null;
        continue; // mechanism unavailable -- never select without proof.
      }
      let capabilityResult;
      try {
        capabilityResult = rll.checkClaudeAgentCapabilityAvailable(claudeAgentCapabilityProjectRoot());
      } catch (err) {
        continue;
      }
      if (!capabilityResult || capabilityResult.available !== true) continue;

      // M6+M7 FINAL AUTHORITY CORRECTION (Group 4): mechanism-only readiness
      // (hooks present + registered) is NECESSARY but not SUFFICIENT --
      // PLAN.md §15d additionally requires the requester not be the running
      // planner-bootstrap subagent.
      if (reqObj.source_role === 'planner') continue;

      // PLAN.md §15d also requires "the active top-level host exposes one
      // foreground Agent call" -- i.e. proof that the CURRENT top-level
      // orchestrator session (a different session from this detached
      // cmdDispatch CLI subprocess, and from the requester's own identity --
      // RequesterBinding and MainOrchestratorBinding are explicitly separate
      // primitives, PLAN.md ~L594) is genuinely live right now. Two wrong
      // identities were explicitly ruled out here: findLiveClaudeAgentActivations
      // can only ever match THIS exact request's own activation/v1 record,
      // which this same function does not publish until AFTER this
      // driver-selection loop runs (below) -- a check keyed on this
      // request's own request_id is structurally unsatisfiable for every
      // request, never a genuine proof check; substituting the requester's
      // own CLAUDE-ID-01 attestation would conflate the requester identity
      // with the top-level-host identity. M6-M7-PRODUCTION-REACHABILITY-
      // 20260819 closes this gap with the ONE existing primitive PLAN.md
      // itself defines as modeling "the active top-level orchestrator"
      // (~L240, ~L594): a genuine, current, unexpired
      // MainOrchestratorBinding/v1 scoped to this EXACT request's own
      // requester_worktree_id+plan_digest is real, host-supplied proof that
      // the top-level orchestrator session is live right now -- read-only,
      // no new schema/artifact/driver. Unlike checkClaudeAgentCapabilityAvailable
      // above (a MECHANISM check that is deliberately fixed to the checkout
      // THIS script file itself lives in, never --coordination-root --
      // claudeAgentCapabilityProjectRoot()'s own doc comment), the binding
      // registry is repo-scoped: MainOrchestratorBinding/v1 is minted under
      // the SAME registryRepoDir(<repo the top-level orchestrator's own
      // checkout runs in>) that every other WP3 registry primitive uses.
      // For a same-repo dispatch that repo IS the one `--coordination-root`
      // resolves into, so the project root is derived the identical way the
      // codex-app-server branch below already derives its own (never
      // claudeAgentCapabilityProjectRoot()): gitRevParse(coordRoot,
      // ['rev-parse', '--show-toplevel']).
      let hasLiveBinding = false;
      try {
        const orchestratorProjectRoot = gitRevParse(coordRoot, ['rev-parse', '--show-toplevel']);
        hasLiveBinding = rll.hasLiveMainOrchestratorBindingForScope(
          orchestratorProjectRoot, reqObj.requester_worktree_id, reqObj.plan_digest,
        );
      } catch (err) {
        hasLiveBinding = false; // never let a liveness-check exception select a driver.
      }
      if (!hasLiveBinding) continue; // no live top-level-host proof -- never select without it, zero partial activation.
      selectedDriver = 'claude-agent';
      break;
    }
    if (candidate === 'codex-app-server') {
      // The bridge is required lazily because it imports this module to reuse
      // the canonical state machine.  At dispatch time this module is fully
      // initialized, so the lazy edge is cycle-safe.  Selection requires the
      // bridge's complete retained-worker proof (READY role binding + active
      // lifecycle owner + exact supervisor action + live process owner + one
      // fresh worker-presence record); a file/binary/mechanism check alone is
      // never capability evidence.
      let bridge;
      let projectRoot;
      try {
        bridge = require('./runtime-bridge-codex.cjs');
        projectRoot = gitRevParse(coordRoot, ['rev-parse', '--show-toplevel']);
      } catch (err) {
        continue;
      }
      let liveWorker;
      try {
        // The consultation target-profile digest and the lifecycle role-
        // template digest are deliberately different namespaces.  The bridge
        // independently accredits the current canonical lifecycle profile;
        // request<->activation correlation below accredits the consultation
        // profile.  Comparing the two unrelated digests would make this
        // branch structurally unreachable for every valid request.
        liveWorker = bridge.resolveLiveCodexAppServerWorker(projectRoot, reqObj.target_role);
      } catch (err) {
        continue;
      }
      if (liveWorker && liveWorker.ok === true && liveWorker.available === true) {
        selectedDriver = 'codex-app-server';
        break;
      }
      // M6+M7 SIXTEENTH Phase 2D (PLAN.md §16d: "post-intent and post-ingress
      // target loss on both retained-root and toolkit-root paths... dispatch
      // fails closed and neither selects noop nor counts noop as delivery/
      // evidence"; "a lost target falls back to noop" is one of §16d's own
      // named required-RED mutations). `resolveLiveCodexAppServerWorkerUncached`
      // (runtime-bridge-codex.cjs) reaches `supervisor-process-not-live`
      // ONLY after independently confirming the lifecycle owner record is
      // genuinely ACTIVE/RETAINED and exactly scope-matched -- i.e. this
      // target WAS a real, live, retained worker for this exact repo/
      // worktree/plan, and the one remaining reason it is not available now
      // is that its OS process is confirmed dead. That is "lost", never
      // "never available" -- falling through to another candidate (or the
      // routing policy's own noop fallback) would silently launder an
      // already-possible commitment into a fabricated non-delivery success.
      // Every OTHER reason (owner never active, scope mismatch, action
      // absent/mismatched, indeterminate liveness) means this target was
      // never a proven live commitment in the first place, so the ordinary
      // routing-policy fallback below remains correct for those.
      if (liveWorker && liveWorker.ok === true && liveWorker.reason === 'supervisor-process-not-live') {
        throw new CliError('UNAVAILABLE', 'DRIVER_UNAVAILABLE', 'retained codex-app-server target for ' + reqObj.target_role + ' was genuinely retained and is now lost -- dispatch fails closed rather than falling back to noop or a lower-priority candidate');
      }
      continue;
    }
    // claude-sendmessage/codex-mcp/runtime-spawn: no wired, non-fabricated
    // per-request capability evidence exists yet -- never select without
    // proof; try the next routing-permitted candidate.
  }

  if (requiredDriver !== undefined && selectedDriver !== requiredDriver) {
    throw new CliError('UNAVAILABLE', 'DRIVER_UNAVAILABLE', 'required dispatch driver is not currently live: ' + requiredDriver);
  }

  const activationPath = activationPathFor(txnDir, attemptId);
  const idempotentRecovery = !!(options && options.allowIdenticalIdempotent === true);
  let existingActivation = null;
  const existingActivationRead = classifyDurableRead(activationPath, { parse: true });
  if (existingActivationRead.state === DURABLE_PENDING) {
    throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'activation is still pending during dispatch recovery');
  }
  if (existingActivationRead.state === DURABLE_PRESENT) {
    assertClosedShape(existingActivationRead.obj, ACTIVATION_V1_FIELDS);
    existingActivation = existingActivationRead.obj;
    if (
      existingActivation.request_id !== reqObj.request_id
      || existingActivation.request_digest !== reqRec.digest
      || existingActivation.attempt_id !== attemptId || existingActivation.lease_epoch !== leaseEpoch
      || existingActivation.target_role_profile_digest !== reqObj.target_role_profile_digest
      || existingActivation.routing_policy_version !== reqObj.routing_policy_version
      || existingActivation.routing_policy_digest !== reqObj.routing_policy_digest
      || existingActivation.selected_driver !== selectedDriver
      || existingActivation.native_target_binding_id !== (
        selectedDriver === 'claude-sendmessage' ? selectedClaudePeerBinding.binding_id : null
      )
      || existingActivation.activation_liveness_expiry !== activationLivenessDeadline(reqObj)
    ) throw new CliError('INVALID', 'AUTHORITY_INVALID', 'existing activation does not match deterministic dispatch recovery');
    if (!idempotentRecovery) existingActivation = null; // preserve ordinary dispatch's no-clobber replay rejection.
  }
  const now = existingActivation ? existingActivation.created_at : nowIso();
  // Core-generated opaque one-shot action id (PLAN.md §15d: "Dispatch first
  // commits request, activation (including core-generated
  // native_spawn_action_id)..."), required only for claude-agent; null for
  // every other driver (activation/v1's own field constraint, unchanged).
  const nativeSpawnActionId = existingActivation
    ? existingActivation.native_spawn_action_id
    : (selectedDriver === 'claude-agent' ? crypto.randomBytes(16).toString('hex') : null);
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
    native_target_binding_id: selectedDriver === 'claude-sendmessage'
      ? selectedClaudePeerBinding.binding_id
      : null,
    native_spawn_action_id: nativeSpawnActionId,
    created_at: now,
    activation_liveness_expiry: activationLivenessDeadline(reqObj),
  };
  assertClosedShape(activationObj, ACTIVATION_V1_FIELDS);
  publishNoClobber(activationPath, Buffer.from(canonicalJSONStringify(activationObj), 'utf8'), {
    allowIdenticalIdempotent: idempotentRecovery,
    raceDetailCode: 'AUTHORITY_INVALID',
  });

  // Requester-owned accelerators (claude-sendmessage/claude-agent/runtime-spawn)
  // durably publish their intent WAL here, after activation and before inbox
  // exposure/action return (record 5b, PLAN.md ~L416-430: "initial dispatch
  // writes it durably after activation and before inbox exposure/action
  // return"). `noop` has no WAL writer at all -- the core instead writes the
  // noop delivery record directly (Activation Drivers table, PLAN.md ~L848:
  // "Receipt writer: delivery/<attempt_id>.json records driver:'noop'
  // explicitly").
  if (REQUESTER_OWNED_DISPATCH_DRIVERS.includes(selectedDriver)) {
    const activationIntentObj = {
      schema: 'coordination/activation-intent/v1',
      request_digest: reqRec.digest,
      attempt_id: attemptId,
      lease_epoch: leaseEpoch,
      driver: selectedDriver,
      commit_point_pending: true,
      created_at: now,
    };
    publishNoClobber(
      activationIntentPathFor(txnDir, attemptId),
      Buffer.from(canonicalJSONStringify(activationIntentObj), 'utf8'),
      { raceDetailCode: 'AUTHORITY_INVALID' },
    );
  } else if (selectedDriver === 'noop') {
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
  }

  const inboxPath = inboxPathFor(planRoot, reqObj.target_role, reqObj.request_id);
  let inboxCreatedAt = now;
  // WAVE1-FUNCTIONAL-CLOSEOUT-REALISTIC-20260822: read any EXISTING,
  // request-correlated inbox-ref and reuse its created_at UNCONDITIONALLY --
  // not only when the caller opted into idempotentRecovery. inbox-ref is
  // keyed by (target_role, request_id) alone, deliberately attempt-agnostic:
  // "this request entered this role's inbox" is a fact about the REQUEST,
  // not about any one attempt, so every dispatch for the same request must
  // converge on the SAME inbox-ref bytes. Before this fix, a legitimate
  // post-takeover redispatch (a different attempt_id, same request_id) always
  // computed a fresh inboxCreatedAt and lost the no-clobber race against the
  // first dispatch's already-durable inbox-ref with AUTHORITY_INVALID,
  // making the mandatory driver-fallback recovery unreachable in practice --
  // confirmed by WAVE1-E2E-02-DRIVER-FALLBACK across four independent
  // reproductions. Deterministically converging on the first writer's
  // timestamp costs nothing: attempt/epoch fencing (the actual authority
  // boundary) is enforced by claim/lease/result validation elsewhere, never
  // by this notification-only artifact's created_at.
  const existingInbox = classifyDurableRead(inboxPath, { parse: true });
  if (existingInbox.state === DURABLE_PENDING) {
    throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'inbox ref is still pending during dispatch');
  }
  if (existingInbox.state === DURABLE_PRESENT) {
    assertClosedShape(existingInbox.obj, INBOX_REF_V1_FIELDS);
    if (
      existingInbox.obj.request_id !== reqObj.request_id
      || existingInbox.obj.request_digest !== reqRec.digest
      || existingInbox.obj.target_role !== reqObj.target_role
      || existingInbox.obj.kind !== 'consult'
    ) throw new CliError('INVALID', 'AUTHORITY_INVALID', 'existing inbox ref does not match this request');
    inboxCreatedAt = existingInbox.obj.created_at;
  }
  const inboxRefObj = {
    schema: 'coordination/inbox-ref/v1',
    request_id: reqObj.request_id,
    request_digest: reqRec.digest,
    kind: 'consult',
    target_role: reqObj.target_role,
    created_at: inboxCreatedAt,
  };
  assertClosedShape(inboxRefObj, INBOX_REF_V1_FIELDS);
  publishNoClobber(
    inboxPath,
    Buffer.from(canonicalJSONStringify(inboxRefObj), 'utf8'),
    { allowIdenticalIdempotent: true },
  );

  // PLAN's frozen ActivationAction union: every caller-executed arm carries
  // the exact common correlation fields, then only its closed driver payload.
  // Neither action is authority or evidence; activation/WAL/inbox are already
  // durable before this transient descriptor becomes visible.
  let activationAction = null;
  const commonActivationAction = {
    schema: 'coordination/activation-action/v1',
    request_id: reqObj.request_id,
    attempt_id: attemptId,
    lease_epoch: leaseEpoch,
    selected_driver: selectedDriver,
    target_role: reqObj.target_role,
    request_artifact_path: requestPath,
    activation_artifact_path: activationPath,
  };
  if (selectedDriver === 'claude-sendmessage') {
    activationAction = {
      ...commonActivationAction,
      kind: 'claude-sendmessage',
      target_name: selectedClaudePeerBinding.teammate_name,
      message: {
        role: reqObj.source_role,
        target_role: reqObj.target_role,
        request_id: reqObj.request_id,
        artifact_path: requestPath,
        kind: 'consult',
      },
    };
  } else if (selectedDriver === 'claude-agent') {
    activationAction = {
      ...commonActivationAction,
      kind: 'claude-agent',
      agent_type: reqObj.target_role,
      spawn_action_id: nativeSpawnActionId,
      bootstrap_message: {
        role: reqObj.source_role,
        target_role: reqObj.target_role,
        request_id: reqObj.request_id,
        artifact_path: requestPath,
        activation_path: activationPath,
        kind: 'consult-one-shot',
      },
    };
  }
  return { request_id: reqObj.request_id, artifact_ref: activationPath, activation_action: activationAction };
}
function cmdDispatch(flags, grantContext) {
  // Driver selection belongs to the target's pinned route and current live
  // capability evidence. A root-source grant authenticates the requester;
  // it does not imply that requester is backed by codex-app-server. Claude
  // native root sources are legitimate after the exact reporting architect
  // binding has been validated, and must therefore be able to select their
  // unique claude-sendmessage target instead of being forced onto an absent
  // Codex worker. Retained Codex bridge children still use the separate
  // in-process dispatchCanonical(...,{requiredDriver:'codex-app-server'})
  // call in hostBridgePublishChildRequest above.
  return dispatchCanonical(flags, {});
}
COMMANDS.dispatch = cmdDispatch;

/**
 * M7 completeness Part C follow-up (2026-08-09, PLAN.md §15d, user Block 3
 * point 4): reads the request at `requestPath`, resolves its CURRENT
 * authoritative attempt, and reads THAT attempt's own live `activation/v1`
 * record if one genuinely exists and path<->field-correlates (its own
 * `request_id`/`attempt_id` must equal what was just resolved) -- the
 * read-side runtime-consultation-target-gate.js uses to determine which
 * binding type may back a target grant: a DETERMINISTIC branch on
 * `selected_driver` (arch-integration-prep's own guidance, relayed
 * 2026-08-09: `'claude-agent'` -> ClaudeOneShotBinding, anything else ->
 * RoleActorBinding, never a fallback/probe-both). Returns
 * `{ok:true,activation:null}` (not an error) when no activation exists yet
 * for the authoritative attempt, or it exists but is malformed/foreign --
 * dispatch may not have run yet, or (today, always, per cmdDispatch's own
 * WP2 scoping) never selects claude-agent -- callers treat a null
 * activation as "not claude-agent", i.e. the persistent, unchanged
 * RoleActorBinding path. Returns `{ok:false}` only for a genuinely
 * malformed/absent/non-durable REQUEST -- the caller must reject the
 * command outright in that case, never guess.
 * @param {string} requestPath
 * @returns {{ok:true,requestId:string,attemptId:string,leaseEpoch:number,activation:object|null}|{ok:false}}
 */
function resolveActivationForRequestPath(requestPath) {
  const txnDir = path.dirname(requestPath);
  let reqObj;
  let reqDigest;
  try {
    // Stage C (M7-FINAL-REMEDIATION-20260818): one fd-bound canonical read
    // retaining both the parsed request AND the SHA-256 digest of those
    // exact bytes (readCanonicalRequestRecord -> readClosedRecord ->
    // readDurableRecord already computes it) -- never a second, separate
    // reopen of request.json merely to obtain a digest. Mirrors this file's
    // own readRequestForTxnOrCorrelationInvalid wrapper exactly (same
    // absentDetail/absentMessage policy), which callers that need only
    // `.obj` keep using unchanged.
    const reqRec = readCanonicalRequestRecord(path.join(txnDir, 'request.json'), path.basename(txnDir), {
      absentDetail: 'CORRELATION_INVALID',
      absentMessage: 'referenced request.json does not resolve',
    });
    reqObj = reqRec.obj;
    reqDigest = reqRec.digest;
  } catch (err) {
    return { ok: false };
  }
  let auth;
  try {
    auth = resolveAuthoritativeAttempt(reqObj, txnDir);
  } catch (err) {
    return { ok: false };
  }
  let activationObj = null;
  try {
    const classified = classifyDurableRead(activationPathFor(txnDir, auth.attemptId), { parse: true });
    // M7 GREEN correction round 2, R5: a durably in-flight (nlink=2) write
    // is neither genuine absence nor a valid activation -- must never be
    // silently folded into ABSENT (which a general caller reads as
    // "safe to treat as no activation"). Only genuine DURABLE_ABSENT falls
    // through to the {ok:true, activation:null} return below.
    if (classified.state === DURABLE_PENDING) return { ok: false };
    if (classified.state === DURABLE_PRESENT) {
      assertClosedShape(classified.obj, ACTIVATION_V1_FIELDS);
      const a = classified.obj;
      // Stage C: full DURABLE_PRESENT correlation against the request --
      // request_id/attempt_id alone (the pre-Stage-C predicate) missed
      // request_digest, lease_epoch, target_role_profile_digest, and the
      // routing_policy version/digest pair entirely.
      if (
        a.request_id !== reqObj.request_id || a.request_digest !== reqDigest
        || a.attempt_id !== auth.attemptId || a.lease_epoch !== auth.leaseEpoch
        || a.target_role_profile_digest !== reqObj.target_role_profile_digest
        || a.routing_policy_version !== reqObj.routing_policy_version
        || a.routing_policy_digest !== reqObj.routing_policy_digest
      ) {
        // R5 lineage: present but DECORRELATED -- a real, distinct error,
        // never silently folded into ABSENT either.
        return { ok: false };
      }
      // Stage C: canonical time checks -- created_at never in the future,
      // never later than its own expiry, and activation_liveness_expiry
      // must be EXACTLY the same deterministic deadline the write side
      // computes (activationLivenessDeadline), never merely "some future
      // timestamp" of the record's own choosing.
      const createdAtMs = isoToMs(a.created_at);
      const expiryMs = isoToMs(a.activation_liveness_expiry);
      const nowMs = currentClockMs();
      if (
        createdAtMs > nowMs || createdAtMs > expiryMs
        || a.activation_liveness_expiry !== activationLivenessDeadline(reqObj)
        || nowMs >= expiryMs
      ) {
        // R5 lineage: present, correlated, but EXPIRED (or a canonical-time
        // violation) -- never treated as still valid, never folded into
        // ABSENT.
        return { ok: false };
      }
      // Stage C: driver/native-field coherence -- never infer or repair
      // either field. Lazy require mirrors this file's own established
      // circular-dependency-safe pattern (runtime-role-lifecycle.cjs itself
      // requires this file); only reached once a record is otherwise fully
      // correlated and live.
      if (a.selected_driver === 'claude-agent') {
        const rll = require('./runtime-role-lifecycle.cjs');
        if (!rll.isHexActionId(a.native_spawn_action_id) || a.native_target_binding_id !== null) return { ok: false };
      } else if (a.selected_driver === 'claude-sendmessage') {
        const rll = require('./runtime-role-lifecycle.cjs');
        if (!rll.isHexActionId(a.native_target_binding_id) || a.native_spawn_action_id !== null) return { ok: false };
      } else if (a.native_spawn_action_id !== null || a.native_target_binding_id !== null) {
        return { ok: false };
      }
      activationObj = a;
    }
  } catch (err) {
    // M7 GREEN section 4.8: a genuinely malformed/unsafe durable activation
    // record (shape-invalid, symlinked, foreign-owner, etc. -- anything
    // assertClosedShape/classifyDurableRead itself rejects) is an
    // INDETERMINATE resolution, never silently folded into "no activation
    // yet" (ok:true, activation:null) -- the caller must block, never
    // silently fall through to treating this request as if no claude-agent
    // activation could ever exist for it.
    return { ok: false };
  }
  // M7 completeness Part C follow-up (retirement wiring, user Block 4 point
  // 4): also surfaces targetRole/worktreeId/planDigest -- reqObj is already
  // fully parsed above, so this is a non-invasive extension (no new read),
  // and cmdCancel's own post-success retirement lookup needs exactly these
  // fields to resolve the exact-scope ClaudeOneShotBinding it must retire.
  return {
    ok: true, requestId: reqObj.request_id, attemptId: auth.attemptId, leaseEpoch: auth.leaseEpoch,
    activation: activationObj, targetRole: reqObj.target_role, worktreeId: reqObj.subject_worktree_id,
    planDigest: reqObj.plan_digest,
  };
}

/**
 * M7 completeness Part C follow-up (2026-08-09, PLAN.md §15d, user Block 3
 * point 2): scans this plan-root's transaction tree for every LIVE
 * `activation/v1` record with `selected_driver==='claude-agent'` whose
 * parent request's `target_role` matches `role` -- the read-side half of
 * "recognize a CURRENT claude-agent ActivationAction" for
 * agent-spawn-execution-gate.js. Never returns on the first match: collects
 * EVERY genuinely live candidate so the caller applies the SAME "zero or
 * more-than-one -> non-owning/ambiguous, never guess" discipline this
 * codebase's other ownership scans already use (mirrors
 * findOwningRoleLifecycleCandidate's own convention). A candidate is "live"
 * only when its own `activation_liveness_expiry` has not yet passed; an
 * absent/malformed/shape-invalid request or activation is silently skipped
 * (never a candidate), never thrown -- a scan over many transactions must
 * not abort on one unrelated malformed entry. `activation.request_id` is
 * additionally cross-checked against the transaction directory it was found
 * under (path<->field correlation, mirroring this file's own established
 * discipline elsewhere) before ever being trusted.
 *
 * PRODUCTION REALITY (disclosed, not hidden): `cmdDispatch` above is
 * WP2-scoped -- its driver selection is unconditionally `noop`, so no
 * `activation/v1` record with `selected_driver:'claude-agent'` is ever
 * produced today. This function can therefore only ever return `[]` in
 * current production, by construction -- see
 * runtime-role-lifecycle.cjs's own ClaudeAgentSpawnReservation/v1 section
 * header for the full disclosure. Built completely and correctly against
 * the real, already-frozen `activation/v1` schema regardless, ready for a
 * future WP3 dispatch-side producer.
 * @param {string} coordRoot
 * @param {string} repoId
 * @param {string} waveSlug
 * @param {string} planDigest
 * @param {string} role
 * @returns {Array<{activation:object,requestId:string}>}
 */
function findLiveClaudeAgentActivations(coordRoot, repoId, waveSlug, planDigest, role) {
  const planRoot = planRootPath(coordRoot, repoId, waveSlug, planDigest);
  const txnsDir = path.join(planRoot, 'transactions');
  let txnEntries;
  try {
    txnEntries = fs.readdirSync(txnsDir, { withFileTypes: true });
  } catch (err) {
    return [];
  }
  const nowMs = currentClockMs();
  const found = [];
  for (const txnEntry of txnEntries) {
    if (!txnEntry.isDirectory() || !isHexId(txnEntry.name)) continue;
    const requestId = txnEntry.name;
    const txnDir = path.join(txnsDir, requestId);
    let reqObj;
    try {
      reqObj = readCanonicalRequestRecord(path.join(txnDir, 'request.json'), requestId, {}).obj;
    } catch (err) {
      continue; // absent/malformed/foreign request -- never a candidate.
    }
    if (reqObj.target_role !== role) continue;
    const activationsDir = path.join(txnDir, 'activations');
    let activationEntries;
    try {
      activationEntries = fs.readdirSync(activationsDir, { withFileTypes: true });
    } catch (err) {
      continue;
    }
    for (const activationEntry of activationEntries) {
      if (!activationEntry.isFile() || !activationEntry.name.endsWith('.json')) continue;
      let activationObj;
      try {
        const classified = classifyDurableRead(path.join(activationsDir, activationEntry.name), { parse: true });
        if (classified.state !== DURABLE_PRESENT) continue;
        assertClosedShape(classified.obj, ACTIVATION_V1_FIELDS);
        activationObj = classified.obj;
      } catch (err) {
        continue; // malformed/non-durable -- never a candidate.
      }
      if (activationObj.selected_driver !== 'claude-agent') continue;
      if (activationObj.request_id !== requestId) continue;
      // activation_liveness_expiry's own canonical-ISO-UTC shape is already
      // proven by assertClosedShape(activationObj, ACTIVATION_V1_FIELDS)
      // above -- this is a plain liveness comparison, not a second shape check.
      if (isoToMs(activationObj.activation_liveness_expiry) <= nowMs) continue;
      found.push({ activation: activationObj, requestId });
    }
  }
  return found;
}

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

function cmdPublishResult(flags, grantContext) {
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
  return withLock(txnDir, coordRoot, (lockToken) => {
    // Codex NO-GO round 16: a fresh scope check as the FIRST thing inside
    // this callback -- withLock's own pre-fn check happens once, before fn
    // starts; every read fn itself performs afterward (reqRec, claimRec
    // below, and every authority field resultObj is built from) had no
    // check of its own closer to it.
    assertLockedScopeIdentity(lockToken);
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

    // Codex NO-GO round 16 (P0): PLAN.md ~L443 makes "absence of committed
    // takeover/cancel/accept" part of candidate publication's OWN mandatory
    // contract, not an optional hardening pass -- this was missing entirely.
    // Absence of a committed takeover is already structurally enforced above
    // (resolveAuthoritativeAttempt itself resolves to the POST-takeover
    // attempt/epoch; a claim for the superseded attempt already fails the
    // attempt/epoch check just below). accepted-result.json/cancel.json are
    // NOT otherwise checked anywhere in this function -- mirrors cmdCancel's/
    // cmdAcceptResult's own already-established terminal-exclusion pattern.
    //
    // HARD NO-GO (post round 17, corrected round 19): see cmdCancel's
    // matching call for the full rationale -- this now uses the SAME full
    // correlator (assertAcceptedResultCorrelates), not the reversed,
    // narrower assertAcceptedResultTiedToTransaction.
    const existingAccepted = readJsonDurableOptional(acceptedResultPathFor(txnDir), { shape: (o) => assertClosedShape(o, ACCEPTED_RESULT_V1_FIELDS) });
    if (existingAccepted !== null) {
      assertAcceptedResultCorrelates(existingAccepted, txnDir, reqObj, coordRoot);
      throw new CliError('INVALID', 'AUTHORITY_INVALID', 'transaction already has an accepted-result.json');
    }
    if (readCanonicalCancelRecordOptional(cancelPathFor(txnDir), coordRoot) !== null) {
      throw new CliError('CANCELLED', 'TRANSACTION_CANCELLED', 'transaction was already cancelled');
    }

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
      consultation_dependencies: (
        grantContext && grantContext.hostBridge === true
        && Array.isArray(grantContext.consultationDependencies)
      ) ? grantContext.consultationDependencies.map((dep) => Object.assign({}, dep)) : [],
      // Host-derived only.  CLI/model input has no flag/field capable of
      // supplying this dependency; the retained bridge passes it separately
      // after publishing and validating pattern-evidence/v1.
      pattern_evidence_dependency: (
        grantContext && grantContext.hostBridge === true
        && grantContext.patternEvidenceDependency !== undefined
      ) ? (grantContext.patternEvidenceDependency === null
        ? null : Object.assign({}, grantContext.patternEvidenceDependency)) : null,
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
    validatePatternEvidenceForResult(resultObj.pattern_evidence_dependency, resultObj, reqRec, txnDir, planRootFromArtifact(coordRoot, requestPath));

    // Section 4: publish only after the final inside-lock authority check above --
    // a takeover that won before lock acquisition was already rejected there, so
    // this publish is never reached for a superseded attempt.
    const resultPath = resultPathFor(txnDir, auth.attemptId);
    const resultBytes = Buffer.from(canonicalJSONStringify(resultObj), 'utf8');
    // Codex NO-GO round 15 ("los cinco callers del lock"): a fresh scope check
    // immediately before this write, mirroring every other hardened caller in
    // this file.
    //
    // Codex NO-GO round 16: PLAN.md ~L704's own frozen rule -- "same-digest
    // duplicate candidates are idempotent" -- is REUSED here via
    // publishNoClobber's own existing, already-proven allowIdenticalIdempotent
    // mechanism (fd-bound, byte-for-byte, never a field-excluding
    // reconstruction of "logical" identity) rather than any new invention;
    // R10's own canonicalRetryComparisonDigest (excluding created_at) is
    // retracted -- see CONFLICT-DESIGN-R11.md. A genuinely DIFFERENT
    // candidate for the same (attempt_id, lease_epoch) remains AUTHORITY_INVALID,
    // unchanged from today's real behavior -- publish-result holds only
    // TARGET authority (PLAN.md ~L580-592), so it must never itself write
    // cancel.json/conflict/*.json (REQUESTER-only artifacts); see R11 for why
    // no CONFLICT/RESULT_CONFLICT reporting belongs here either.
    assertLockedScopeIdentity(lockToken);
    const resultReceipt = publishNoClobber(resultPath, resultBytes, { allowIdenticalIdempotent: true, raceDetailCode: 'AUTHORITY_INVALID' });
    // publishNoClobber succeeded OUTRIGHT (no EEXIST) -- SUCCESS-path scope+
    // receipt re-verification, mirroring cmdClaim/cmdCancel/cmdAcceptResult/
    // cmdTakeover's own established pattern. A thrown EEXIST/race-loss above
    // never reaches this point at all -- unchanged, pre-existing behavior.
    testRendezvous(txnDir, 'publish-result-post-publish-pre-recheck');
    try {
      assertLockedScopeIdentity(lockToken);
      assertArtifactMatchesReceipt(resultPath, resultReceipt, resultBytes);
    } catch (err) {
      throw isPoisoned(err) ? err : markPoisoned(err);
    }
    return { request_id: reqObj.request_id, artifact_ref: resultPath };
  });
}
COMMANDS['publish-result'] = cmdPublishResult;

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

module.exports = {
  isSafeRelativeEntryPath,
  canonicalJSONStringify, sha256Buffer, sha256String, sha256File, writeAllSync, classifyDurableRead,
  // NO-GO Correction C: the ONE canonical ack/cancel basename source,
  // reused by runtime-role-lifecycle.cjs's retirement-record validator to
  // reject a non-canonical terminal_ref (never a second, separately
  // hardcoded basename literal). acceptedResultPathFor added for M7 RED 17
  // (M7-ONESHOT-TERMINAL-CUT): mintRoleCommandGrant's own one-shot-family
  // terminal check reuses this SAME basename source, never a second literal.
  // resultPathFor added for M7 defect 6: the one-shot family's own
  // AUTHORITATIVE terminal is its result (results/<attempt>.json), never
  // accepted-result.json (section 8.5) -- exported so
  // runtime-role-lifecycle.cjs's own mintRoleCommandGrant/consultation.cjs's
  // own consume-time recheck share this SAME path source, never a second
  // hardcoded literal.
  ackPathFor, cancelPathFor, acceptedResultPathFor, resultPathFor,
  isValidLockTokenFor, acquireLock, releaseLock, listResultFiles, findResultWithStatus, reconcileOneNoClobberTemp,
  // WP3: reused by runtime-role-lifecycle.cjs's host-private registry (same fd-bound
  // durability primitives, never a second reimplementation of this security-critical logic).
  DURABLE_ABSENT, DURABLE_PENDING, DURABLE_PRESENT, publishNoClobber, gitRevParse, realpathOrSelf,
  // M6+M7 SIXTEENTH Phase 2C: sealed git-topology cache primitives, reused
  // by every module that memoizes a per-projectRoot git-derived identity
  // rather than each hand-rolling its own (weaker, divergence-prone) seal.
  // sealCorrelatesWithGitCommonDir added post-review (commondir seal gap):
  // exact self-consistency check between commondir's own resolved target
  // and the gitCommonDirReal string git itself produced.
  resolveSealedGitCache, sealGitIdentityFor, gitTopologySealsMatch, sealCorrelatesWithGitCommonDir,
  // WP3 item C: the bridge's own coordination-root check reuses this EXACT
  // confinement primitive rather than a second, weaker one.
  validateRootConfinement,
  // WP3 item C2 (R7): single canonical RuntimeTurnEnvelope/v1 source (PLAN.md ~L932).
  runtimeTurnEnvelopeSchema, validateRuntimeTurnEnvelope,
  codexStructuredRuntimeTurnEnvelopeSchema,
  unwrapAndValidateCodexStructuredRuntimeTurnEnvelope,
  validateContext7LibraryId: isCanonicalContext7LibraryId,
  // M6/M7 terminal functional closure (points A/C/F): request-scoped
  // APPROVED_CONTEXT7_LIBRARY_ID directive parser, the unified root-aware
  // evidence-authority resolver, and the canonical consultation_dependencies
  // validator -- exported for direct node:test coverage of this
  // security-critical logic (M67-* RED suites).
  parseApprovedContext7Directive,
  resolveRootEvidenceAuthority,
  validateConsultationDependencySet,
  patternEvidencePathFor,
  materializePlanRef,
  materializeRoutingPolicy,
  materializeSubjectBundle,
  targetRoleProfileDigestFor,
  ROUTING_POLICY_VERSION,
  ROUTING_POLICY_DIGEST,
  buildCanonicalRequest,
  publishPreallocatedRequest,
  dispatchCanonical,
  createHostBridgeCapability,
  hostBridgeListRootConsultIntents,
  hostBridgeAdvanceRootConsult,
  hostBridgeObserveAndCompleteRootConsult,
  readRootConsultTerminalStatus,
readRootSourceTerminalArtifacts,
  hostBridgeListInbox,
  hostBridgeClaim,
  hostBridgeLeaseHeartbeat,
  hostBridgeScheduleTurn,
  hostBridgeRecordTurnStartAccepted,
  hostBridgePublishPatternEvidence,
  hostBridgePublishTerminalResult,
  hostBridgeAllowedChildRoles,
  hostBridgePublishChildRequest,
  hostBridgeObserveChildResult,
  // M7 completeness Part C follow-up: the read-side scan agent-spawn-
  // execution-gate.js/subagent-start-context-bundle.js use to recognize a
  // CURRENT claude-agent-driven activation/v1 (PLAN.md §15d). planRootPath
  // itself is deliberately NOT exported -- nothing outside this file calls
  // it directly, only findLiveClaudeAgentActivations's own internal use.
  findLiveClaudeAgentActivations,
  // M7 completeness Part C follow-up: the per-request driver resolver
  // runtime-consultation-target-gate.js uses for its deterministic
  // ClaudeOneShotBinding-vs-RoleActorBinding branch (point 4).
  resolveActivationForRequestPath,
  // M6+M7 requester-authority closure (Group B): the ONE shared requester-
  // grant-scope resolver context-provider-gate.js uses to mint a correctly-
  // scoped grant, mirroring the SAME resolution this file's own main()
  // independently re-derives before consuming one.
  resolveRequesterGrantScope,
};

// ─────────────────────────────────────────────────────────────────────────────
// R33 static conformance surface -- TEST-CAPABILITY-GATED, NOT a production export.
//
// The entire R33 surface is currently reachable ONLY by tests, and this gate says
// exactly that. An UNCONDITIONAL export is a shipped surface no matter what the
// comment above it claims, and an earlier revision shipped these unconditionally
// on the reasoning that R3.3:1115-1117 names their eventual in-process callers
// (step 12 the root-profile check, step 17 the provider-session check). That
// justified their EXISTENCE as contract implementation awaiting its consumer; it
// never justified a public surface. Those callers belong to the provider-owned
// composition and DO NOT EXIST YET.
//
// Gated behind the same `isTestCapability()` seam as `--fixed-ids`/`--fixed-clock`
// (NODE_ENV=test PLUS a harness-created RUNTIME_CONSULTATION_TEST_CAPABILITY,
// cjs:207). Resolved ONCE at require time, so a production `require` of this
// module observes none of these names.
//
// WHEN PHASE B LANDS, the production export is the complete authoritative
// composition -- never these partial parsers. They stay behind this gate as its
// internals. Do not promote one of them to production reach because a caller
// finds it convenient: a conformance check that escapes into production is the
// public-SUCCESS mistake in a different costume.
//
// What they are, restated so the gate is not mistaken for mere test plumbing:
// they prove closed schema, canonical bytes, confined paths, tuple correlation
// and the A.5 digests. They establish NO authority, accreditation or liveness. A
// caller that runs any of them to completion has learned that bytes conform to a
// closed schema -- not that a root, session or profile is legitimate.
//
// The field tables remain unexported even under the gate: tests must not
// introspect internals. Key counts are pinned by the module-load count assertion
// plus golden vectors. `R33_TUPLE_CORRELATION_KEYS` is the deliberate exception --
// it is a DERIVED CONTRACT ARTIFACT, not a harness, and the 17x1 mutation matrix
// must iterate the PRODUCTION table; a hardcoded list of 17 names would let a
// disabled comparison and a deleted test row both stay green, which is exactly
// how the missing per-key coverage went unnoticed.
// ─────────────────────────────────────────────────────────────────────────────
if (isTestCapability()) {
  Object.assign(module.exports, {
    // A.5 digest formulas (R3.3:3716-3729) -- a test uses the PRODUCTION formula
    // rather than reimplementing it, since a reimplementation either drifts from
    // production or fails for the wrong reason; a golden vector then pins it so a
    // production change cannot silently pass.
    rootProfileDigestV3,
    providerSessionDigestV3,
    temporalEnvelopeDigestV1,
    // Non-authoritative conformance checks.
    checkRootProfileV3Conformance,
    checkProviderSessionV3Conformance,
    checkRuntimeProfileBindingV2Conformance,
    checkR33ProfileTupleConformance,
    // Derived contract artifact (see above).
    R33_TUPLE_CORRELATION_KEYS,
    // M7 §10.1: test-only rendezvous surface -- a test harness that needs to
    // drive/inspect the rendezvous mechanism directly, rather than only
    // through a real command call path, can.
    testM7Rendezvous,
    resolveSafeM7RendezvousDir,
    // Stage D (M7-FINAL-REMEDIATION-20260818, mandatory nonsemantic cleanup):
    // resolveActivationForRequestPath checks activation_liveness_expiry
    // against this SAME formula -- a test fixture that needs a genuinely-live
    // activation record derives its own liveness deadline from the real
    // function, never a second, independently hand-maintained copy that can
    // silently drift from it. Not a new production public surface -- usable
    // by tests under the real test capability only.
    activationLivenessDeadline,
  });
}

// Publish the complete require()-able surface before entering CLI execution.
// runtime-role-lifecycle.cjs reuses the durability primitives above and the
// CLI's requester-grant validator lazily requires lifecycle in return. Running
// main() before assigning module.exports exposed an empty partial module during
// that cycle and made every canonical requester binding fail as `read-failed`.
if (require.main === module) {
  main();
}
