#!/usr/bin/env node
'use strict';

/**
 * runtime-role-lifecycle.cjs -- Wave 1 (portable-runtime-messaging-adapters) WP1
 * skeleton. Deterministic policy/registry engine per PLAN.md "Host-native lifecycle
 * action boundary (frozen execution contract)" (~L134-170) and "Tracked policy versus
 * host-local presence" (~L86-119).
 *
 * WP1 SCOPE (skeleton): deterministic argv parsing/validation, policy load+validate,
 * deterministic project/toolkit pair-atomic lookup, and emission of the closed
 * `coordination/lifecycle-cli-result/v1` JSON envelope with the correct
 * status/code/detail_code for every fail-closed case reachable WITHOUT a live Claude
 * Agent Teams / Codex capability. This module NEVER calls TeamCreate, Agent,
 * SendMessage, a Codex collaboration tool, or a model CLI -- it never fabricates a
 * live binding/action; `bindings`/`actions` are always empty arrays in this skeleton
 * because no live capability is ever proven here (WP3 lands the live engine: real
 * supervisor start, READY correlation, rebind, respawn, rehydration).
 *
 * This file also exports `renderPosixDirect(argv)` and `parsePosixDirect(command)`,
 * the canonical POSIX host-action renderer/parser frozen at PLAN.md ~L578, for direct
 * import by `context-provider-gate.js` (no model reimplements quoting).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

// WP3: reuse the sibling module's already-proven fd-bound durability primitives
// (no-clobber publish, fd-bound classify-read, digest helpers, git identity) for
// this file's own host-private registry, rather than a second hand-written
// reimplementation of this exact security-critical logic.
const rc = require('./runtime-consultation.cjs');
const {
  sha256Buffer, sha256String, sha256File, canonicalJSONStringify, writeAllSync,
  classifyDurableRead, publishNoClobber, gitRevParse, realpathOrSelf,
  DURABLE_ABSENT, DURABLE_PENDING, DURABLE_PRESENT,
} = rc;

// ── Closed enums (coordination/lifecycle-cli-result/v1, PLAN.md ~L152) ─────────
const STATUS_ENUM = Object.freeze([
  'READY',
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

// Canonical role registry: union of the default policy's support_plane +
// phase_scoped_roles and the default routing registry's routes keys
// (PLAN.md ~L95-97, ~L1099-1108).
const CANONICAL_ROLES = Object.freeze([
  'arch-platform',
  'arch-testing',
  'arch-integration',
  'context-provider',
  'doc-updater',
  'toolkit-specialist',
  'test-specialist',
  'verifier',
  'quality-gater',
  'planner',
]);

const POLICY_MODE_ENUM = Object.freeze(['auto', 'persistent', 'ephemeral', 'disk-only']);

const ROUTING_DRIVER_ENUM = Object.freeze([
  'claude-sendmessage',
  'claude-agent',
  'codex-app-server',
  'codex-mcp',
  'runtime-spawn',
  'noop',
]);

const ROUTING_ROLE_ENUM = Object.freeze([
  'verifier',
  'quality-gater',
  'arch-platform',
  'arch-testing',
  'arch-integration',
  'context-provider',
  'doc-updater',
  'toolkit-specialist',
  'test-specialist',
]);

// Production argv never accepts a caller-supplied session generation, binding/
// teammate/agent ID, PID, team name, policy path, registry path, bootstrap path,
// prompt, or runtime handle (PLAN.md ~L150). Checked ahead of any per-subcommand
// allowlist so the rejection is uniform and explicit regardless of subcommand.
// WP3: `--lifecycle-binding` is now a RECOGNIZED (not forbidden) flag, but ONLY
// for the mutating subcommands SUBCOMMAND_SPEC actually lists it for (ensure,
// ready, notify, rotate, stop-owned -- action-failed/wait-ready instead derive
// authorization from the already-grant-minted action_id itself, and probe/
// status are read-only) -- the caller/model still can never USE it meaningfully:
// its value must
// resolve to a real, unexpired, unconsumed grant minted from a genuine
// hook-observed identity (validateAndConsumeLifecycleCommandGrant), which this
// CLI itself has no way to fabricate. Security comes from grant validation, not
// from making the flag name unspeakable (the sibling module's own
// --requester-binding/--target-binding are the same category, hook-injected).
const FORBIDDEN_FLAGS = Object.freeze([
  '--requester-binding',
  '--target-binding',
  '--session-generation',
  '--binding-id',
  '--teammate-id',
  '--agent-id',
  '--pid',
  '--team-name',
  '--policy-path',
  '--registry-path',
  '--bootstrap-path',
  '--prompt',
  '--runtime-handle',
]);

const HEX_ACTION_RE = /^[0-9a-f]{32,}$/;

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
function makeResult(command, code, status, detailCode, bindings, actions) {
  return {
    schema: 'coordination/lifecycle-cli-result/v1',
    command: command || '',
    ok: code === 0,
    status,
    code,
    detail_code: detailCode,
    bindings: bindings || [],
    actions: actions || [],
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

/**
 * Reads and JSON.parses a file, returning `null` on any I/O or parse error rather
 * than throwing (callers treat `null` as "absent or invalid").
 * @param {string} filePath
 * @returns {object|null}
 */
function loadJSON(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

// ── Canonical POSIX host-action renderer/parser (PLAN.md ~L578) ────────────────

/**
 * Renders `argv` as the canonical POSIX-single-quoted host-action command string.
 * Rejects an empty array, empty/NUL/CR/LF-containing tokens, and non-UTF-8 input.
 * Every token becomes one single-quoted word; each embedded apostrophe becomes the
 * exact five-character sequence `'"'"'`; words join with exactly one ASCII space.
 * @param {string[]} argv
 * @returns {string}
 */
function renderPosixDirect(argv) {
  if (!Array.isArray(argv) || argv.length === 0) {
    throw new Error('renderPosixDirect: argv must be a non-empty array');
  }
  const words = argv.map((tok) => {
    if (typeof tok !== 'string' || tok.length === 0) {
      throw new Error('renderPosixDirect: every token must be a non-empty string');
    }
    if (/[\x00\r\n]/.test(tok)) {
      throw new Error('renderPosixDirect: NUL/CR/LF-containing token rejected');
    }
    if (Buffer.from(tok, 'utf8').toString('utf8') !== tok) {
      throw new Error('renderPosixDirect: non-UTF-8 token rejected');
    }
    const escaped = tok.split("'").join('\'"\'"\'');
    return `'${escaped}'`;
  });
  return words.join(' ');
}

/**
 * Parses a canonical POSIX-single-quoted command string produced only by
 * `renderPosixDirect` back into its argv array. Accepts only the closed grammar
 * (single-quoted segments plus the exact embedded-apostrophe sequence, one space
 * between words, no leading/trailing space) and succeeds only when
 * `renderPosixDirect(decoded) === command`.
 * @param {string} command
 * @returns {string[]|null} decoded argv, or null if the command is not canonical.
 */
function parsePosixDirect(command) {
  if (typeof command !== 'string' || command.length === 0) return null;
  const argv = [];
  let i = 0;
  const n = command.length;
  while (i < n) {
    if (command[i] !== "'") return null;
    i += 1;
    let word = '';
    let closed = false;
    while (i < n) {
      if (command[i] === "'") {
        if (command.slice(i, i + 5) === '\'"\'"\'') {
          word += "'";
          i += 5;
          continue;
        }
        i += 1;
        closed = true;
        break;
      }
      if (command[i] === '\x00' || command[i] === '\r' || command[i] === '\n') {
        return null;
      }
      word += command[i];
      i += 1;
    }
    if (!closed) return null;
    argv.push(word);
    if (i === n) break;
    if (command[i] !== ' ') return null;
    i += 1;
    if (i >= n) return null;
  }
  if (argv.length === 0) return null;
  let rendered;
  try {
    rendered = renderPosixDirect(argv);
  } catch (err) {
    return null;
  }
  return rendered === command ? argv : null;
}

// ── Policy schema validation (runtime-collaboration-policy/v1, PLAN.md ~L88-119) ─

const POLICY_REQUIRED_KEYS = Object.freeze([
  'schema',
  'version',
  'mode',
  'support_plane',
  'wave_scoped_roles',
  'phase_scoped_roles',
  'idle_behavior',
  'session_restart',
  'ready_timeout_seconds',
  'max_persistent_roles',
  'max_respawns_per_role',
  'routing_ref',
  'documentation_workflow',
]);

/**
 * @param {unknown[]} arr
 * @returns {boolean} true when every element is unique (Set-based comparison).
 */
function hasUniqueValues(arr) {
  return new Set(arr).size === arr.length;
}

/**
 * @param {unknown} value
 * @returns {boolean} true when `value` is a non-empty array of unique strings, each
 * a member of CANONICAL_ROLES.
 */
function isNonEmptyCanonicalRoleArray(value) {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    hasUniqueValues(value) &&
    value.every((v) => typeof v === 'string' && CANONICAL_ROLES.includes(v))
  );
}

/**
 * Validates a parsed policy object against the closed `runtime-collaboration-policy/v1`
 * schema (PLAN.md ~L88-119). Every key is required; top-level/nested additional
 * properties are rejected; role arrays are unique canonical enums; numeric bounds are
 * enforced; `routing_ref` must equal the one fixed repo-relative literal.
 * @param {unknown} obj
 * @returns {boolean}
 */
function isValidPolicy(obj) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return false;
  const keys = Object.keys(obj);
  if (keys.length !== POLICY_REQUIRED_KEYS.length) return false;
  if (!POLICY_REQUIRED_KEYS.every((k) => Object.prototype.hasOwnProperty.call(obj, k))) return false;

  if (obj.schema !== 'runtime-collaboration-policy/v1') return false;
  if (obj.version !== 1) return false;
  if (!POLICY_MODE_ENUM.includes(obj.mode)) return false;
  if (!isNonEmptyCanonicalRoleArray(obj.support_plane)) return false;
  if (typeof obj.wave_scoped_roles !== 'string' || obj.wave_scoped_roles.length === 0) return false;
  if (!isNonEmptyCanonicalRoleArray(obj.phase_scoped_roles)) return false;
  if (typeof obj.idle_behavior !== 'string' || obj.idle_behavior.length === 0) return false;
  if (typeof obj.session_restart !== 'string' || obj.session_restart.length === 0) return false;
  if (!isIntInRangeNum(obj.ready_timeout_seconds, 1, 120)) return false;
  if (!isIntInRangeNum(obj.max_persistent_roles, 1, Number.MAX_SAFE_INTEGER)) return false;
  if (!isIntInRangeNum(obj.max_respawns_per_role, 0, Number.MAX_SAFE_INTEGER)) return false;
  if (obj.routing_ref !== 'scripts/lib/runtime-routing.json') return false;

  const dw = obj.documentation_workflow;
  if (dw === null || typeof dw !== 'object' || Array.isArray(dw)) return false;
  if (Object.keys(dw).length !== 2) return false;
  if (typeof dw.pattern_gap_ingestion !== 'boolean') return false;
  if (typeof dw.user_approval_required !== 'boolean') return false;

  return true;
}

/**
 * @param {unknown} value
 * @param {number} min
 * @param {number} max
 * @returns {boolean} true when `value` is an integer Number within [min,max].
 */
function isIntInRangeNum(value, min, max) {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

// ── Routing schema validation (runtime-routing/v1, PLAN.md ~L1090-1112) ────────

/**
 * Validates a parsed routing object against the closed `runtime-routing/v1` schema:
 * envelope and `routes` both `additionalProperties:false`, every listed role required
 * exactly once, arrays non-empty/unique closed-driver enums.
 * @param {unknown} obj
 * @returns {boolean}
 */
function isValidRouting(obj) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return false;
  if (Object.keys(obj).length !== 3) return false;
  if (obj.schema !== 'runtime-routing/v1') return false;
  if (obj.version !== 1) return false;

  const routes = obj.routes;
  if (routes === null || typeof routes !== 'object' || Array.isArray(routes)) return false;
  const routeKeys = Object.keys(routes);
  if (routeKeys.length !== ROUTING_ROLE_ENUM.length) return false;
  if (!ROUTING_ROLE_ENUM.every((r) => Object.prototype.hasOwnProperty.call(routes, r))) return false;

  return routeKeys.every((role) => {
    const drivers = routes[role];
    return (
      Array.isArray(drivers) &&
      drivers.length > 0 &&
      hasUniqueValues(drivers) &&
      drivers.every((d) => typeof d === 'string' && ROUTING_DRIVER_ENUM.includes(d))
    );
  });
}

// ── Pair-atomic policy/routing resolution (PLAN.md ~L108-110) ──────────────────

/**
 * Resolves the policy/routing pair for `projectRoot` per PLAN.md's deterministic
 * pair-atomic lookup rule (~L108-110): absent project policy falls back to BOTH the
 * toolkit-owned policy and toolkit-owned routing file (siblings of this module, i.e.
 * `__dirname`); a present project policy requires its fixed sibling
 * `<project-root>/scripts/lib/runtime-routing.json` to also be present and valid, and
 * this never mixes a project policy with toolkit routing or silently falls back.
 * @param {string} projectRoot - absolute project root.
 * @returns {{ok:true,policy:object,routing:object}|{ok:false}}
 */
function resolvePolicyPair(projectRoot) {
  const projectPolicyPath = path.join(projectRoot, 'scripts', 'lib', 'runtime-collaboration-policy.json');
  const projectRoutingPath = path.join(projectRoot, 'scripts', 'lib', 'runtime-routing.json');
  const toolkitPolicyPath = path.join(__dirname, 'runtime-collaboration-policy.json');
  const toolkitRoutingPath = path.join(__dirname, 'runtime-routing.json');

  const useProjectPair = fs.existsSync(projectPolicyPath);
  const policyPath = useProjectPair ? projectPolicyPath : toolkitPolicyPath;
  const routingPath = useProjectPair ? projectRoutingPath : toolkitRoutingPath;

  const policy = loadJSON(policyPath);
  if (!isValidPolicy(policy)) return { ok: false };

  const routing = loadJSON(routingPath);
  if (!isValidRouting(routing)) return { ok: false };

  return { ok: true, policy, routing };
}

// ─────────────────────────────────────────────────────────────────────────────
// WP3: Test capability gate (mirrors runtime-consultation.cjs's own
// isTestCapability()/RUNTIME_CONSULTATION_TEST_CAPABILITY pattern exactly).
// ─────────────────────────────────────────────────────────────────────────────

function isTestCapability() {
  return (
    process.env.NODE_ENV === 'test'
    && typeof process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY === 'string'
    && process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY.length > 0
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// WP3: Identity (principal / repo / worktree / plan / role-profile)
// ─────────────────────────────────────────────────────────────────────────────

/** POSIX uid, or a hashed OS username fallback (Windows has no process.getuid). */
function computePrincipalId() {
  if (typeof process.getuid === 'function') return 'uid-' + process.getuid();
  return 'user-' + sha256String(os.userInfo().username);
}

function computeRepoId(projectRoot) {
  const commonDir = gitRevParse(projectRoot, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  return sha256String(realpathOrSelf(commonDir));
}

function computeWorktreeId(projectRoot) {
  const toplevel = gitRevParse(projectRoot, ['rev-parse', '--show-toplevel']);
  return sha256String(realpathOrSelf(toplevel));
}

/**
 * Discovers the single active wave's PLAN.md under `<projectRoot>/.planning/wave-`
 * NAME`/` and returns its raw-byte SHA-256 (byte-identical algorithm to the
 * sibling runtime-consultation.cjs's own plan_digest -- same PLAN.md, same
 * definition, one value). Mirrors write-verdict.sh's own "single wave-dir PLAN.md
 * alias" fallback: exactly one match is required; zero or multiple is ambiguous
 * (returns null -- callers fail closed, never guess).
 * @param {string} projectRoot
 * @returns {{ok:true,planPath:string,planDigest:string}|{ok:false}}
 */
function discoverPlan(projectRoot) {
  const planningDir = path.join(projectRoot, '.planning');
  let entries;
  try {
    entries = fs.readdirSync(planningDir, { withFileTypes: true });
  } catch (err) {
    return { ok: false };
  }
  const matches = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('wave-')) continue;
    const candidate = path.join(planningDir, entry.name, 'PLAN.md');
    if (fs.existsSync(candidate)) matches.push(candidate);
  }
  if (matches.length !== 1) return { ok: false };
  let planDigest;
  try {
    planDigest = sha256File(matches[0]);
  } catch (err) {
    return { ok: false };
  }
  return { ok: true, planPath: matches[0], planDigest };
}

/** Role-profile digest (WP3 lifecycle namespace -- distinct from the sibling
 * module's own `target_role_profile_digest`, which scopes a consultation
 * TARGET role, a different concept from a lifecycle role BINDING profile). */
function roleProfileDigestFor(role) {
  return sha256String('runtime-role-lifecycle/wp3-role-profile:' + role);
}

// ─────────────────────────────────────────────────────────────────────────────
// WP3: Host-private registry (gitignored, host-only). PLAN.md ~L86-119 leaves
// its exact path/schema unspecified by design ("explicitly gitignored with NO
// frozen path/schema") -- this file freezes ONE concrete, security-hardened
// layout. The base is FIXED and NEVER accepted via argv/request/environment
// (FORBIDDEN_FLAGS already blocks --registry-path unconditionally at the argv
// layer; this is the second, independent enforcement at the point of use).
// ─────────────────────────────────────────────────────────────────────────────

function registryBaseDir() {
  return path.join(os.tmpdir(), 'android-common-doc-runtime', computePrincipalId());
}

/**
 * `projectRootOrRepoId` is normally an absolute project-root path (every
 * caller-facing command with a `--project-root` flag). `ready`/`action-failed`/
 * `wait-ready` have no `--project-root` in the frozen argv (PLAN.md ~L144-145) --
 * their scope is derived from the action's own embedded `repo_id` instead of a
 * guessed CWD (see `findActionAcrossRepos`), so this also accepts the descriptor
 * shape `{repoId}` to reuse every existing `*PathFor`/registry function verbatim
 * without threading a second parameter through each of them.
 * @param {string|{repoId:string}} projectRootOrRepoId
 */
function registryRepoDir(projectRootOrRepoId) {
  const repoId = (
    projectRootOrRepoId && typeof projectRootOrRepoId === 'object' && typeof projectRootOrRepoId.repoId === 'string'
  ) ? projectRootOrRepoId.repoId : computeRepoId(projectRootOrRepoId);
  return path.join(registryBaseDir(), repoId);
}

/**
 * Creates `dirPath` (and every missing ancestor under the registry base) 0700,
 * rejecting a pre-existing symlink at the leaf BEFORE any mkdir/chmod (mirrors
 * cmdRootInit's RCR-confine-5 fix in the sibling module exactly -- mkdirSync on
 * an existing path is a no-op even through a symlink, so without this guard a
 * later chmod would silently mutate whatever real directory the symlink points
 * to). Also verifies stable owner+mode after creation.
 * @param {string} dirPath
 * @returns {{ok:true}|{ok:false,reason:string}}
 */
function ensureSecureRegistryDir(dirPath) {
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
  const isPosix = process.platform !== 'win32';
  if (isPosix) {
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

/**
 * Mutable registry record write (presence/lease/session-generation -- records
 * that legitimately need atomic REPLACE, unlike immutable one-use grants/actions
 * which use `publishNoClobber`). Writes via temp-file-in-same-dir + fsync +
 * atomic rename, mode 0600, matching the sibling module's own durability
 * discipline (`writeAllSync`, reused here) but permitting overwrite of an
 * existing record (no-clobber would be wrong for a value that must legitimately
 * refresh).
 * @param {string} targetPath
 * @param {Buffer} bytes
 * @returns {{ok:true}|{ok:false,reason:string}}
 */
function writeRegistryRecordReplace(targetPath, bytes) {
  const dir = path.dirname(targetPath);
  const dirResult = ensureSecureRegistryDir(dir);
  if (!dirResult.ok) return dirResult;
  const tempPath = path.join(dir, '.' + path.basename(targetPath) + '.' + crypto.randomBytes(8).toString('hex') + '.tmp');
  let fd;
  try {
    fd = fs.openSync(tempPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
  } catch (err) {
    return { ok: false, reason: 'temp-open-failed' };
  }
  try {
    writeAllSync(fd, bytes);
    fs.fsyncSync(fd);
  } catch (err) {
    try { fs.closeSync(fd); } catch (e) { /* already closed */ }
    try { fs.unlinkSync(tempPath); } catch (e) { /* best effort */ }
    return { ok: false, reason: 'write-failed' };
  }
  try { fs.closeSync(fd); } catch (e) { /* already closed */ }
  try {
    fs.renameSync(tempPath, targetPath);
  } catch (err) {
    try { fs.unlinkSync(tempPath); } catch (e) { /* best effort */ }
    return { ok: false, reason: 'rename-failed' };
  }
  return { ok: true };
}

/**
 * Fd-bound secure read of a registry record (immutable OR mutable -- reuses the
 * sibling module's own `classifyDurableRead`, which already proves: no-follow
 * open, regular-file, owner-confined, exact 0600 mode, and (for
 * `immutablePath:true`, the default) an unchanged path identity across the read.
 * @param {string} artifactPath
 * @param {{immutablePath?:boolean}} [opts]
 * @returns {{ok:true,obj:object}|{ok:true,absent:true}|{ok:false,reason:string}}
 */
function readRegistryRecord(artifactPath, opts) {
  let classified;
  try {
    classified = classifyDurableRead(artifactPath, Object.assign({ parse: true }, opts || {}));
  } catch (err) {
    return { ok: false, reason: (err && err.detailCode) || 'read-failed' };
  }
  if (classified.state === DURABLE_ABSENT) return { ok: true, absent: true };
  if (classified.state === DURABLE_PENDING) return { ok: false, reason: 'pending' };
  return { ok: true, obj: classified.obj };
}

/**
 * Short, bounded-retry mkdir-based exclusive lock scoped to `lockDir` (a
 * registry sub-path, never the whole registry) -- serializes the short
 * read-decide-write critical sections below (session-generation lookup-or-create,
 * role-binding state transitions) without holding a lock for the duration of any
 * I/O beyond that. No real sleep: a bounded synchronous busy-retry (registry
 * operations are pure local fs syscalls, never network/host-process latency) so
 * tests never need a real wall-clock wait to exercise contention.
 * @param {string} lockDir
 * @param {() => T} fn
 * @returns {{ok:true,value:T}|{ok:false,reason:'lock-timeout'}}
 * @template T
 */
function withRegistryLock(lockDir, fn) {
  fs.mkdirSync(path.dirname(lockDir), { recursive: true, mode: 0o700 });
  const maxAttempts = 2000;
  let acquired = false;
  for (let i = 0; i < maxAttempts; i += 1) {
    try {
      fs.mkdirSync(lockDir, { mode: 0o700 });
      acquired = true;
      break;
    } catch (err) {
      if (!err || err.code !== 'EEXIST') return { ok: false, reason: 'lock-timeout' };
      // Busy-retry: another process/call holds the lock for a registry-local,
      // sub-millisecond critical section -- spin without a real sleep.
    }
  }
  if (!acquired) return { ok: false, reason: 'lock-timeout' };
  try {
    const value = fn();
    return { ok: true, value };
  } finally {
    try { fs.rmdirSync(lockDir); } catch (err) { /* best effort */ }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// WP3: RuntimeIdentityProvider -- host-observed identity ONLY (PLAN.md ~L150:
// "core derives all of them from the validated project/policy/PLAN plus
// hook-observed runtime identity"). Real hook integration (a live
// context-provider-gate.js / Codex supervisor handle observing this) connects in
// WP4; this file's PRODUCTION path is honestly `{ok:false}` until then -- it
// NEVER derives an identity from this CLI's own process ancestry, PID, argv, or
// environment (explicit user ruling: "No fallback a process ancestry"). Tests
// inject a controlled identity via RUNTIME_ROLE_LIFECYCLE_FAKE_IDENTITY, a JSON
// string honored ONLY under the test capability -- mirrors the sibling module's
// own RUNTIME_CONSULTATION_FORCE_PLATFORM/RUNTIME_CONSULTATION_ACL_PROBE seams.
// ─────────────────────────────────────────────────────────────────────────────

const IDENTITY_PROVIDER_ENUM = Object.freeze(['claude-hook', 'codex-supervisor']);
const MAX_RUNTIME_SESSION_KEY_BYTES = 512;

/**
 * @returns {{ok:true,provider:'claude-hook'|'codex-supervisor',runtime_session_key:string}|{ok:false}}
 */
function getRuntimeIdentity() {
  if (!isTestCapability()) {
    // Production: no real hook-observed identity source is wired yet (WP4) --
    // honest CAPABILITY_UNAVAILABLE at the caller, never a fabricated identity.
    return { ok: false };
  }
  const raw = process.env.RUNTIME_ROLE_LIFECYCLE_FAKE_IDENTITY;
  if (typeof raw !== 'string' || raw.length === 0) return { ok: false };
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { ok: false };
  }
  if (
    parsed && parsed.ok === true
    && IDENTITY_PROVIDER_ENUM.includes(parsed.provider)
    && typeof parsed.runtime_session_key === 'string'
    && parsed.runtime_session_key.length > 0
    && Buffer.byteLength(parsed.runtime_session_key, 'utf8') <= MAX_RUNTIME_SESSION_KEY_BYTES
  ) {
    return { ok: true, provider: parsed.provider, runtime_session_key: parsed.runtime_session_key };
  }
  return { ok: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// WP3: SessionGenerationProvider -- atomic lookup-or-create of a CSPRNG
// `generation_id` for one `(provider, runtime_session_key)` runtime-identity
// tuple. The identity tuple is looked up via a DETERMINISTIC hash (a lookup KEY
// only, never used as the authorizing identity itself); the stored
// `generation_id` value is independently CSPRNG-random (>=128 bits), matching
// the explicit user ruling "no hash determinista usado como identidad
// autorizante". The raw `runtime_session_key` is persisted ONLY inside this
// host-private registry record -- never echoed into any coordination artifact,
// stdout envelope, evidence, or log line.
// ─────────────────────────────────────────────────────────────────────────────

const SESSION_GENERATION_TTL_SECONDS = 3600;

function sessionLookupKey(identity) {
  return sha256String('wp3-session-generation-v1:' + identity.provider + ':' + identity.runtime_session_key);
}

function sessionGenerationPathFor(projectRoot, identity) {
  return path.join(registryRepoDir(projectRoot), 'sessions', sessionLookupKey(identity) + '.json');
}

/**
 * @param {string} projectRoot
 * @param {{ok:true,provider:string,runtime_session_key:string}} identity - already RuntimeIdentityProvider-validated.
 * @returns {{ok:true,generationId:string}|{ok:false,reason:string}}
 */
function resolveSessionGeneration(projectRoot, identity) {
  const recordPath = sessionGenerationPathFor(projectRoot, identity);
  const lockDir = recordPath + '.lock';
  const result = withRegistryLock(lockDir, () => {
    const existing = readRegistryRecord(recordPath);
    const nowMs = currentClockMsForRegistry();
    if (existing.ok && !existing.absent) {
      const rec = existing.obj;
      if (
        rec && rec.schema === 'runtime/session-generation/v1'
        && rec.provider === identity.provider
        && rec.runtime_session_key === identity.runtime_session_key
        && typeof rec.generation_id === 'string'
        && typeof rec.expires_at === 'string'
        && nowMs < isoToMsForRegistry(rec.expires_at)
      ) {
        // Same LIVE tuple -> same generation_id (PLAN-required idempotency).
        return { ok: true, generationId: rec.generation_id };
      }
      // Different tuple bound to this lookup key (should be structurally
      // impossible given the key IS a hash of the tuple, but checked anyway --
      // defense in depth) or an expired record: mint a fresh generation below.
    } else if (!existing.ok) {
      return { ok: false, reason: existing.reason };
    }
    const generationId = crypto.randomBytes(16).toString('hex'); // 128 bits CSPRNG
    const record = {
      schema: 'runtime/session-generation/v1',
      provider: identity.provider,
      runtime_session_key: identity.runtime_session_key,
      generation_id: generationId,
      created_at: nowIsoForRegistry(),
      expires_at: isoPlusSecondsForRegistry(nowIsoForRegistry(), SESSION_GENERATION_TTL_SECONDS),
    };
    const writeResult = writeRegistryRecordReplace(recordPath, Buffer.from(canonicalJSONStringify(record), 'utf8'));
    if (!writeResult.ok) return { ok: false, reason: writeResult.reason };
    return { ok: true, generationId };
  });
  if (!result.ok) return { ok: false, reason: result.reason };
  return result.value;
}

// ── Small time helpers (registry-local; kept separate from the sibling
// module's own fixed-clock test seam, which is scoped to runtime-consultation.cjs's
// OWN commands, not this file's) ────────────────────────────────────────────────

function nowIsoForRegistry() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function isoToMsForRegistry(iso) {
  return Date.parse(iso);
}

function isoPlusSecondsForRegistry(iso, seconds) {
  return new Date(Date.parse(iso) + seconds * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function currentClockMsForRegistry() {
  return Date.now();
}

// ─────────────────────────────────────────────────────────────────────────────
// WP3: MainOrchestratorBinding/v1 -- created from a resolved session generation.
// `session_generation_id` is resolved internally from its own registry record and
// is NEVER added to argv (PLAN.md ~L150). `runtime_session_key` stays host-private
// (part of this host-private registry record; never copied into the STDOUT-facing
// lifecycle-cli-result/v1 envelope).
// ─────────────────────────────────────────────────────────────────────────────

function mainOrchestratorBindingPathFor(projectRoot, bindingId) {
  return path.join(registryRepoDir(projectRoot), 'orchestrator-bindings', bindingId + '.json');
}

/**
 * @param {string} projectRoot
 * @param {{ok:true,provider:string,runtime_session_key:string}} identity
 * @param {string} worktreeId
 * @param {string} planDigest
 * @param {number} ttlSeconds
 * @returns {{ok:true,binding:object}|{ok:false,reason:string}}
 */
function createMainOrchestratorBinding(projectRoot, identity, worktreeId, planDigest, ttlSeconds) {
  const genResult = resolveSessionGeneration(projectRoot, identity);
  if (!genResult.ok) return { ok: false, reason: genResult.reason };
  const bindingId = crypto.randomBytes(16).toString('hex');
  const nowStr = nowIsoForRegistry();
  const binding = {
    schema: 'runtime/main-orchestrator-binding/v1',
    binding_id: bindingId,
    runtime: identity.provider,
    runtime_session_key: identity.runtime_session_key,
    actor_instance_id: crypto.randomBytes(16).toString('hex'),
    worktree_id: worktreeId,
    plan_digest: planDigest,
    session_generation_id: genResult.generationId,
    created_at: nowStr,
    expiry: isoPlusSecondsForRegistry(nowStr, ttlSeconds),
  };
  const bindingPath = mainOrchestratorBindingPathFor(projectRoot, bindingId);
  const writeResult = writeRegistryRecordReplace(bindingPath, Buffer.from(canonicalJSONStringify(binding), 'utf8'));
  if (!writeResult.ok) return { ok: false, reason: writeResult.reason };
  return { ok: true, binding };
}

/**
 * Draft->final PLAN rebind (PLAN.md ~L167): the session generation is PRESERVED;
 * only `plan_digest` (and a fresh `binding_id`/`expiry`) change. Never mints a new
 * session_generation_id for a draft->final transition.
 * @param {string} projectRoot
 * @param {object} oldBinding - a previously-created MainOrchestratorBinding/v1.
 * @param {string} newPlanDigest
 * @param {number} ttlSeconds
 * @returns {{ok:true,binding:object}|{ok:false,reason:string}}
 */
function rebindMainOrchestratorBindingForNewPlan(projectRoot, oldBinding, newPlanDigest, ttlSeconds) {
  const bindingId = crypto.randomBytes(16).toString('hex');
  const nowStr = nowIsoForRegistry();
  const binding = {
    schema: 'runtime/main-orchestrator-binding/v1',
    binding_id: bindingId,
    runtime: oldBinding.runtime,
    runtime_session_key: oldBinding.runtime_session_key,
    actor_instance_id: oldBinding.actor_instance_id,
    worktree_id: oldBinding.worktree_id,
    plan_digest: newPlanDigest,
    session_generation_id: oldBinding.session_generation_id, // PRESERVED, never re-minted
    created_at: nowStr,
    expiry: isoPlusSecondsForRegistry(nowStr, ttlSeconds),
  };
  const bindingPath = mainOrchestratorBindingPathFor(projectRoot, bindingId);
  const writeResult = writeRegistryRecordReplace(bindingPath, Buffer.from(canonicalJSONStringify(binding), 'utf8'));
  if (!writeResult.ok) return { ok: false, reason: writeResult.reason };
  return { ok: true, binding };
}

// ─────────────────────────────────────────────────────────────────────────────
// WP3: lifecycle-command-grant/v1 -- one-use, hook-minted (real hook wiring is
// WP4; this file implements creation+validation+atomic-consumption so a fake
// hook -- a test, or eventually the real one -- can exercise the exact same
// path). The caller/model can never mint one: `--lifecycle-binding` is a
// RECOGNIZED flag only for `ensure`/`ready` (added to SUBCOMMAND_SPEC below),
// but its VALUE is meaningless unless it resolves to a real, unexpired,
// unconsumed grant record naming a real, unexpired binding -- a guessed/forged
// reference fails validation identically to a caller who never supplied the
// flag at all. Grant records are immutable/no-clobber (an attacker cannot
// overwrite one to extend its life); consumption is tracked via a SEPARATE
// no-clobber marker so a replay (reusing the same grant_id twice) collides
// EEXIST and is rejected -- the classic no-clobber-as-election idiom already
// used throughout the sibling module.
// ─────────────────────────────────────────────────────────────────────────────

const GRANT_TTL_SECONDS = 120; // bounded by the same ready_timeout_seconds ceiling as actions (PLAN.md ~L154).

function grantPathFor(projectRoot, grantId) {
  return path.join(registryRepoDir(projectRoot), 'grants', grantId + '.json');
}

function grantConsumedMarkerPathFor(projectRoot, grantId) {
  return path.join(registryRepoDir(projectRoot), 'grants', grantId + '.consumed');
}

/**
 * Mints one no-clobber lifecycle-command-grant/v1 referencing `binding` for a
 * specific closed argv digest (the EXACT subcommand+role+project-root the grant
 * authorizes -- a grant minted for one argv shape can never authorize a
 * different one, closing a confused-deputy replay-with-different-args class).
 * @param {string} projectRoot
 * @param {object} binding - a MainOrchestratorBinding/v1.
 * @param {string} argvDigest - sha256 over the canonical argv this grant authorizes.
 * @param {string} role
 * @param {string} subcommand
 * @returns {{ok:true,grantId:string}|{ok:false,reason:string}}
 */
function mintLifecycleCommandGrant(projectRoot, binding, argvDigest, role, subcommand) {
  const grantId = crypto.randomBytes(16).toString('hex');
  const nowStr = nowIsoForRegistry();
  const grant = {
    schema: 'coordination/lifecycle-command-grant/v1',
    grant_id: grantId,
    binding_id: binding.binding_id,
    session_generation_id: binding.session_generation_id,
    worktree_id: binding.worktree_id,
    plan_digest: binding.plan_digest,
    role,
    subcommand,
    argv_digest: argvDigest,
    created_at: nowStr,
    expires_at: isoPlusSecondsForRegistry(nowStr, GRANT_TTL_SECONDS),
  };
  const dir = path.dirname(grantPathFor(projectRoot, grantId));
  const dirResult = ensureSecureRegistryDir(dir);
  if (!dirResult.ok) return { ok: false, reason: dirResult.reason };
  try {
    publishNoClobber(grantPathFor(projectRoot, grantId), Buffer.from(canonicalJSONStringify(grant), 'utf8'), {});
  } catch (err) {
    return { ok: false, reason: 'grant-publish-failed' };
  }
  return { ok: true, grantId };
}

/**
 * Validates+atomically-consumes `grantId` for the given projectRoot/argv shape.
 * Every check is independent and fails closed: absent/expired/malformed grant,
 * argv-shape mismatch (wrong role/subcommand/digest -- the grant does not
 * authorize THIS call), a since-expired binding, or a replay (the grant was
 * already consumed -- the no-clobber consumed-marker already exists).
 * @param {string} projectRoot
 * @param {string} grantId
 * @param {string} argvDigest
 * @param {string} role
 * @param {string} subcommand
 * @returns {{ok:true,binding:object,generationId:string}|{ok:false,reason:string}}
 */
function validateAndConsumeLifecycleCommandGrant(projectRoot, grantId, argvDigest, role, subcommand) {
  if (!isHexActionId(grantId)) return { ok: false, reason: 'malformed-grant-id' };
  const grantRead = readRegistryRecord(grantPathFor(projectRoot, grantId));
  if (!grantRead.ok) return { ok: false, reason: grantRead.reason };
  if (grantRead.absent) return { ok: false, reason: 'grant-absent' };
  const grant = grantRead.obj;
  if (
    !grant || grant.schema !== 'coordination/lifecycle-command-grant/v1'
    || grant.role !== role || grant.subcommand !== subcommand || grant.argv_digest !== argvDigest
  ) {
    return { ok: false, reason: 'grant-shape-mismatch' };
  }
  if (currentClockMsForRegistry() >= isoToMsForRegistry(grant.expires_at)) {
    return { ok: false, reason: 'grant-expired' };
  }
  const bindingRead = readRegistryRecord(mainOrchestratorBindingPathFor(projectRoot, grant.binding_id));
  if (!bindingRead.ok) return { ok: false, reason: bindingRead.reason };
  if (bindingRead.absent) return { ok: false, reason: 'binding-absent' };
  const binding = bindingRead.obj;
  if (!binding || binding.schema !== 'runtime/main-orchestrator-binding/v1' || binding.binding_id !== grant.binding_id) {
    return { ok: false, reason: 'binding-shape-mismatch' };
  }
  if (currentClockMsForRegistry() >= isoToMsForRegistry(binding.expiry)) {
    return { ok: false, reason: 'binding-expired' };
  }
  // Atomic one-use consumption: a no-clobber marker create. EEXIST == replay.
  const dir = path.dirname(grantConsumedMarkerPathFor(projectRoot, grantId));
  const dirResult = ensureSecureRegistryDir(dir);
  if (!dirResult.ok) return { ok: false, reason: dirResult.reason };
  try {
    publishNoClobber(grantConsumedMarkerPathFor(projectRoot, grantId), Buffer.from(canonicalJSONStringify({ consumed_at: nowIsoForRegistry() }), 'utf8'), {});
  } catch (err) {
    return { ok: false, reason: 'grant-replay' };
  }
  return { ok: true, binding, generationId: binding.session_generation_id };
}

// ─────────────────────────────────────────────────────────────────────────────
// WP3: Role-binding state machine (closed graph, user-specified):
//   ABSENT -> STARTING -> READY -> WAITING -> BUSY -> WAITING
//   STARTING -> UNAVAILABLE
//   READY|WAITING|BUSY -> DEAD -> REHYDRATING -> READY
//   READY|WAITING -> ROTATING -> REHYDRATING -> READY
//   (ambiguous owner) -> QUARANTINED  [terminal for this binding -- caller selects
//     fallback (a DIFFERENT role-binding key/driver) or STOPs; never reused]
//   READY|WAITING -> STOPPING -> STOPPED  [terminal]
// A role-binding record is scoped by {worktree_id, plan_digest, profile_digest,
// session_generation_id, role} (the exact PLAN-specified binding key) -- a
// restart mints a NEW session_generation_id, which by construction addresses a
// disjoint registry path, so old-generation bindings are never read/reused by a
// fresh session (structural restart invalidation, not a scan-and-invalidate pass).
// ─────────────────────────────────────────────────────────────────────────────

const ROLE_BINDING_STATE_ENUM = Object.freeze([
  'ABSENT', 'STARTING', 'READY', 'WAITING', 'BUSY',
  'UNAVAILABLE', 'DEAD', 'REHYDRATING', 'ROTATING',
  'QUARANTINED', 'STOPPING', 'STOPPED',
]);

// Closed transition graph: fromState -> Set(toState). Absent from this table ==
// forbidden; transitionRoleBinding() below enforces it unconditionally, never
// trusting a caller-requested transition that is not explicitly listed.
const ROLE_BINDING_TRANSITIONS = Object.freeze({
  ABSENT: Object.freeze(new Set(['STARTING'])),
  STARTING: Object.freeze(new Set(['READY', 'UNAVAILABLE', 'QUARANTINED'])),
  READY: Object.freeze(new Set(['WAITING', 'DEAD', 'ROTATING', 'STOPPING'])),
  WAITING: Object.freeze(new Set(['BUSY', 'DEAD', 'ROTATING', 'STOPPING'])),
  BUSY: Object.freeze(new Set(['WAITING', 'DEAD'])),
  DEAD: Object.freeze(new Set(['REHYDRATING'])),
  REHYDRATING: Object.freeze(new Set(['READY', 'QUARANTINED'])),
  ROTATING: Object.freeze(new Set(['REHYDRATING'])),
  QUARANTINED: Object.freeze(new Set()), // terminal for this binding key
  STOPPING: Object.freeze(new Set(['STOPPED'])),
  STOPPED: Object.freeze(new Set()), // terminal
  UNAVAILABLE: Object.freeze(new Set()), // terminal for this attempt; caller retries via a fresh ensure
});

function roleBindingKeyDigest(worktreeId, planDigest, profileDigest, generationId, role) {
  return sha256String(['wp3-role-binding-v1', worktreeId, planDigest, profileDigest, generationId, role].join(':'));
}

function roleBindingPathFor(projectRoot, worktreeId, planDigest, profileDigest, generationId, role) {
  return path.join(
    registryRepoDir(projectRoot), 'role-bindings',
    roleBindingKeyDigest(worktreeId, planDigest, profileDigest, generationId, role) + '.json',
  );
}

/**
 * Reads the current role-binding record, or synthesizes the implicit ABSENT
 * state if none exists yet (ABSENT is never itself persisted -- it is the
 * natural absence of a record).
 * @returns {{ok:true,state:'ABSENT'}|{ok:true,state:string,record:object}|{ok:false,reason:string}}
 */
function readRoleBindingState(projectRoot, worktreeId, planDigest, profileDigest, generationId, role) {
  const recordPath = roleBindingPathFor(projectRoot, worktreeId, planDigest, profileDigest, generationId, role);
  const read = readRegistryRecord(recordPath);
  if (!read.ok) return { ok: false, reason: read.reason };
  if (read.absent) return { ok: true, state: 'ABSENT' };
  const rec = read.obj;
  if (!rec || rec.schema !== 'runtime/role-binding/v1' || !ROLE_BINDING_STATE_ENUM.includes(rec.state)) {
    return { ok: false, reason: 'role-binding-shape-invalid' };
  }
  return { ok: true, state: rec.state, record: rec };
}

/**
 * Enforces the closed transition graph and atomically replaces the role-binding
 * record. `fromRecord` is `null` only for the ABSENT->STARTING transition (first
 * creation); every other transition requires the CURRENT on-disk record's
 * `binding_id` to match `fromRecord.binding_id` (a stale/superseded reader can
 * never blindly overwrite a newer transition -- checked under the registry lock).
 * @returns {{ok:true,record:object}|{ok:false,reason:string}}
 */
function transitionRoleBinding(projectRoot, worktreeId, planDigest, profileDigest, generationId, role, fromState, toState, fromRecord, extraFields) {
  if (!ROLE_BINDING_TRANSITIONS[fromState] || !ROLE_BINDING_TRANSITIONS[fromState].has(toState)) {
    return { ok: false, reason: 'illegal-state-transition' };
  }
  const recordPath = roleBindingPathFor(projectRoot, worktreeId, planDigest, profileDigest, generationId, role);
  const lockDir = recordPath + '.lock';
  const result = withRegistryLock(lockDir, () => {
    const current = readRegistryRecord(recordPath);
    if (!current.ok) return { ok: false, reason: current.reason };
    if (fromState === 'ABSENT') {
      if (!current.absent) return { ok: false, reason: 'concurrent-creation' };
    } else {
      if (current.absent) return { ok: false, reason: 'binding-vanished' };
      if (!current.obj || current.obj.binding_id !== (fromRecord && fromRecord.binding_id) || current.obj.state !== fromState) {
        return { ok: false, reason: 'stale-binding-read' };
      }
    }
    const nowStr = nowIsoForRegistry();
    const nextRecord = Object.assign(
      {
        schema: 'runtime/role-binding/v1',
        binding_id: crypto.randomBytes(16).toString('hex'),
        role,
        worktree_id: worktreeId,
        plan_digest: planDigest,
        profile_digest: profileDigest,
        session_generation_id: generationId,
        created_at: (fromRecord && fromRecord.created_at) || nowStr,
      },
      fromRecord || {},
      { state: toState, updated_at: nowStr },
      extraFields || {},
    );
    // binding_id is preserved across a transition of an EXISTING record (identity
    // of the binding does not change just because its state does); only a fresh
    // ABSENT->STARTING creation mints a new one.
    if (fromRecord) nextRecord.binding_id = fromRecord.binding_id;
    const writeResult = writeRegistryRecordReplace(recordPath, Buffer.from(canonicalJSONStringify(nextRecord), 'utf8'));
    if (!writeResult.ok) return { ok: false, reason: writeResult.reason };
    return { ok: true, record: nextRecord };
  });
  if (!result.ok) return { ok: false, reason: result.reason };
  return result.value;
}

// ─────────────────────────────────────────────────────────────────────────────
// WP3: CapabilityProvider -- separate from RuntimeIdentityProvider: identity
// answers "who/what session is this", capability answers "is a specific
// connector (Claude Agent Teams / retained Codex) ACTUALLY usable right now".
// Binary existence, an environment variable, or model-authored text NEVER
// proves capability (explicit user ruling). Production (no injected fake) is
// honest: no real capability-proof source is wired yet (WP4 connects the real
// TeamCreate/Codex-supervisor observation) -- always reports every driver
// unavailable, never fabricates READY. Tests inject a deterministic manifest via
// RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES (test-capability-gated JSON: an array
// of available driver names), mirroring the RuntimeIdentityProvider fake seam.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @returns {{ok:true,availableDrivers:string[]}|{ok:false}}
 */
function getCapabilityManifest() {
  if (!isTestCapability()) {
    // Production: no real capability-proof source is wired yet (WP4) -- honest
    // "nothing proven available", never inferred from a binary/env/model text.
    return { ok: true, availableDrivers: [] };
  }
  const raw = process.env.RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES;
  if (typeof raw !== 'string' || raw.length === 0) return { ok: true, availableDrivers: [] };
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { ok: true, availableDrivers: [] };
  }
  if (!Array.isArray(parsed) || !parsed.every((d) => typeof d === 'string' && ROUTING_DRIVER_ENUM.includes(d))) {
    return { ok: true, availableDrivers: [] };
  }
  return { ok: true, availableDrivers: parsed };
}

/**
 * Selects the FIRST driver from `routing.routes[role]` (already policy-ordered,
 * most-preferred first) that the capability manifest reports available. `noop`
 * is always structurally available (it claims no live capability at all) but is
 * only selected when it is genuinely the routing table's own entry for this role
 * AND no higher-preference driver proved available -- never a silent override of
 * routing order.
 * @returns {string|null} the selected driver, or null if none of the role's
 * routed drivers is available (including noop, if routing omits it for this role).
 */
function selectDriverForRole(routing, role, capabilityManifest) {
  const allowed = routing.routes[role];
  if (!Array.isArray(allowed)) return null;
  for (const driver of allowed) {
    if (driver === 'noop' || capabilityManifest.availableDrivers.includes(driver)) return driver;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// WP3: Action registry -- immutable/no-clobber, one-use records with the exact
// common field set PLAN.md ~L154 freezes:
//   {schema,action_id,kind,runtime,repo_id,worktree_id,plan_digest,policy_digest,
//    session_generation_id,role,expires_at,payload}
// Closed `kind`/`runtime`/`payload` union per PLAN.md ~L156-163. The core NEVER
// executes these -- it only generates+persists the descriptor; a separate
// top-level action interpreter (outside this file's scope) is the one that maps
// `kind` to an actual TeamCreate/Agent/SendMessage/supervisor-control call.
// ─────────────────────────────────────────────────────────────────────────────

const ACTION_KIND_ENUM = Object.freeze([
  'team-ensure', 'role-spawn', 'role-rebind', 'role-notify', 'role-stop-owned',
  'supervisor-start', 'supervisor-stop-owned',
]);
const ACTION_RUNTIME_ENUM = Object.freeze(['claude-native', 'host-process']);
const ACTION_KIND_RUNTIME = Object.freeze({
  'team-ensure': 'claude-native',
  'role-spawn': 'claude-native',
  'role-rebind': null, // both claude-native and host-process variants exist (PLAN.md ~L158-159); caller supplies it
  'role-notify': 'claude-native',
  'role-stop-owned': 'claude-native',
  'supervisor-start': 'host-process',
  'supervisor-stop-owned': 'host-process',
});
const ACTION_TTL_SECONDS = 120; // PLAN.md ~L154: expiry bounded by ready_timeout_seconds, max 120s.

function actionPathFor(projectRoot, actionId) {
  return path.join(registryRepoDir(projectRoot), 'actions', actionId + '.json');
}

/**
 * 128-bit CSPRNG action id, generated BEFORE the action's own payload is built
 * (`supervisor-start`'s `bridge_argv` embeds `--action <this-id>`, PLAN.md
 * ~L162 -- the payload cannot reference an id `mintRoleLifecycleAction` has not
 * generated yet, so callers that self-reference must mint the id first and
 * pass it in).
 */
function generateActionId() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Mints one immutable, no-clobber `coordination/role-lifecycle-action/v1`
 * record under the caller-supplied `actionId` (see `generateActionId`).
 * `payload` must already be the exact closed shape for `kind` (callers below
 * build it) -- this function only handles the common envelope + no-clobber
 * persistence, never inspects/validates payload internals (single responsibility;
 * per-kind builders are the payload authority).
 * @returns {{ok:true,actionId:string,action:object}|{ok:false,reason:string}}
 */
function mintRoleLifecycleAction(projectRoot, actionId, kind, runtime, repoId, worktreeId, planDigest, policyDigest, generationId, role, payload) {
  if (!isHexActionId(actionId)) return { ok: false, reason: 'invalid-action-id' };
  if (!ACTION_KIND_ENUM.includes(kind)) return { ok: false, reason: 'invalid-kind' };
  if (!ACTION_RUNTIME_ENUM.includes(runtime)) return { ok: false, reason: 'invalid-runtime' };
  const nowStr = nowIsoForRegistry();
  const action = {
    schema: 'coordination/role-lifecycle-action/v1',
    action_id: actionId,
    kind,
    runtime,
    repo_id: repoId,
    worktree_id: worktreeId,
    plan_digest: planDigest,
    policy_digest: policyDigest,
    session_generation_id: generationId,
    role: role === undefined ? null : role,
    expires_at: isoPlusSecondsForRegistry(nowStr, ACTION_TTL_SECONDS),
    payload,
  };
  const dir = path.dirname(actionPathFor(projectRoot, actionId));
  const dirResult = ensureSecureRegistryDir(dir);
  if (!dirResult.ok) return { ok: false, reason: dirResult.reason };
  try {
    publishNoClobber(actionPathFor(projectRoot, actionId), Buffer.from(canonicalJSONStringify(action), 'utf8'), {});
  } catch (err) {
    return { ok: false, reason: 'action-publish-failed' };
  }
  return { ok: true, actionId, action };
}

/**
 * The STDOUT-facing action shape (envelope `actions[]` entries): a subset that
 * excludes host-private fields never meant to reach the caller (none currently
 * -- the full action record is already caller-safe per PLAN.md ~L154's own
 * "no arm contains credentials, result content, a PID, a raw agent ID/runtime
 * handle, a caller-authored prompt" rule) but kept as a distinct function so a
 * future host-private-only field never leaks by accident.
 */
function actionForEnvelope(action) {
  return {
    schema: action.schema,
    action_id: action.action_id,
    kind: action.kind,
    runtime: action.runtime,
    repo_id: action.repo_id,
    worktree_id: action.worktree_id,
    plan_digest: action.plan_digest,
    policy_digest: action.policy_digest,
    session_generation_id: action.session_generation_id,
    role: action.role,
    expires_at: action.expires_at,
    payload: action.payload,
  };
}

const ACTION_ID_DIR_RE = /^[0-9a-f]{64}$/;

/**
 * Locates a lifecycle action by id alone. `ready`/`action-failed`/`wait-ready`'s
 * frozen argv carries only `--action` (PLAN.md ~L143-145) -- no `--project-root`,
 * so the scope is derived from the action's own embedded identity rather than
 * guessed from CWD (which a bats/test subprocess's CWD would never legitimately
 * match anyway). Scans each of THIS SAME OS user's own repo-scoped registry
 * subtrees (0700, owner-confined -- not a cross-user disclosure) for the one
 * matching immutable record. A 128-bit action_id colliding across two different
 * repos is structurally near-impossible; fails closed (never silently guesses
 * one) rather than assumes.
 * @param {string} actionId
 * @returns {{ok:true,absent:true}|{ok:true,absent:false,action:object}|{ok:false,reason:string}}
 */
function findActionAcrossRepos(actionId) {
  const base = registryBaseDir();
  let repoEntries;
  try {
    repoEntries = fs.readdirSync(base, { withFileTypes: true });
  } catch (err) {
    return { ok: true, absent: true };
  }
  const matches = [];
  for (const entry of repoEntries) {
    if (!entry.isDirectory() || !ACTION_ID_DIR_RE.test(entry.name)) continue;
    const candidatePath = path.join(base, entry.name, 'actions', actionId + '.json');
    const read = readRegistryRecord(candidatePath);
    if (!read.ok) return { ok: false, reason: read.reason };
    if (!read.absent) matches.push(read.obj);
  }
  if (matches.length === 0) return { ok: true, absent: true };
  if (matches.length > 1) return { ok: false, reason: 'ambiguous-action-id' };
  const action = matches[0];
  if (!action || action.schema !== 'coordination/role-lifecycle-action/v1' || !ACTION_KIND_ENUM.includes(action.kind)) {
    return { ok: false, reason: 'action-shape-invalid' };
  }
  return { ok: true, absent: false, action };
}

// ── Per-kind action payload builders (PLAN.md ~L156-163, exact closed shapes) ──

function buildTeamEnsurePayload(teamName, description) {
  return { team_name: teamName, description };
}

function buildRoleSpawnPayload(teamName, teammateName, agentType, bootstrapArtifactRef, bootstrapMessage) {
  return { team_name: teamName, teammate_name: teammateName, agent_type: agentType, bootstrap_artifact_ref: bootstrapArtifactRef, bootstrap_message: bootstrapMessage };
}

function buildRoleRebindClaudeNativePayload(bindingId, teammateName, bootstrapArtifactRef, bootstrapMessage) {
  return { binding_id: bindingId, teammate_name: teammateName, bootstrap_artifact_ref: bootstrapArtifactRef, bootstrap_message: bootstrapMessage };
}

function buildRoleRebindHostProcessPayload(bindingId, role, bootstrapArtifactRef, bootstrapDigest) {
  return { binding_id: bindingId, role, bootstrap_artifact_ref: bootstrapArtifactRef, bootstrap_digest: bootstrapDigest };
}

function buildRoleNotifyPayload(bindingId, teammateName, artifactRef, artifactKind, message) {
  return { binding_id: bindingId, teammate_name: teammateName, artifact_ref: artifactRef, artifact_kind: artifactKind, message };
}

function buildRoleStopOwnedPayload(bindingId, teammateName, reason, message) {
  return { binding_id: bindingId, teammate_name: teammateName, reason, message };
}

function buildSupervisorStartPayload(nodePath, bridgePath, actionId, coordRoot, roles, sessionExpiry) {
  const bridgeArgv = [nodePath, bridgePath, 'session-run', '--action', actionId, '--coordination-root', coordRoot];
  for (const r of roles) bridgeArgv.push('--role', r);
  bridgeArgv.push('--session-expiry', sessionExpiry);
  return { bridge: 'codex-app-server', bridge_argv: bridgeArgv, bridge_command: renderPosixDirect(bridgeArgv) };
}

function buildSupervisorStopOwnedPayload(bindingId, role, reason) {
  return { binding_id: bindingId, role, reason };
}

// ─────────────────────────────────────────────────────────────────────────────
// WP3: FakeHostExecutor -- TEST-ONLY simulation of "the top-level action
// interpreter executed this action" (order, exact argv, one-use, expiry,
// action-failed, replay, fallback). This module NEVER executes actions itself
// (PLAN.md: "Node/shell code never fabricates Agent, TeamCreate, or SendMessage
// calls") -- FakeHostExecutor exists purely so tests can drive the READY/
// action-failed/wait-ready surface deterministically without a real host.
// ─────────────────────────────────────────────────────────────────────────────

function fakeHostExecutorExecute(projectRoot, actionId, outcome) {
  const actionRead = readRegistryRecord(actionPathFor(projectRoot, actionId));
  if (!actionRead.ok || actionRead.absent) return { ok: false, reason: 'action-absent' };
  return { ok: true, action: actionRead.obj, outcome };
}

// ── Generic argv parsing (Frozen CLI ABI -- exact production argv, PLAN.md ~L138-150) ─

/**
 * Per-subcommand argv spec: each flag maps to `{required, repeatable}`. Every flag
 * consumes exactly the next token as its value. `FORBIDDEN_FLAGS` and unrecognized
 * flags are rejected uniformly ahead of this table (PLAN.md ~L150: production argv
 * never accepts a caller-supplied session generation, binding/teammate/agent ID,
 * PID, team name, policy/registry/bootstrap path, prompt, or runtime handle).
 */
const SUBCOMMAND_SPEC = Object.freeze({
  probe: { flags: { '--project-root': { required: true, repeatable: false } } },
  ensure: {
    flags: {
      '--project-root': { required: true, repeatable: false },
      '--role': { required: true, repeatable: true },
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
    },
  },
  status: {
    flags: {
      '--project-root': { required: true, repeatable: false },
      '--role': { required: false, repeatable: false },
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

// ── probe (Frozen CLI ABI, PLAN.md ~L140) ───────────────────────────────────────

/**
 * `probe --project-root <absolute>` -- derive selected policy, host/session
 * generation, and connector capability needs; read-only.
 * @param {string[]} rawArgv
 * @returns {never}
 */
function handleProbe(rawArgv) {
  const parsed = parseSubcommandArgv(rawArgv, SUBCOMMAND_SPEC.probe);
  if (!parsed.ok) {
    usageError('probe');
    return;
  }
  const projectRoot = parsed.values['--project-root'];
  if (!path.isAbsolute(projectRoot)) {
    usageError('probe');
    return;
  }

  const pair = resolvePolicyPair(projectRoot);
  if (!pair.ok) {
    invalidError('probe', 'POLICY_INVALID');
    return;
  }

  emitAndExit(makeResult('probe', RC.OK, 'WAITING', 'NONE', [], []));
}

// ── status (Frozen CLI ABI, PLAN.md ~L146) ──────────────────────────────────────

/**
 * `status --project-root <absolute> [--role <role>]` -- return current
 * non-authoritative lifecycle diagnostics; read-only.
 * @param {string[]} rawArgv
 * @returns {never}
 */
function handleStatus(rawArgv) {
  const parsed = parseSubcommandArgv(rawArgv, SUBCOMMAND_SPEC.status);
  if (!parsed.ok) {
    usageError('status');
    return;
  }
  const projectRoot = parsed.values['--project-root'];
  if (!path.isAbsolute(projectRoot)) {
    usageError('status');
    return;
  }
  const role = parsed.values['--role'];
  if (role !== undefined && !CANONICAL_ROLES.includes(role)) {
    invalidError('status', 'NONE');
    return;
  }

  const pair = resolvePolicyPair(projectRoot);
  if (!pair.ok) {
    invalidError('status', 'POLICY_INVALID');
    return;
  }

  emitAndExit(makeResult('status', RC.OK, 'WAITING', 'NONE', [], []));
}

// ── ensure (Frozen CLI ABI, PLAN.md ~L141) ──────────────────────────────────────

/** STDOUT-safe projection of a role-binding record (never echoes registry-
 * internal-only bookkeeping beyond what the envelope needs). */
function roleBindingForEnvelope(record) {
  return {
    schema: 'runtime/role-binding-summary/v1',
    binding_id: record.binding_id,
    role: record.role,
    state: record.state,
    driver: record.driver || null,
    session_generation_id: record.session_generation_id,
  };
}

// Respawn ceiling default when a policy's own max_respawns_per_role is absent
// from this code path's reach (defensive only -- isValidPolicy already requires
// the field; this is never hit in a policy that passed validation).
function respawnBudgetExceeded(record, policy) {
  const count = typeof record.respawn_count === 'number' ? record.respawn_count : 0;
  return count >= policy.max_respawns_per_role;
}

/**
 * Quarantines a binding that needs a fresh connector but has exhausted its
 * respawn budget or has no capable driver. `DEAD` and `ROTATING` have no
 * DIRECT edge to `QUARANTINED` in the closed transition graph -- only
 * `REHYDRATING` does -- so this hops through the mandatory REHYDRATING
 * waypoint rather than widening the (already exhaustively tested) graph.
 * @returns {{ok:true,record:object}|{ok:false,reason:string}}
 */
function quarantineViaRehydrating(repoDirDescriptor, worktreeId, planDigest, profileDigest, generationId, role, fromState, fromRecord, reason) {
  const toRehydrating = transitionRoleBinding(repoDirDescriptor, worktreeId, planDigest, profileDigest, generationId, role, fromState, 'REHYDRATING', fromRecord, {});
  if (!toRehydrating.ok) return toRehydrating;
  return transitionRoleBinding(repoDirDescriptor, worktreeId, planDigest, profileDigest, generationId, role, 'REHYDRATING', 'QUARANTINED', toRehydrating.record, { reason });
}

/**
 * Shared "this role-binding needs a fresh connector" step -- used by both
 * `ensure` (ABSENT->STARTING, DEAD->REHYDRATING) and `rotate`
 * (ROTATING->REHYDRATING): selects a capability-proven driver via the pinned
 * routing table, then either transitions straight through to READY (`noop`,
 * which claims no live capability at all) or mints the matching closed action
 * and leaves the binding in the STARTING/REHYDRATING holding state with
 * `pending_action_id` recorded. `repoDirDescriptor` is either an absolute
 * project root or the `{repoId}` descriptor `registryRepoDir` also accepts.
 * @returns {{ok:true,terminal:boolean,record:object,action:object|null}|{ok:false,unavailable?:boolean}}
 */
function spawnOrRehydrate(projectRoot, pair, capabilityManifest, role, profileDigest, worktreeId, planDigest, generationId, fromState, toState, fromRecord, respawnCount) {
  const driver = selectDriverForRole(pair.routing, role, capabilityManifest);
  if (!driver) return { ok: false, unavailable: true };

  if (driver === 'noop') {
    const t1 = transitionRoleBinding(projectRoot, worktreeId, planDigest, profileDigest, generationId, role, fromState, toState, fromRecord, { driver, respawn_count: respawnCount });
    if (!t1.ok) return { ok: false };
    const t2 = transitionRoleBinding(projectRoot, worktreeId, planDigest, profileDigest, generationId, role, toState, 'READY', t1.record, {});
    if (!t2.ok) return { ok: false };
    return { ok: true, terminal: true, record: t2.record, action: null };
  }

  const policyDigest = sha256String(canonicalJSONStringify(pair.routing));
  const repoId = computeRepoId(projectRoot);
  const actionId = generateActionId();
  let mintResult;
  if (driver === 'codex-app-server') {
    // WP3 scope note: generates ONE supervisor-start PER ROLE here rather than
    // batching the full requested role set into a single action (PLAN.md
    // ~L167's "retained Codex emits AT MOST ONE supervisor-start for that
    // complete set" is NOT yet implemented -- documented, honest simplification,
    // not a silent gap; see the WP3->C handoff). Each is independently valid.
    const bridgePath = path.join(projectRoot, 'scripts', 'lib', 'runtime-bridge-codex.cjs');
    const coordRoot = path.join(projectRoot, '.planning', 'coordination');
    const payload = buildSupervisorStartPayload('node', bridgePath, actionId, coordRoot, [role], isoPlusSecondsForRegistry(nowIsoForRegistry(), ACTION_TTL_SECONDS));
    mintResult = mintRoleLifecycleAction(projectRoot, actionId, 'supervisor-start', 'host-process', repoId, worktreeId, planDigest, policyDigest, generationId, null, payload);
  } else {
    // claude-sendmessage|claude-agent: role-spawn (team-ensure ordering is a
    // documented, deferred simplification -- see the handoff).
    const payload = buildRoleSpawnPayload('wp3-support-plane', role, 'general-purpose', null, 'Execute `ready --action <id>`, read the validated bootstrap/bundle, then enter WAITING.');
    mintResult = mintRoleLifecycleAction(projectRoot, actionId, 'role-spawn', 'claude-native', repoId, worktreeId, planDigest, policyDigest, generationId, role, payload);
  }
  if (!mintResult.ok) return { ok: false };

  const t1 = transitionRoleBinding(projectRoot, worktreeId, planDigest, profileDigest, generationId, role, fromState, toState, fromRecord, { driver, respawn_count: respawnCount, pending_action_id: mintResult.actionId });
  if (!t1.ok) return { ok: false };
  return { ok: true, terminal: false, record: t1.record, action: mintResult.action };
}

/**
 * `ensure --project-root <absolute> --role <role> [--role <role>...]
 * [--lifecycle-binding <grant-ref>]` -- idempotently return healthy bindings or
 * an ordered set of host-native actions; repeated/unknown roles rejected (no
 * partial ensure). WITHOUT `--lifecycle-binding` (the normal case until WP4
 * wires a real hook), behavior is UNCHANGED from WP1: `auto|ephemeral` degrades
 * to `EPHEMERAL_AVAILABLE`, `persistent|disk-only` reports
 * `UNAVAILABLE/CAPABILITY_UNAVAILABLE` (no capability can be proven without a
 * grant). WITH a valid `--lifecycle-binding`, this drives the real
 * registry-backed state machine: per role, ABSENT/DEAD selects a
 * capability-proven driver via the pinned routing table and mints the matching
 * closed action (STARTING/REHYDRATING + ACTION_REQUIRED); STARTING re-reports
 * its already-pending action (idempotent, never a second mint); READY/WAITING/
 * BUSY report the healthy binding directly; QUARANTINED/STOPPED are terminal
 * for this exact binding key (UNAVAILABLE, never reused).
 * @param {string[]} rawArgv
 * @returns {never}
 */
function handleEnsure(rawArgv) {
  const parsed = parseSubcommandArgv(rawArgv, SUBCOMMAND_SPEC.ensure);
  if (!parsed.ok) {
    usageError('ensure');
    return;
  }
  const projectRoot = parsed.values['--project-root'];
  if (!path.isAbsolute(projectRoot)) {
    usageError('ensure');
    return;
  }
  const roles = parsed.values['--role'];
  if (!hasUniqueValues(roles) || !roles.every((r) => CANONICAL_ROLES.includes(r))) {
    invalidError('ensure', 'NONE');
    return;
  }

  const pair = resolvePolicyPair(projectRoot);
  if (!pair.ok) {
    invalidError('ensure', 'POLICY_INVALID');
    return;
  }

  const mode = pair.policy.mode;
  const lifecycleBindingRef = parsed.values['--lifecycle-binding'];

  if (lifecycleBindingRef === undefined) {
    // No grant supplied -- the normal case until WP4 wires a real hook. Behavior
    // UNCHANGED from WP1 (existing tests depend on this exact split).
    if (mode === 'persistent' || mode === 'disk-only') {
      unavailableError('ensure', 'CAPABILITY_UNAVAILABLE');
      return;
    }
    emitAndExit(makeResult('ensure', RC.OK, 'EPHEMERAL_AVAILABLE', 'NONE', [], []));
    return;
  }

  // A grant WAS supplied: attempt the real, registry-backed capability-proven
  // path. Order-independent binding scope (PLAN.md ~L748's own
  // {repo_id,profile,session_generation,canonical_role} framing) -- sorted
  // roles, never the literal repeated-flag order a caller happened to type.
  const sortedRoles = roles.slice().sort();
  const argvDigest = sha256String('ensure:' + sortedRoles.join(','));
  const roleKey = sortedRoles.join(',');

  const consumeResult = validateAndConsumeLifecycleCommandGrant(projectRoot, lifecycleBindingRef, argvDigest, roleKey, 'ensure');
  if (!consumeResult.ok) {
    // Forged/replayed/expired/wrong-shape grant: never fall back to the
    // ephemeral path (that would let a caller launder an invalid grant into a
    // "successful" response) -- reject outright.
    invalidError('ensure', 'IDENTITY_MISMATCH');
    return;
  }
  const binding = consumeResult.binding;

  const planResult = discoverPlan(projectRoot);
  if (!planResult.ok) {
    invalidError('ensure', 'POLICY_INVALID');
    return;
  }
  const currentWorktreeId = computeWorktreeId(projectRoot);
  if (binding.plan_digest !== planResult.planDigest || binding.worktree_id !== currentWorktreeId) {
    // The grant/binding was minted for a DIFFERENT plan/worktree than what
    // --project-root resolves to right now (stale binding / identity drift) --
    // reject, never silently proceed against a mismatched scope.
    invalidError('ensure', 'IDENTITY_MISMATCH');
    return;
  }

  const capabilityManifest = getCapabilityManifest();
  const collectedActions = [];
  const collectedBindings = [];
  let sawActionRequired = false;
  let sawUnavailable = false;
  let hardError = false;

  for (const role of sortedRoles) {
    const profileDigest = roleProfileDigestFor(role);
    const stateResult = readRoleBindingState(projectRoot, binding.worktree_id, binding.plan_digest, profileDigest, binding.session_generation_id, role);
    if (!stateResult.ok) {
      hardError = true;
      break;
    }

    if (stateResult.state === 'READY' || stateResult.state === 'WAITING' || stateResult.state === 'BUSY') {
      collectedBindings.push(roleBindingForEnvelope(stateResult.record));
      continue;
    }

    if (stateResult.state === 'STARTING') {
      sawActionRequired = true;
      const pendingId = stateResult.record.pending_action_id;
      if (pendingId) {
        const actionRead = readRegistryRecord(actionPathFor(projectRoot, pendingId));
        if (actionRead.ok && !actionRead.absent) collectedActions.push(actionForEnvelope(actionRead.obj));
      }
      continue;
    }

    if (stateResult.state === 'QUARANTINED' || stateResult.state === 'STOPPED' || stateResult.state === 'UNAVAILABLE' || stateResult.state === 'ROTATING' || stateResult.state === 'REHYDRATING') {
      // Terminal for this exact binding key (QUARANTINED/STOPPED/UNAVAILABLE)
      // or already mid-transition (ROTATING/REHYDRATING, driven by `rotate`/
      // respawn -- ensure never races an in-flight rotation).
      sawUnavailable = true;
      continue;
    }

    // ABSENT or DEAD: needs a fresh (or respawned) connector.
    if (stateResult.state === 'DEAD' && respawnBudgetExceeded(stateResult.record, pair.policy)) {
      const quarantine = quarantineViaRehydrating(projectRoot, binding.worktree_id, binding.plan_digest, profileDigest, binding.session_generation_id, role, 'DEAD', stateResult.record, 'respawn-budget-exceeded');
      if (!quarantine.ok) { hardError = true; break; }
      sawUnavailable = true;
      continue;
    }

    const fromState = stateResult.state; // 'ABSENT' | 'DEAD'
    const toState = fromState === 'ABSENT' ? 'STARTING' : 'REHYDRATING';
    const fromRecord = fromState === 'ABSENT' ? null : stateResult.record;
    const respawnCount = fromState === 'DEAD' ? ((stateResult.record.respawn_count || 0) + 1) : 0;

    const spawnResult = spawnOrRehydrate(projectRoot, pair, capabilityManifest, role, profileDigest, binding.worktree_id, binding.plan_digest, binding.session_generation_id, fromState, toState, fromRecord, respawnCount);
    if (!spawnResult.ok) {
      if (spawnResult.unavailable) { sawUnavailable = true; continue; }
      hardError = true;
      break;
    }
    if (spawnResult.terminal) {
      collectedBindings.push(roleBindingForEnvelope(spawnResult.record));
    } else {
      sawActionRequired = true;
      collectedActions.push(actionForEnvelope(spawnResult.action));
    }
  }

  if (hardError) {
    invalidError('ensure', 'INTERNAL_ERROR');
    return;
  }
  if (sawActionRequired) {
    emitAndExit(makeResult('ensure', RC.OK, 'ACTION_REQUIRED', 'NONE', collectedBindings, collectedActions));
    return;
  }
  if (sawUnavailable) {
    unavailableError('ensure', 'CAPABILITY_UNAVAILABLE');
    return;
  }
  emitAndExit(makeResult('ensure', RC.OK, 'READY', 'NONE', collectedBindings, []));
}

// ── notify (Frozen CLI ABI, PLAN.md ~L142) ──────────────────────────────────────

const NOTIFY_KIND_ENUM = Object.freeze(['ingestion-request', 'session-control']);

/**
 * `notify --project-root <absolute> --role <role> --artifact <canonical-coordination-artifact>
 * --kind <ingestion-request|session-control> [--lifecycle-binding <grant-ref>]` --
 * validate the already-durable artifact and return one lifecycle wake action
 * against an existing READY/WAITING/BUSY binding. Consultation uses the
 * separate `ActivationAction/v1`, never this command. Like `ensure`, this
 * mints a new closed action and therefore requires a valid grant (unlike
 * `ensure` it has no ephemeral fallback -- there is no peer to notify without
 * an existing binding).
 * @param {string[]} rawArgv
 * @returns {never}
 */
function handleNotify(rawArgv) {
  const parsed = parseSubcommandArgv(rawArgv, SUBCOMMAND_SPEC.notify);
  if (!parsed.ok) {
    usageError('notify');
    return;
  }
  const projectRoot = parsed.values['--project-root'];
  if (!path.isAbsolute(projectRoot)) {
    usageError('notify');
    return;
  }
  const kind = parsed.values['--kind'];
  if (!NOTIFY_KIND_ENUM.includes(kind)) {
    usageError('notify');
    return;
  }

  const role = parsed.values['--role'];
  if (!CANONICAL_ROLES.includes(role)) {
    invalidError('notify', 'NONE');
    return;
  }

  const artifact = parsed.values['--artifact'];
  if (!fs.existsSync(artifact)) {
    invalidError('notify', 'NONE');
    return;
  }

  const pair = resolvePolicyPair(projectRoot);
  if (!pair.ok) {
    invalidError('notify', 'POLICY_INVALID');
    return;
  }

  const lifecycleBindingRef = parsed.values['--lifecycle-binding'];
  if (lifecycleBindingRef === undefined) {
    invalidError('notify', 'IDENTITY_MISMATCH');
    return;
  }

  let artifactDigest;
  try {
    artifactDigest = sha256File(artifact);
  } catch (err) {
    invalidError('notify', 'NONE');
    return;
  }
  const argvDigest = sha256String('notify:' + role + ':' + kind + ':' + artifactDigest);
  const consumeResult = validateAndConsumeLifecycleCommandGrant(projectRoot, lifecycleBindingRef, argvDigest, role, 'notify');
  if (!consumeResult.ok) {
    invalidError('notify', 'IDENTITY_MISMATCH');
    return;
  }
  const binding = consumeResult.binding;

  const planResult = discoverPlan(projectRoot);
  if (!planResult.ok) {
    invalidError('notify', 'POLICY_INVALID');
    return;
  }
  const currentWorktreeId = computeWorktreeId(projectRoot);
  if (binding.plan_digest !== planResult.planDigest || binding.worktree_id !== currentWorktreeId) {
    invalidError('notify', 'IDENTITY_MISMATCH');
    return;
  }

  const profileDigest = roleProfileDigestFor(role);
  const stateResult = readRoleBindingState(projectRoot, binding.worktree_id, binding.plan_digest, profileDigest, binding.session_generation_id, role);
  if (!stateResult.ok) {
    invalidError('notify', 'INTERNAL_ERROR');
    return;
  }
  if (stateResult.state !== 'READY' && stateResult.state !== 'WAITING' && stateResult.state !== 'BUSY') {
    // Never fabricates a wake target for a peer that is not alive.
    unavailableError('notify', 'CAPABILITY_UNAVAILABLE');
    return;
  }

  const payload = buildRoleNotifyPayload(stateResult.record.binding_id, role, artifact, kind, 'Ingest or apply the referenced artifact, then resume WAITING.');
  const actionId = generateActionId();
  const policyDigest = sha256String(canonicalJSONStringify(pair.routing));
  const mintResult = mintRoleLifecycleAction(projectRoot, actionId, 'role-notify', 'claude-native', computeRepoId(projectRoot), binding.worktree_id, binding.plan_digest, policyDigest, binding.session_generation_id, role, payload);
  if (!mintResult.ok) {
    invalidError('notify', 'INTERNAL_ERROR');
    return;
  }

  emitAndExit(makeResult('notify', RC.OK, 'ACTION_REQUIRED', 'NONE', [], [actionForEnvelope(mintResult.action)]));
}

// ── action-failed / ready / wait-ready (Frozen CLI ABI, PLAN.md ~L143-145) ──────

const ACTION_FAILED_REASON_ENUM = Object.freeze(['capability-unavailable', 'native-tool-error', 'deadline']);
const ACTION_FAILED_REASON_TO_DETAIL = Object.freeze({
  'capability-unavailable': 'CAPABILITY_UNAVAILABLE',
  'native-tool-error': 'NATIVE_TOOL_ERROR',
  // No closed detail_code names a host-call deadline directly; ACTION_EXPIRED
  // is the closest existing enum member (PLAN.md ~L152's detail_code union is
  // closed -- this reuses it rather than inventing a new member).
  deadline: 'ACTION_EXPIRED',
});

/**
 * `action-failed --action <32+-hex> --reason <capability-unavailable|native-tool-error|deadline>`
 * -- consume one pending action as failed and make the connector eligible for
 * policy fallback. No `--project-root`/`--lifecycle-binding` in the frozen argv
 * (PLAN.md ~L143): scope is derived from the action's own embedded identity via
 * `findActionAcrossRepos`, and the 128-bit action_id itself (mintable only under
 * an already-validated grant) is the bearer of authorization for this follow-up
 * call -- never a separate fresh grant.
 * @param {string[]} rawArgv
 * @returns {never}
 */
function handleActionFailed(rawArgv) {
  const parsed = parseSubcommandArgv(rawArgv, SUBCOMMAND_SPEC['action-failed']);
  if (!parsed.ok) {
    usageError('action-failed');
    return;
  }
  const actionId = parsed.values['--action'];
  if (!isHexActionId(actionId)) {
    usageError('action-failed');
    return;
  }
  const reason = parsed.values['--reason'];
  if (!ACTION_FAILED_REASON_ENUM.includes(reason)) {
    usageError('action-failed');
    return;
  }

  const found = findActionAcrossRepos(actionId);
  if (!found.ok) {
    invalidError('action-failed', 'INTERNAL_ERROR');
    return;
  }
  if (found.absent) {
    invalidError('action-failed', 'NONE');
    return;
  }
  const action = found.action;
  if (action.role === null) {
    // team-ensure / supervisor-start: not correlatable to a single
    // role-binding in this WP3 scope (Codex supervisor lifecycle is item C --
    // see the handoff).
    invalidError('action-failed', 'NONE');
    return;
  }

  const repoDescriptor = { repoId: action.repo_id };
  const profileDigest = roleProfileDigestFor(action.role);
  const stateResult = readRoleBindingState(repoDescriptor, action.worktree_id, action.plan_digest, profileDigest, action.session_generation_id, action.role);
  if (!stateResult.ok) {
    invalidError('action-failed', 'INTERNAL_ERROR');
    return;
  }
  if (
    (stateResult.state !== 'STARTING' && stateResult.state !== 'REHYDRATING')
    || stateResult.record.pending_action_id !== actionId
  ) {
    // Not the current live pending action for this binding -- already
    // resolved, superseded, or never was; fails closed, never guesses.
    invalidError('action-failed', 'ACTION_REPLAY');
    return;
  }

  const toState = stateResult.state === 'STARTING' ? 'UNAVAILABLE' : 'QUARANTINED';
  const transition = transitionRoleBinding(repoDescriptor, action.worktree_id, action.plan_digest, profileDigest, action.session_generation_id, action.role, stateResult.state, toState, stateResult.record, { failure_reason: reason });
  if (!transition.ok) {
    invalidError('action-failed', 'AMBIGUOUS_OWNER');
    return;
  }

  unavailableError('action-failed', ACTION_FAILED_REASON_TO_DETAIL[reason]);
}

/**
 * `ready --action <32+-hex> [--lifecycle-binding <grant-ref>]` -- target-side
 * first bootstrap call; gated identity correlation may transition the pending
 * role to READY. No `--project-root` in the frozen argv (PLAN.md ~L144): scope
 * is derived from the action's own embedded identity via
 * `findActionAcrossRepos`, never a guessed CWD. Only a currently-pending
 * STARTING/REHYDRATING binding whose `pending_action_id` is EXACTLY this
 * action_id, validated against a grant whose binding matches the action's own
 * worktree/plan/session-generation, can transition to READY -- no PID, output
 * text, or action return is ever consulted (PLAN.md ~L167).
 * @param {string[]} rawArgv
 * @returns {never}
 */
function handleReady(rawArgv) {
  const parsed = parseSubcommandArgv(rawArgv, SUBCOMMAND_SPEC.ready);
  if (!parsed.ok) {
    usageError('ready');
    return;
  }
  const actionId = parsed.values['--action'];
  if (!isHexActionId(actionId)) {
    usageError('ready');
    return;
  }

  const found = findActionAcrossRepos(actionId);
  if (!found.ok) {
    invalidError('ready', 'INTERNAL_ERROR');
    return;
  }
  if (found.absent) {
    invalidError('ready', 'NONE');
    return;
  }
  const action = found.action;
  if (action.role === null || (action.kind !== 'role-spawn' && action.kind !== 'role-rebind')) {
    // team-ensure/supervisor-start/role-notify/role-stop-owned/*-stop-owned
    // never create a pending-READY expectation a peer's first call resolves;
    // Codex's own READY correlation is item C (see the handoff).
    invalidError('ready', 'NONE');
    return;
  }

  const lifecycleBindingRef = parsed.values['--lifecycle-binding'];
  if (lifecycleBindingRef === undefined) {
    invalidError('ready', 'IDENTITY_MISMATCH');
    return;
  }

  const repoDescriptor = { repoId: action.repo_id };
  const argvDigest = sha256String('ready:' + actionId);
  const consumeResult = validateAndConsumeLifecycleCommandGrant(repoDescriptor, lifecycleBindingRef, argvDigest, action.role, 'ready');
  if (!consumeResult.ok) {
    invalidError('ready', 'IDENTITY_MISMATCH');
    return;
  }
  const binding = consumeResult.binding;
  if (
    binding.worktree_id !== action.worktree_id
    || binding.plan_digest !== action.plan_digest
    || binding.session_generation_id !== action.session_generation_id
  ) {
    // The grant's own binding was minted for a DIFFERENT scope than this
    // action (stale binding / identity drift) -- reject, never proceed.
    invalidError('ready', 'IDENTITY_MISMATCH');
    return;
  }

  const profileDigest = roleProfileDigestFor(action.role);
  const stateResult = readRoleBindingState(repoDescriptor, action.worktree_id, action.plan_digest, profileDigest, action.session_generation_id, action.role);
  if (!stateResult.ok) {
    invalidError('ready', 'INTERNAL_ERROR');
    return;
  }
  if (
    (stateResult.state !== 'STARTING' && stateResult.state !== 'REHYDRATING')
    || stateResult.record.pending_action_id !== actionId
  ) {
    invalidError('ready', 'ACTION_REPLAY');
    return;
  }

  if (currentClockMsForRegistry() >= isoToMsForRegistry(action.expires_at)) {
    const expireState = stateResult.state === 'STARTING' ? 'UNAVAILABLE' : 'QUARANTINED';
    transitionRoleBinding(repoDescriptor, action.worktree_id, action.plan_digest, profileDigest, action.session_generation_id, action.role, stateResult.state, expireState, stateResult.record, { failure_reason: 'expired' });
    invalidError('ready', 'ACTION_EXPIRED');
    return;
  }

  const readyTransition = transitionRoleBinding(repoDescriptor, action.worktree_id, action.plan_digest, profileDigest, action.session_generation_id, action.role, stateResult.state, 'READY', stateResult.record, {});
  if (!readyTransition.ok) {
    // A concurrent caller already claimed this exact pending action.
    invalidError('ready', 'AMBIGUOUS_OWNER');
    return;
  }

  emitAndExit(makeResult('ready', RC.OK, 'READY', 'NONE', [roleBindingForEnvelope(readyTransition.record)], []));
}

/**
 * `wait-ready --action <32+-hex> --timeout <1..120>` -- bounded read-only wait
 * for observed start plus gated READY; tool success/message text alone never
 * satisfies it. WP3 performs one synchronous registry state check per call
 * (matching the pre-existing WP1 "never sleeps for the requested timeout
 * window" contract this file's own bats suite already pins) rather than an
 * internal timed poll loop -- nothing observes host/peer progress between
 * calls yet in this sandbox; a caller retries externally. See the handoff.
 * @param {string[]} rawArgv
 * @returns {never}
 */
function handleWaitReady(rawArgv) {
  const parsed = parseSubcommandArgv(rawArgv, SUBCOMMAND_SPEC['wait-ready']);
  if (!parsed.ok) {
    usageError('wait-ready');
    return;
  }
  const actionId = parsed.values['--action'];
  if (!isHexActionId(actionId)) {
    usageError('wait-ready');
    return;
  }
  const timeout = parsed.values['--timeout'];
  if (!isIntInRange(timeout, 1, 120)) {
    usageError('wait-ready');
    return;
  }

  const found = findActionAcrossRepos(actionId);
  if (!found.ok || found.absent || found.action.role === null) {
    emitAndExit(makeResult('wait-ready', RC.WAIT_TIMEOUT, 'WAITING', 'READY_TIMEOUT', [], []));
    return;
  }
  const action = found.action;

  const repoDescriptor = { repoId: action.repo_id };
  const profileDigest = roleProfileDigestFor(action.role);
  const stateResult = readRoleBindingState(repoDescriptor, action.worktree_id, action.plan_digest, profileDigest, action.session_generation_id, action.role);
  if (!stateResult.ok) {
    emitAndExit(makeResult('wait-ready', RC.WAIT_TIMEOUT, 'WAITING', 'READY_TIMEOUT', [], []));
    return;
  }

  if (stateResult.state === 'READY') {
    emitAndExit(makeResult('wait-ready', RC.OK, 'READY', 'NONE', [roleBindingForEnvelope(stateResult.record)], []));
    return;
  }

  const stillPending = (stateResult.state === 'STARTING' || stateResult.state === 'REHYDRATING')
    && stateResult.record.pending_action_id === actionId
    && currentClockMsForRegistry() < isoToMsForRegistry(action.expires_at);
  if (stillPending) {
    emitAndExit(makeResult('wait-ready', RC.OK, 'WAITING', 'NONE', [], []));
    return;
  }

  emitAndExit(makeResult('wait-ready', RC.WAIT_TIMEOUT, 'WAITING', 'READY_TIMEOUT', [], []));
}

// ── rotate (Frozen CLI ABI, PLAN.md ~L147) ──────────────────────────────────────

/**
 * `rotate --project-root <absolute> --role <role> [--lifecycle-binding <grant-ref>]`
 * -- invalidate one owned binding and return the next policy-permitted action.
 * Only a currently READY/WAITING (owned+healthy) binding can be rotated; ABSENT
 * (no owned binding -- LRL-rotate-3's exact case)/BUSY/already-transitioning/
 * terminal states fail closed rather than fabricating a respawn. Reuses the
 * same `spawnOrRehydrate` driver-selection/action-mint step `ensure`'s own
 * DEAD->REHYDRATING path uses, bounded by the same `max_respawns_per_role`.
 * @param {string[]} rawArgv
 * @returns {never}
 */
function handleRotate(rawArgv) {
  const parsed = parseSubcommandArgv(rawArgv, SUBCOMMAND_SPEC.rotate);
  if (!parsed.ok) {
    usageError('rotate');
    return;
  }
  const projectRoot = parsed.values['--project-root'];
  if (!path.isAbsolute(projectRoot)) {
    usageError('rotate');
    return;
  }
  const role = parsed.values['--role'];
  if (!CANONICAL_ROLES.includes(role)) {
    invalidError('rotate', 'NONE');
    return;
  }

  const pair = resolvePolicyPair(projectRoot);
  if (!pair.ok) {
    invalidError('rotate', 'POLICY_INVALID');
    return;
  }

  const lifecycleBindingRef = parsed.values['--lifecycle-binding'];
  if (lifecycleBindingRef === undefined) {
    invalidError('rotate', 'IDENTITY_MISMATCH');
    return;
  }

  const argvDigest = sha256String('rotate:' + role);
  const consumeResult = validateAndConsumeLifecycleCommandGrant(projectRoot, lifecycleBindingRef, argvDigest, role, 'rotate');
  if (!consumeResult.ok) {
    invalidError('rotate', 'IDENTITY_MISMATCH');
    return;
  }
  const binding = consumeResult.binding;

  const planResult = discoverPlan(projectRoot);
  if (!planResult.ok) {
    invalidError('rotate', 'POLICY_INVALID');
    return;
  }
  const currentWorktreeId = computeWorktreeId(projectRoot);
  if (binding.plan_digest !== planResult.planDigest || binding.worktree_id !== currentWorktreeId) {
    invalidError('rotate', 'IDENTITY_MISMATCH');
    return;
  }

  const profileDigest = roleProfileDigestFor(role);
  const stateResult = readRoleBindingState(projectRoot, binding.worktree_id, binding.plan_digest, profileDigest, binding.session_generation_id, role);
  if (!stateResult.ok) {
    invalidError('rotate', 'INTERNAL_ERROR');
    return;
  }
  if (stateResult.state !== 'READY' && stateResult.state !== 'WAITING') {
    unavailableError('rotate', 'CAPABILITY_UNAVAILABLE');
    return;
  }

  const toRotating = transitionRoleBinding(projectRoot, binding.worktree_id, binding.plan_digest, profileDigest, binding.session_generation_id, role, stateResult.state, 'ROTATING', stateResult.record, {});
  if (!toRotating.ok) {
    invalidError('rotate', 'AMBIGUOUS_OWNER');
    return;
  }

  if (respawnBudgetExceeded(toRotating.record, pair.policy)) {
    quarantineViaRehydrating(projectRoot, binding.worktree_id, binding.plan_digest, profileDigest, binding.session_generation_id, role, 'ROTATING', toRotating.record, 'respawn-budget-exceeded');
    unavailableError('rotate', 'CAPABILITY_UNAVAILABLE');
    return;
  }

  const capabilityManifest = getCapabilityManifest();
  const respawnCount = (toRotating.record.respawn_count || 0) + 1;
  const spawnResult = spawnOrRehydrate(projectRoot, pair, capabilityManifest, role, profileDigest, binding.worktree_id, binding.plan_digest, binding.session_generation_id, 'ROTATING', 'REHYDRATING', toRotating.record, respawnCount);
  if (!spawnResult.ok) {
    if (spawnResult.unavailable) {
      quarantineViaRehydrating(projectRoot, binding.worktree_id, binding.plan_digest, profileDigest, binding.session_generation_id, role, 'ROTATING', toRotating.record, 'no-capable-driver');
      unavailableError('rotate', 'CAPABILITY_UNAVAILABLE');
      return;
    }
    invalidError('rotate', 'INTERNAL_ERROR');
    return;
  }

  if (spawnResult.terminal) {
    emitAndExit(makeResult('rotate', RC.OK, 'READY', 'NONE', [roleBindingForEnvelope(spawnResult.record)], []));
    return;
  }
  emitAndExit(makeResult('rotate', RC.OK, 'ACTION_REQUIRED', 'NONE', [], [actionForEnvelope(spawnResult.action)]));
}

// ── stop-owned (Frozen CLI ABI, PLAN.md ~L148) ──────────────────────────────────

const STOP_OWNED_REASON_ENUM = Object.freeze(['rotation', 'session-close', 'operator']);

/**
 * `stop-owned --project-root <absolute> --role <role> --reason <rotation|session-close|operator>
 * [--lifecycle-binding <grant-ref>]` -- return a stop action only for a binding
 * created/owned by the current session generation (grant-bound, exactly like
 * `rotate`); an unowned/absent/already-terminal binding fails closed
 * (LRL-stopowned-3's exact case) rather than addressing an ambiguous peer.
 * @param {string[]} rawArgv
 * @returns {never}
 */
function handleStopOwned(rawArgv) {
  const parsed = parseSubcommandArgv(rawArgv, SUBCOMMAND_SPEC['stop-owned']);
  if (!parsed.ok) {
    usageError('stop-owned');
    return;
  }
  const projectRoot = parsed.values['--project-root'];
  if (!path.isAbsolute(projectRoot)) {
    usageError('stop-owned');
    return;
  }
  const reason = parsed.values['--reason'];
  if (!STOP_OWNED_REASON_ENUM.includes(reason)) {
    usageError('stop-owned');
    return;
  }
  const role = parsed.values['--role'];
  if (!CANONICAL_ROLES.includes(role)) {
    invalidError('stop-owned', 'NONE');
    return;
  }

  const pair = resolvePolicyPair(projectRoot);
  if (!pair.ok) {
    invalidError('stop-owned', 'POLICY_INVALID');
    return;
  }

  const lifecycleBindingRef = parsed.values['--lifecycle-binding'];
  if (lifecycleBindingRef === undefined) {
    invalidError('stop-owned', 'IDENTITY_MISMATCH');
    return;
  }

  const argvDigest = sha256String('stop-owned:' + role + ':' + reason);
  const consumeResult = validateAndConsumeLifecycleCommandGrant(projectRoot, lifecycleBindingRef, argvDigest, role, 'stop-owned');
  if (!consumeResult.ok) {
    invalidError('stop-owned', 'IDENTITY_MISMATCH');
    return;
  }
  const binding = consumeResult.binding;

  const planResult = discoverPlan(projectRoot);
  if (!planResult.ok) {
    invalidError('stop-owned', 'POLICY_INVALID');
    return;
  }
  const currentWorktreeId = computeWorktreeId(projectRoot);
  if (binding.plan_digest !== planResult.planDigest || binding.worktree_id !== currentWorktreeId) {
    invalidError('stop-owned', 'IDENTITY_MISMATCH');
    return;
  }

  const profileDigest = roleProfileDigestFor(role);
  const stateResult = readRoleBindingState(projectRoot, binding.worktree_id, binding.plan_digest, profileDigest, binding.session_generation_id, role);
  if (!stateResult.ok) {
    invalidError('stop-owned', 'INTERNAL_ERROR');
    return;
  }
  if (stateResult.state !== 'READY' && stateResult.state !== 'WAITING') {
    // ABSENT (no owned binding)/BUSY/already-terminal: never addresses an
    // unowned or ambiguous peer.
    unavailableError('stop-owned', 'CAPABILITY_UNAVAILABLE');
    return;
  }

  const toStopping = transitionRoleBinding(projectRoot, binding.worktree_id, binding.plan_digest, profileDigest, binding.session_generation_id, role, stateResult.state, 'STOPPING', stateResult.record, { stop_reason: reason });
  if (!toStopping.ok) {
    invalidError('stop-owned', 'AMBIGUOUS_OWNER');
    return;
  }

  const driver = toStopping.record.driver;
  const isCodex = driver === 'codex-app-server';
  const payload = isCodex
    ? buildSupervisorStopOwnedPayload(toStopping.record.binding_id, role, reason)
    : buildRoleStopOwnedPayload(toStopping.record.binding_id, role, reason, 'Stop your owned role binding and exit cleanly.');
  const actionId = generateActionId();
  const policyDigest = sha256String(canonicalJSONStringify(pair.routing));
  const mintResult = mintRoleLifecycleAction(projectRoot, actionId, isCodex ? 'supervisor-stop-owned' : 'role-stop-owned', isCodex ? 'host-process' : 'claude-native', computeRepoId(projectRoot), binding.worktree_id, binding.plan_digest, policyDigest, binding.session_generation_id, role, payload);
  if (!mintResult.ok) {
    invalidError('stop-owned', 'INTERNAL_ERROR');
    return;
  }

  const toStopped = transitionRoleBinding(projectRoot, binding.worktree_id, binding.plan_digest, profileDigest, binding.session_generation_id, role, 'STOPPING', 'STOPPED', toStopping.record, {});
  if (!toStopped.ok) {
    invalidError('stop-owned', 'INTERNAL_ERROR');
    return;
  }

  emitAndExit(makeResult('stop-owned', RC.OK, 'STOPPED', 'NONE', [], [actionForEnvelope(mintResult.action)]));
}

// ── CLI entry point ──────────────────────────────────────────────────────────────

const HANDLERS = Object.freeze({
  probe: handleProbe,
  ensure: handleEnsure,
  notify: handleNotify,
  'action-failed': handleActionFailed,
  ready: handleReady,
  'wait-ready': handleWaitReady,
  status: handleStatus,
  rotate: handleRotate,
  'stop-owned': handleStopOwned,
});

/**
 * CLI entry point. Never throws: any unexpected internal error is caught and
 * reported as one valid rc7 envelope rather than an uncaught-exception stack trace,
 * so stdout is always exactly one closed-shape JSON line.
 * @param {string[]} argv - `process.argv.slice(2)`.
 * @returns {never}
 */
function main(argv) {
  try {
    const subcommand = argv[0];
    const handler = HANDLERS[subcommand];
    if (!handler) {
      usageError('');
      return;
    }
    handler(argv.slice(1));
  } catch (err) {
    const knownCommand = typeof argv[0] === 'string' && HANDLERS[argv[0]] ? argv[0] : '';
    emitAndExit(makeResult(knownCommand, RC.INTERNAL, 'INVALID', 'INTERNAL_ERROR', [], []));
  }
}

module.exports = {
  renderPosixDirect,
  parsePosixDirect,
  makeResult,
  resolvePolicyPair,
  isValidPolicy,
  isValidRouting,
  CANONICAL_ROLES,
  STATUS_ENUM,
  DETAIL_ENUM,
  // WP3 registry/identity/session/binding/grant internals -- exported for direct
  // node:test coverage of the security-critical logic (bats drives the CLI
  // envelope surface; these unit-level tests drive the internals directly).
  computePrincipalId,
  computeRepoId,
  computeWorktreeId,
  discoverPlan,
  roleProfileDigestFor,
  registryBaseDir,
  registryRepoDir,
  ensureSecureRegistryDir,
  writeRegistryRecordReplace,
  publishNoClobber,
  readRegistryRecord,
  withRegistryLock,
  getRuntimeIdentity,
  resolveSessionGeneration,
  sessionGenerationPathFor,
  createMainOrchestratorBinding,
  rebindMainOrchestratorBindingForNewPlan,
  mainOrchestratorBindingPathFor,
  mintLifecycleCommandGrant,
  validateAndConsumeLifecycleCommandGrant,
  grantPathFor,
  // WP3 state machine / capability / action generation internals.
  ROLE_BINDING_STATE_ENUM,
  ROLE_BINDING_TRANSITIONS,
  roleBindingPathFor,
  readRoleBindingState,
  transitionRoleBinding,
  getCapabilityManifest,
  selectDriverForRole,
  ACTION_KIND_ENUM,
  generateActionId,
  mintRoleLifecycleAction,
  actionForEnvelope,
  actionPathFor,
  findActionAcrossRepos,
  spawnOrRehydrate,
  buildTeamEnsurePayload,
  buildRoleSpawnPayload,
  buildRoleRebindClaudeNativePayload,
  buildRoleRebindHostProcessPayload,
  buildRoleNotifyPayload,
  buildRoleStopOwnedPayload,
  buildSupervisorStartPayload,
  buildSupervisorStopOwnedPayload,
  fakeHostExecutorExecute,
};

if (require.main === module) {
  main(process.argv.slice(2));
}
