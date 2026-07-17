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
 * Resolves the DEEPEST EXISTING ANCESTOR of `fullPath` via a real
 * `fs.realpathSync` (following every symlink up to and including that
 * ancestor), then re-joins whatever trailing segments do not exist yet
 * UNRESOLVED. Point 2.1 (R4), round 2: a single `realpathOrSelf` on only
 * the git worktree toplevel was stable against an external alias of the
 * ENTIRE projectRoot prefix (e.g. macOS's `/tmp` -> `/private/tmp`), but
 * NOT against an INTERNAL symlink at any deeper, project-owned ancestor --
 * e.g. `.planning` itself resolving to some other real sibling directory.
 * Reproduced: `.planning` a valid symlink, `coordination_root_id` computed
 * once before `coordination/` exists (falls back to the raw, `.planning`
 * still-unresolved path since the FULL path doesn't exist yet) and once
 * after (the full path NOW exists, so `fs.realpathSync` resolves EVERY
 * component including `.planning`'s symlink) produced two DIFFERENT
 * hashes for the SAME logical root. Resolving the deepest EXISTING
 * ancestor at every call, whatever depth that happens to be, converges to
 * the SAME answer once the full path exists (a plain multi-segment
 * `fs.realpathSync` resolves every intermediate symlink identically to
 * this function resolving them one ancestor at a time), and never regresses
 * once an ancestor starts existing (each existing ancestor's OWN identity
 * is assumed stable for the life of a session -- nothing in this codebase
 * renames/re-symlinks `.planning` or the worktree toplevel mid-session).
 * Structurally cannot exhaust to the filesystem root in practice: the git
 * worktree toplevel is the outermost caller-relevant ancestor and always
 * exists (git itself requires it).
 */
function deepestExistingAncestorRealpath(fullPath) {
  const trailing = [];
  let current = fullPath;
  for (;;) {
    try {
      const real = fs.realpathSync(current);
      return trailing.length === 0 ? real : path.join(real, ...trailing);
    } catch (err) {
      const parent = path.dirname(current);
      if (parent === current) return fullPath; // filesystem root reached -- fail safe, never throw.
      trailing.unshift(path.basename(current));
      current = parent;
    }
  }
}

/**
 * The one fixed, deterministic, STABLE coordination-root path for
 * `projectRoot` -- never caller-suppliable at this layer (PLAN.md ~L536).
 * See `deepestExistingAncestorRealpath` for the exact stability argument
 * (point 2.1, R4 round 2): stable IDENTICALLY before and after root-init,
 * AND before and after any project-internal ancestor (e.g. `.planning`)
 * turning out to be a symlink, not merely an external alias of the whole
 * `projectRoot` prefix.
 */
function coordinationRootPathFor(projectRoot) {
  const toplevel = gitRevParse(projectRoot, ['rev-parse', '--show-toplevel']);
  return deepestExistingAncestorRealpath(path.join(toplevel, '.planning', 'coordination'));
}

/**
 * `coordination_root_id` (PLAN.md ~L289: `sha256(realpath(coordination_root))`,
 * never a raw path). `realpathOrSelf` here is now a defensive, effectively
 * idempotent second pass over an ALREADY-stable path (see
 * `coordinationRootPathFor`) -- retained so a caller supplying some OTHER,
 * not-yet-fully-resolved path still gets a best-effort stable hash.
 */
function computeCoordinationRootIdFromPath(coordRootPath) {
  return sha256String(realpathOrSelf(coordRootPath));
}

function computeCoordinationRootId(projectRoot) {
  return computeCoordinationRootIdFromPath(coordinationRootPathFor(projectRoot));
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
/**
 * @param {string} lockDir
 * @param {function} fn
 * @param {{maxWaitMs?:number}} [opts] - opt-in only. Omitted/absent for every
 *   pre-existing caller, which keeps their EXACT prior behavior: a ~2000-
 *   attempt busy-spin with no real sleep, sized for a registry-local,
 *   sub-millisecond critical section (a single read+write). A caller whose
 *   critical section is legitimately larger -- e.g.
 *   mintSupervisorBatchUnderTransaction's multi-write, fsync-durable
 *   transaction, empirically ~85ms even uncontended -- passes maxWaitMs to
 *   fall back to a bounded real-sleep retry loop once the busy-spin budget
 *   is exhausted, rather than spuriously failing on ordinary contention.
 */
function withRegistryLock(lockDir, fn, opts) {
  fs.mkdirSync(path.dirname(lockDir), { recursive: true, mode: 0o700 });
  const maxAttempts = 2000;
  const maxWaitMs = (opts && Number.isFinite(opts.maxWaitMs) && opts.maxWaitMs > 0) ? opts.maxWaitMs : 0;
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
  if (!acquired && maxWaitMs > 0) {
    const deadlineMs = currentClockMsForRegistry() + maxWaitMs;
    while (currentClockMsForRegistry() < deadlineMs) {
      try {
        fs.mkdirSync(lockDir, { mode: 0o700 });
        acquired = true;
        break;
      } catch (err) {
        if (!err || err.code !== 'EEXIST') return { ok: false, reason: 'lock-timeout' };
        try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5); } catch (e) { /* best effort */ }
      }
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

const CANONICAL_ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

/**
 * R4 round 3 (block 2c): a regex-shape match plus `Date.parse` alone is not
 * sufficient -- `Date.parse`/`new Date(...)` SILENTLY NORMALIZE an
 * impossible calendar date (e.g. `2026-02-30T00:00:00Z`, February never has
 * a 30th) into a real one (2026-03-02T00:00:00Z here) and still return a
 * finite timestamp, so the old regex+Date.parse check WRONGLY accepted it.
 * A genuine round-trip -- format the parsed timestamp back into this SAME
 * canonical (no-milliseconds) form and compare byte-for-byte against the
 * original -- only ever matches a string that was ALREADY an exact,
 * canonical representation of a real UTC instant; any silent normalization
 * changes at least one digit and the comparison fails.
 */
function isCanonicalIsoUtc(value) {
  if (typeof value !== 'string' || !CANONICAL_ISO_UTC_RE.test(value)) return false;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return false;
  const roundTripped = new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
  return roundTripped === value;
}

/**
 * WP3 item C correction pass R3 (point A.4): a PURE lookup, never a mint --
 * used everywhere a validation/derivation needs "what generation IS this
 * tuple CURRENTLY bound to", as opposed to `createMainOrchestratorBinding`'s
 * own genuine creation-time "ensure one exists" (`resolveSessionGeneration`
 * below, kept mint-capable ONLY for that one creation call site). A
 * validation must never create or rotate state as an unwitting side effect.
 * Requires canonical ISO-8601 UTC (`isCanonicalIsoUtc` -- exactly
 * `YYYY-MM-DDTHH:MM:SSZ`, no milliseconds, no non-Z offset) on the stored
 * `expires_at`, never merely whatever `Date.parse` happens to accept.
 * @param {string} projectRoot
 * @param {{provider:string,runtime_session_key:string}} identity
 * @returns {{ok:true,generationId:string}|{ok:false,reason:string}}
 */
function peekSessionGeneration(projectRoot, identity) {
  const recordPath = sessionGenerationPathFor(projectRoot, identity);
  const existing = readRegistryRecord(recordPath);
  if (!existing.ok) return { ok: false, reason: existing.reason };
  if (existing.absent) return { ok: false, reason: 'session-generation-absent' };
  const rec = existing.obj;
  if (
    !rec || rec.schema !== 'runtime/session-generation/v1'
    || rec.provider !== identity.provider || rec.runtime_session_key !== identity.runtime_session_key
    || typeof rec.generation_id !== 'string' || rec.generation_id.length === 0
    || !isCanonicalIsoUtc(rec.expires_at) || !isCanonicalIsoUtc(rec.created_at)
  ) {
    return { ok: false, reason: 'session-generation-shape-invalid' };
  }
  if (currentClockMsForRegistry() >= Date.parse(rec.expires_at)) return { ok: false, reason: 'session-generation-expired' };
  return { ok: true, generationId: rec.generation_id };
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
// PLAN.md ~L574 freezes the persisted shape as EXACTLY nine fields; it has no
// `session_generation_id` member. That value is fully derivable from the two
// frozen fields `runtime`+`runtime_session_key` (the same tuple
// `resolveSessionGeneration` keys on), so it is NEVER stored on this record --
// neither on disk nor on the in-memory object returned to callers. Any caller
// that needs it re-derives via `resolveSessionGeneration(scope,
// {provider:binding.runtime, runtime_session_key:binding.runtime_session_key})`,
// which also means a since-expired/rotated session tuple is caught fresh at
// validation time rather than compared against a stale snapshot.
// `session_generation_id` is never added to argv (PLAN.md ~L150).
// `runtime_session_key` stays host-private (part of this host-private registry
// record; never copied into the STDOUT-facing lifecycle-cli-result/v1 envelope).
// ─────────────────────────────────────────────────────────────────────────────

const MAIN_BINDING_KEYS = Object.freeze([
  'actor_instance_id', 'binding_id', 'created_at', 'expiry', 'plan_digest',
  'runtime', 'runtime_session_key', 'schema', 'worktree_id',
]);

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
  // Ensures a live session generation exists for this identity tuple (the
  // binding's lifecycle is meaningless without one) -- but per PLAN.md ~L574
  // the generation id itself is never stored on the binding; see the section
  // header comment above.
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
    runtime_session_key: oldBinding.runtime_session_key, // PRESERVED tuple -> re-derives to the SAME generation, never re-minted
    actor_instance_id: oldBinding.actor_instance_id,
    worktree_id: oldBinding.worktree_id,
    plan_digest: newPlanDigest,
    created_at: nowStr,
    expiry: isoPlusSecondsForRegistry(nowStr, ttlSeconds),
  };
  const bindingPath = mainOrchestratorBindingPathFor(projectRoot, bindingId);
  const writeResult = writeRegistryRecordReplace(bindingPath, Buffer.from(canonicalJSONStringify(binding), 'utf8'));
  if (!writeResult.ok) return { ok: false, reason: writeResult.reason };
  return { ok: true, binding };
}

// ─────────────────────────────────────────────────────────────────────────────
// R4 round 3 (block 1a): RoleActorBinding/v1 -- a SEPARATE, WP3-scoped
// registry primitive for role-actor grant identity, structurally parallel
// to MainOrchestratorBinding/v1 above but genuinely distinct: schema, path,
// create, and validate all live independently here, and a role-actor
// grant's identity is NEVER resolved through MainOrchestratorBinding (the
// masquerade PLAN.md ~L574 forbids -- "a MainOrchestratorBinding is not a
// RequesterIdentityProvider peer binding, has no canonical role, ... cannot
// be registered as a target"). Unlike MainOrchestratorBinding (whose
// `runtime`+`runtime_session_key` tuple lets `session_generation_id` be
// re-derived rather than stored), a role-actor has no hook-observed runtime
// identity tuple in this wave -- WP4's real issuer
// (`runtime-consultation-target-gate.js`) will define that. So
// `session_generation_id` is stored DIRECTLY here (the honest, minimal
// WP3-only shape) and compared as-is, never re-derived.
//
// Production stays genuinely issuer-less: no production code path calls
// `createRoleActorBinding` or mints a `role-actor` grant. That absence is
// what keeps `ready`/`wait-ready` honest in production -- not an artificial
// software gate that unconditionally rejects `binding_kind === 'role-actor'`
// regardless of whether a genuine (test-minted) one exists, which is what
// this correction removes. Tests mint one directly (no CLI surface exists
// to do this, by design -- identical in spirit to
// `createMainOrchestratorBinding`'s own test-only mint path).
// ─────────────────────────────────────────────────────────────────────────────

const ROLE_ACTOR_BINDING_SCHEMA = 'runtime/role-actor-binding/v1';
const ROLE_ACTOR_BINDING_KEYS = Object.freeze([
  'actor_instance_id', 'binding_id', 'created_at', 'expiry', 'plan_digest',
  'role', 'schema', 'session_generation_id', 'worktree_id',
]);

function roleActorBindingPathFor(projectRootOrRepoDescriptor, bindingId) {
  return path.join(registryRepoDir(projectRootOrRepoDescriptor), 'role-actor-bindings', bindingId + '.json');
}

/**
 * WP3-scoped registry infrastructure only (schema + create + read/validate);
 * no production issuer exists until WP4. `role` is a SINGLE canonical role
 * (never null/array -- a role-actor represents exactly one role, unlike a
 * grant's more general role union), matching the only admitted subcommand
 * (`ready`, always called with a single-role action per `handleReady`'s own
 * `action.role`). R4 round 3 (round 4 correction): every input is now
 * independently validated BEFORE anything is written -- WP3 has no
 * hook-observed identity or production issuer to lean on for this type
 * (unlike MainOrchestratorBinding's `resolveSessionGeneration` call), so
 * this mint path is the ONLY gate standing between a test fixture bug (or a
 * future WP4 issuer bug) and a durably-published, semantically-false
 * RoleActorBinding record.
 * @param {string} projectRoot
 * @param {string} role
 * @param {string} worktreeId
 * @param {string} planDigest
 * @param {string} sessionGenerationId
 * @param {number} ttlSeconds
 * @returns {{ok:true,binding:object}|{ok:false,reason:string}}
 */
function createRoleActorBinding(projectRoot, role, worktreeId, planDigest, sessionGenerationId, ttlSeconds) {
  if (!CANONICAL_ROLES.includes(role)) return { ok: false, reason: 'invalid-role' };
  if (!isHexDigest64(worktreeId)) return { ok: false, reason: 'invalid-worktree-id' };
  if (!isHexDigest64(planDigest)) return { ok: false, reason: 'invalid-plan-digest' };
  if (!isHexCsprng32(sessionGenerationId)) return { ok: false, reason: 'invalid-session-generation-id' };
  if (!isIntInRangeNum(ttlSeconds, 1, ACTION_TTL_CEILING_SECONDS)) return { ok: false, reason: 'invalid-ttl' };
  const bindingId = crypto.randomBytes(16).toString('hex');
  const nowStr = nowIsoForRegistry();
  const binding = {
    schema: ROLE_ACTOR_BINDING_SCHEMA,
    binding_id: bindingId,
    actor_instance_id: crypto.randomBytes(16).toString('hex'),
    role,
    worktree_id: worktreeId,
    plan_digest: planDigest,
    session_generation_id: sessionGenerationId,
    created_at: nowStr,
    expiry: isoPlusSecondsForRegistry(nowStr, ttlSeconds),
  };
  const bindingPath = roleActorBindingPathFor(projectRoot, bindingId);
  const writeResult = writeRegistryRecordReplace(bindingPath, Buffer.from(canonicalJSONStringify(binding), 'utf8'));
  if (!writeResult.ok) return { ok: false, reason: writeResult.reason };
  return { ok: true, binding };
}

/**
 * Closed validator for RoleActorBinding/v1, structurally parallel to
 * `validateAndConsumeLifecycleCommandGrant`'s own INLINE main-orchestrator
 * binding resolution (never `validateMainOrchestratorBindingFor`, which is
 * the SEPARATE SupervisorExecutionClaim validator and correlates against an
 * action's session generation -- a correlation this function deliberately
 * leaves to the caller, exactly like the inline main-orchestrator path
 * does): exact key-set closure, exact schema literal, path<->field id
 * correlation, hex-shaped id fields, canonical-ISO-UTC timestamps with
 * created_at<=expiry and never in the future, not expired, and scope
 * correlation against the GRANT's own fields (role/worktree/plan) only.
 * `session_generation_id` is returned on the binding for the caller
 * (`handleReady`) to cross-check against the ACTION's own value itself,
 * mirroring exactly how the main-orchestrator path re-derives and checks
 * its session generation AFTER grant-consumption, not during it.
 * @param {string|{repoId:string}} repoDescriptor
 * @param {string} bindingId
 * @param {string} expectedRole
 * @param {string} expectedWorktreeId
 * @param {string} expectedPlanDigest
 * @returns {{ok:true,binding:object}|{ok:false,reason:string}}
 */
function validateRoleActorBindingFor(repoDescriptor, bindingId, expectedRole, expectedWorktreeId, expectedPlanDigest) {
  if (!isHexActionId(bindingId)) return { ok: false, reason: 'role-actor-binding-id-invalid' };
  const bindingRead = readRegistryRecord(roleActorBindingPathFor(repoDescriptor, bindingId));
  if (!bindingRead.ok) return { ok: false, reason: 'role-actor-binding-read-failed:' + bindingRead.reason };
  if (bindingRead.absent) return { ok: false, reason: 'role-actor-binding-absent' };
  const binding = bindingRead.obj;
  if (!binding || !hasExactKeys(binding, ROLE_ACTOR_BINDING_KEYS)) return { ok: false, reason: 'role-actor-binding-shape-invalid' };
  if (binding.schema !== ROLE_ACTOR_BINDING_SCHEMA) return { ok: false, reason: 'role-actor-binding-schema-invalid' };
  if (binding.binding_id !== bindingId) return { ok: false, reason: 'role-actor-binding-id-path-mismatch' };
  if (!isHexActionId(binding.actor_instance_id)) return { ok: false, reason: 'role-actor-binding-shape-invalid' };
  if (!CANONICAL_ROLES.includes(binding.role)) return { ok: false, reason: 'role-actor-binding-shape-invalid' };
  if (!isHexDigest64(binding.worktree_id) || !isHexDigest64(binding.plan_digest)) return { ok: false, reason: 'role-actor-binding-shape-invalid' };
  if (typeof binding.session_generation_id !== 'string' || binding.session_generation_id.length === 0) return { ok: false, reason: 'role-actor-binding-shape-invalid' };
  if (!isCanonicalIsoUtc(binding.created_at) || !isCanonicalIsoUtc(binding.expiry)) return { ok: false, reason: 'role-actor-binding-timestamp-shape-invalid' };
  const createdAtMs = isoToMsForRegistry(binding.created_at);
  const expiryMs = isoToMsForRegistry(binding.expiry);
  if (!Number.isFinite(createdAtMs) || !Number.isFinite(expiryMs) || createdAtMs > expiryMs) {
    return { ok: false, reason: 'role-actor-binding-timestamp-invalid' };
  }
  const nowMs = currentClockMsForRegistry();
  if (createdAtMs > nowMs) return { ok: false, reason: 'role-actor-binding-created-in-future' };
  if (nowMs >= expiryMs) return { ok: false, reason: 'role-actor-binding-expired' };
  if (
    binding.role !== expectedRole || binding.worktree_id !== expectedWorktreeId
    || binding.plan_digest !== expectedPlanDigest
  ) {
    return { ok: false, reason: 'role-actor-binding-scope-mismatch' };
  }
  return { ok: true, binding };
}

// ─────────────────────────────────────────────────────────────────────────────
// WP3 item C correction pass R3 (point A.1): lifecycle-command-grant/v1
// implemented LITERALLY per PLAN.md ~L576 -- exact schema/key-set,
// binding_kind/authority/profile enums, the frozen profile->admitted-
// subcommand table, action_id required-iff-{action-failed,ready,wait-ready},
// closed role union (string | sorted-unique-non-empty-canonical-array |
// null), and a hard <=30s TTL. One-use, hook-minted (real hook wiring is
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

const LIFECYCLE_GRANT_SCHEMA = 'runtime/lifecycle-command-grant/v1';
const GRANT_TTL_SECONDS = 30; // PLAN.md ~L576: "All grants expire within 30 seconds" -- a hard ceiling, not a default.
const GRANT_KEYS = Object.freeze([
  'action_id', 'actor_instance_id', 'authority', 'binding_id', 'binding_kind',
  'canonical_argv_digest', 'created_at', 'expiry', 'grant_id', 'plan_digest',
  'profile', 'role', 'schema', 'subcommand', 'worktree_id',
].sort());
const GRANT_BINDING_KIND_ENUM = Object.freeze(['main-orchestrator', 'role-actor']);
const GRANT_AUTHORITY_ENUM = Object.freeze(['orchestrator', 'target']);
const GRANT_PROFILE_ENUM = Object.freeze(['bootstrap', 'normal', 'target']);
// PLAN.md ~L576's exact closed admission table -- "main+bootstrap admits
// only probe|ensure|action-failed|wait-ready|status; main+normal admits only
// probe|ensure|notify|action-failed|wait-ready|status|rotate|stop-owned;
// role-actor+target admits only ready". Keyed by profile alone since profile
// and binding_kind co-vary 1:1 in this closed table (bootstrap/normal are
// always main-orchestrator, target is always role-actor) -- binding_kind is
// still independently validated below, never inferred from profile.
const GRANT_PROFILE_ADMITTED_SUBCOMMANDS = Object.freeze({
  bootstrap: Object.freeze(['probe', 'ensure', 'action-failed', 'wait-ready', 'status']),
  normal: Object.freeze(['probe', 'ensure', 'notify', 'action-failed', 'wait-ready', 'status', 'rotate', 'stop-owned']),
  target: Object.freeze(['ready']),
});
const GRANT_PROFILE_FOR_BINDING_KIND = Object.freeze({
  'main-orchestrator': Object.freeze(['bootstrap', 'normal']),
  'role-actor': Object.freeze(['target']),
});
// Point 1.2 (R4): binding_kind and authority co-vary 1:1 -- a
// main-orchestrator binding is never target authority and a role-actor
// binding is never orchestrator authority. Previously each enum was
// validated independently with no correlation between them, so a
// main-orchestrator+target (or role-actor+orchestrator) grant was
// structurally acceptable despite being semantically incoherent.
const GRANT_AUTHORITY_FOR_BINDING_KIND = Object.freeze({
  'main-orchestrator': 'orchestrator',
  'role-actor': 'target',
});
const GRANT_ACTION_ID_REQUIRED_SUBCOMMANDS = Object.freeze(['action-failed', 'ready', 'wait-ready']);

function grantPathFor(projectRoot, grantId) {
  return path.join(registryRepoDir(projectRoot), 'grants', grantId + '.json');
}

function grantConsumedMarkerPathFor(projectRoot, grantId) {
  return path.join(registryRepoDir(projectRoot), 'grants', grantId + '.consumed');
}

function grantArraysEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

/**
 * Structural well-formedness of a grant's `role` field, independent of any
 * specific caller's expectation (PLAN.md ~L576's closed union): a single
 * canonical role string, OR a sorted unique non-empty canonical-role array,
 * OR null. Array-vs-string CHOICE (single-role ensure as a string vs
 * multi-role ensure as an array) and the "null only for probe/status or a
 * current team/supervisor action" restriction are both caller-expectation
 * correlation, validated separately via `grantRoleMatchesExpectation` --
 * this function only rejects a structurally malformed value.
 */
function isWellFormedGrantRole(role) {
  if (role === null) return true;
  if (typeof role === 'string') return CANONICAL_ROLES.includes(role);
  if (Array.isArray(role)) {
    if (role.length === 0 || !hasUniqueValues(role)) return false;
    if (!role.every((r) => typeof r === 'string' && CANONICAL_ROLES.includes(r))) return false;
    return grantArraysEqual(role, role.slice().sort());
  }
  return false;
}

function grantRoleMatchesExpectation(grantRole, expectedRole) {
  if (Array.isArray(grantRole) || Array.isArray(expectedRole)) return grantArraysEqual(grantRole, expectedRole);
  return grantRole === expectedRole;
}

/**
 * Mints one no-clobber lifecycle-command-grant/v1 referencing `binding` for a
 * specific closed argv digest (the EXACT subcommand+role+project-root the grant
 * authorizes -- a grant minted for one argv shape can never authorize a
 * different one, closing a confused-deputy replay-with-different-args class).
 * `bindingKind`/`authority`/`profile` are never inferred/defaulted -- the
 * caller (a hook, or a test simulating one) declares them explicitly, and
 * minting fails closed if `subcommand` is not admitted by that exact
 * profile or `bindingKind`/`profile` do not co-vary per PLAN.md ~L576.
 * @param {string} projectRoot
 * @param {object} binding - a MainOrchestratorBinding/v1 (main-orchestrator
 *   grants) or a RoleActorBinding/v1 (role-actor grants, R4 round 3 block
 *   1a) -- `bindingKind` MUST genuinely match `binding`'s own declared
 *   schema (R4 round 3, round 4 correction, finding 1: schema-aware
 *   minting) -- a mismatch publishes nothing.
 * @param {string} argvDigest - sha256 over the canonical argv this grant authorizes.
 * @param {string|string[]|null} role
 * @param {string} subcommand
 * @param {'main-orchestrator'|'role-actor'} bindingKind
 * @param {'orchestrator'|'target'} authority
 * @param {'bootstrap'|'normal'|'target'} profile
 * @param {string|null} [actionId] - required (32+-hex) iff subcommand is
 *   action-failed|ready|wait-ready; must be null/omitted otherwise.
 * @returns {{ok:true,grantId:string}|{ok:false,reason:string}}
 */
function mintLifecycleCommandGrant(projectRoot, binding, argvDigest, role, subcommand, bindingKind, authority, profile, actionId) {
  if (!GRANT_BINDING_KIND_ENUM.includes(bindingKind)) return { ok: false, reason: 'invalid-binding-kind' };
  // R4 round 3 (round 4 correction, finding 1): schema-aware -- `binding`'s
  // OWN declared type must genuinely match `bindingKind`, checked via its
  // schema literal AND exact key-set (the two types are structurally
  // disjoint: a MainOrchestratorBinding has runtime/runtime_session_key,
  // never session_generation_id, and vice versa). Previously a
  // MainOrchestratorBinding object could be minted with bindingKind:
  // 'role-actor' -- consumption later correctly rejected it, but the mint
  // itself had ALREADY published a semantically false grant artifact. A
  // mismatch here publishes NOTHING.
  if (bindingKind === 'main-orchestrator') {
    if (!binding || binding.schema !== 'runtime/main-orchestrator-binding/v1' || !hasExactKeys(binding, MAIN_BINDING_KEYS)) {
      return { ok: false, reason: 'binding-kind-schema-mismatch' };
    }
  } else if (bindingKind === 'role-actor') {
    if (!binding || binding.schema !== ROLE_ACTOR_BINDING_SCHEMA || !hasExactKeys(binding, ROLE_ACTOR_BINDING_KEYS)) {
      return { ok: false, reason: 'binding-kind-schema-mismatch' };
    }
  }
  if (!GRANT_AUTHORITY_ENUM.includes(authority)) return { ok: false, reason: 'invalid-authority' };
  if (GRANT_AUTHORITY_FOR_BINDING_KIND[bindingKind] !== authority) return { ok: false, reason: 'binding-kind-authority-mismatch' };
  if (!GRANT_PROFILE_ENUM.includes(profile)) return { ok: false, reason: 'invalid-profile' };
  if (!GRANT_PROFILE_FOR_BINDING_KIND[bindingKind].includes(profile)) return { ok: false, reason: 'binding-kind-profile-mismatch' };
  if (!GRANT_PROFILE_ADMITTED_SUBCOMMANDS[profile].includes(subcommand)) return { ok: false, reason: 'subcommand-not-admitted-by-profile' };
  const resolvedActionId = actionId === undefined ? null : actionId;
  const needsActionId = GRANT_ACTION_ID_REQUIRED_SUBCOMMANDS.includes(subcommand);
  if (needsActionId && !isHexActionId(resolvedActionId)) return { ok: false, reason: 'action-id-required' };
  if (!needsActionId && resolvedActionId !== null) return { ok: false, reason: 'action-id-must-be-null' };
  if (!isWellFormedGrantRole(role)) return { ok: false, reason: 'invalid-role-shape' };

  const grantId = crypto.randomBytes(16).toString('hex');
  const nowStr = nowIsoForRegistry();
  const grant = {
    schema: LIFECYCLE_GRANT_SCHEMA,
    grant_id: grantId,
    binding_kind: bindingKind,
    binding_id: binding.binding_id,
    actor_instance_id: binding.actor_instance_id,
    authority,
    profile,
    subcommand,
    action_id: resolvedActionId,
    canonical_argv_digest: argvDigest,
    plan_digest: binding.plan_digest,
    worktree_id: binding.worktree_id,
    role,
    created_at: nowStr,
    expiry: isoPlusSecondsForRegistry(nowStr, GRANT_TTL_SECONDS),
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
 * Every check is independent and fails closed: exact key-set, schema literal,
 * every enum (binding_kind/authority/profile), the profile-admission table,
 * action_id required-iff-{action-failed,ready,wait-ready} shape AND
 * correlation against `callerActionId`, role structural well-formedness AND
 * correlation against `role`, a hard <=30s TTL re-checked (never merely
 * trusted from mint time), created_at never in the future, expiry, and a
 * since-expired binding -- or a replay (the grant was already consumed --
 * the no-clobber consumed-marker already exists).
 * @param {string} projectRoot
 * @param {string} grantId
 * @param {string} argvDigest
 * @param {string|string[]|null} role
 * @param {string} subcommand
 * @param {string|null} [callerActionId] - the actual action_id this call is
 *   operating on (action-failed/ready/wait-ready); omitted/null otherwise.
 * @returns {{ok:true,binding:object}|{ok:false,reason:string}}
 */
function validateAndConsumeLifecycleCommandGrant(projectRoot, grantId, argvDigest, role, subcommand, callerActionId) {
  if (!isHexActionId(grantId)) return { ok: false, reason: 'malformed-grant-id' };
  const grantRead = readRegistryRecord(grantPathFor(projectRoot, grantId));
  if (!grantRead.ok) return { ok: false, reason: grantRead.reason };
  if (grantRead.absent) return { ok: false, reason: 'grant-absent' };
  const grant = grantRead.obj;

  if (!grant || !hasExactKeys(grant, GRANT_KEYS)) return { ok: false, reason: 'grant-key-set-invalid' };
  // Point 1.4 (R4): the record's OWN embedded grant_id must match the id
  // the PATH was constructed from -- never trusted implicitly merely
  // because the file happened to be found at that path. Mirrors the SAME
  // path<->field correlation point A.3 already closed for RoleBinding/v1.
  if (grant.grant_id !== grantId) return { ok: false, reason: 'grant-id-path-mismatch' };
  if (grant.schema !== LIFECYCLE_GRANT_SCHEMA) return { ok: false, reason: 'grant-schema-invalid' };
  // R4 round 2, point 4: reuse the SAME hex-ID + canonical-ISO-UTC rigor
  // RoleBinding/v1 now enforces -- every ID field on the grant is
  // independently well-formed, never merely non-empty-string or
  // Date.parse-able. binding_id in particular is used to derive a registry
  // PATH below; validating its shape before that use is defense in depth,
  // not merely cosmetic.
  if (!isHexActionId(grant.binding_id) || !isHexActionId(grant.actor_instance_id)) {
    return { ok: false, reason: 'grant-id-shape-invalid' };
  }
  if (!isHexDigest64(grant.worktree_id) || !isHexDigest64(grant.plan_digest)) {
    return { ok: false, reason: 'grant-scope-id-shape-invalid' };
  }
  if (!isCanonicalIsoUtc(grant.created_at) || !isCanonicalIsoUtc(grant.expiry)) {
    return { ok: false, reason: 'grant-timestamp-shape-invalid' };
  }
  if (!GRANT_BINDING_KIND_ENUM.includes(grant.binding_kind)) return { ok: false, reason: 'grant-binding-kind-invalid' };
  if (!GRANT_AUTHORITY_ENUM.includes(grant.authority)) return { ok: false, reason: 'grant-authority-invalid' };
  if (GRANT_AUTHORITY_FOR_BINDING_KIND[grant.binding_kind] !== grant.authority) return { ok: false, reason: 'grant-binding-kind-authority-mismatch' };
  if (!GRANT_PROFILE_ENUM.includes(grant.profile)) return { ok: false, reason: 'grant-profile-invalid' };
  if (!GRANT_PROFILE_FOR_BINDING_KIND[grant.binding_kind].includes(grant.profile)) return { ok: false, reason: 'grant-binding-kind-profile-mismatch' };
  if (!GRANT_PROFILE_ADMITTED_SUBCOMMANDS[grant.profile].includes(grant.subcommand)) return { ok: false, reason: 'grant-subcommand-not-admitted' };
  if (!isWellFormedGrantRole(grant.role)) return { ok: false, reason: 'grant-role-shape-invalid' };
  const needsActionId = GRANT_ACTION_ID_REQUIRED_SUBCOMMANDS.includes(grant.subcommand);
  if (needsActionId && !isHexActionId(grant.action_id)) return { ok: false, reason: 'grant-action-id-invalid' };
  if (!needsActionId && grant.action_id !== null) return { ok: false, reason: 'grant-action-id-must-be-null' };

  const resolvedCallerActionId = callerActionId === undefined ? null : callerActionId;
  if (
    grant.subcommand !== subcommand
    || !grantRoleMatchesExpectation(grant.role, role)
    || grant.canonical_argv_digest !== argvDigest
    || (needsActionId && grant.action_id !== resolvedCallerActionId)
  ) {
    return { ok: false, reason: 'grant-shape-mismatch' };
  }

  const createdAtMs = isoToMsForRegistry(grant.created_at);
  const expiryMs = isoToMsForRegistry(grant.expiry);
  if (!Number.isFinite(createdAtMs) || !Number.isFinite(expiryMs) || createdAtMs > expiryMs) {
    return { ok: false, reason: 'grant-timestamp-invalid' };
  }
  if (expiryMs - createdAtMs > GRANT_TTL_SECONDS * 1000) return { ok: false, reason: 'grant-ttl-exceeds-30s' };
  const nowMsForGrant = currentClockMsForRegistry();
  if (createdAtMs > nowMsForGrant) return { ok: false, reason: 'grant-created-in-future' };
  if (nowMsForGrant >= expiryMs) return { ok: false, reason: 'grant-expired' };

  // R4 round 3 (block 1a): a role-actor grant's identity now resolves
  // through RoleActorBinding/v1 -- a genuinely SEPARATE registry type, never
  // MainOrchestratorBinding/v1 (the masquerade PLAN.md ~L574 forbids: a
  // MainOrchestratorBinding "is not a RequesterIdentityProvider peer
  // binding, has no canonical role, ... cannot be registered as a target").
  // Production stays honestly issuer-less because nothing mints a
  // RoleActorBinding or a role-actor grant there yet (WP4) -- not because of
  // an artificial gate that rejects binding_kind==='role-actor' outright
  // regardless of whether a genuine (test-minted) one exists.
  let binding;
  if (grant.binding_kind === 'role-actor') {
    const roleActorResult = validateRoleActorBindingFor(projectRoot, grant.binding_id, grant.role, grant.worktree_id, grant.plan_digest);
    if (!roleActorResult.ok) return { ok: false, reason: roleActorResult.reason };
    binding = roleActorResult.binding;
    if (binding.actor_instance_id !== grant.actor_instance_id) {
      return { ok: false, reason: 'role-actor-binding-actor-mismatch' };
    }
  } else {
    const bindingRead = readRegistryRecord(mainOrchestratorBindingPathFor(projectRoot, grant.binding_id));
    if (!bindingRead.ok) return { ok: false, reason: bindingRead.reason };
    if (bindingRead.absent) return { ok: false, reason: 'binding-absent' };
    binding = bindingRead.obj;
    if (
      !binding || !hasExactKeys(binding, MAIN_BINDING_KEYS) || binding.schema !== 'runtime/main-orchestrator-binding/v1'
      || binding.binding_id !== grant.binding_id || binding.actor_instance_id !== grant.actor_instance_id
      || binding.worktree_id !== grant.worktree_id || binding.plan_digest !== grant.plan_digest
    ) {
      return { ok: false, reason: 'binding-shape-mismatch' };
    }
    // R4 round 2, point 4: binding_id/actor_instance_id/worktree_id/plan_digest
    // are already transitively hex-validated above (equality against the
    // grant's own, now-independently-hex-checked fields) -- created_at/expiry
    // carry no such cross-check and need their OWN canonical-ISO-UTC validation.
    if (!isCanonicalIsoUtc(binding.created_at) || !isCanonicalIsoUtc(binding.expiry)) {
      return { ok: false, reason: 'binding-timestamp-shape-invalid' };
    }
    const bindingExpiryMs = isoToMsForRegistry(binding.expiry);
    if (nowMsForGrant >= bindingExpiryMs) return { ok: false, reason: 'binding-expired' };
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
  return { ok: true, binding, bindingKind: grant.binding_kind };
}

// ─────────────────────────────────────────────────────────────────────────────
// WP3 item C: SupervisorExecutionClaim/v1 -- a THIRD, DISTINCT authority from
// (1) the lifecycle-command-grant/main-binding above, which authorizes the
// top-level orchestrator's `ensure` call that MINTS a `supervisor-start`
// action, and (2) the role-owner rendezvous record `session-run` later wins
// to prove PROCESS ownership after it starts. This is the one that proves the
// action was actually ADMITTED FOR EXECUTION -- PLAN.md ~L580's "atomically
// transitions that action to EXECUTING" -- as a real, independently-checkable
// artifact, never merely inferred from the spawn-gate's own one-use launch
// marker (`bash-cli-spawn-gate.js`'s `<action_id>.background-launch-consumed
// .json`, which is timestamp-only replay-protection at the LAUNCH boundary,
// not execution authority; it may stay as an anti-replay diagnostic but never
// substitutes for this claim).
//
// Real wiring is WP4 (`context-provider-gate.js` mints this the moment it
// authorizes the sanctioned background launch, atomically alongside its own
// consumption marker). Until then: production `session-run` finds no claim
// and fails closed -- it never silently proceeds without one. Tests mint a
// claim ONLY through `fakeHostExecutorExecute` under a DOUBLE capability
// gate (both the general `isTestCapability()` AND the narrower,
// purpose-specific `RUNTIME_ROLE_LIFECYCLE_FAKE_EXECUTOR_CAPABILITY` env var
// must be present) -- a test merely setting the general fake-capability seam
// does not get this unusually powerful "authorize execution" seam by
// accident.
// ─────────────────────────────────────────────────────────────────────────────

const EXECUTION_CLAIM_SCHEMA = 'runtime/supervisor-execution-claim/v1';
const EXECUTION_CLAIM_KEYS = Object.freeze([
  'action_id', 'canonical_argv_digest', 'created_at', 'execution_state', 'expiry',
  'main_binding_id', 'plan_digest', 'schema', 'session_generation_id', 'worktree_id',
]);
const EXECUTOR_CAPABILITY_ENV = 'RUNTIME_ROLE_LIFECYCLE_FAKE_EXECUTOR_CAPABILITY';

function isFakeExecutorCapability() {
  return isTestCapability()
    && typeof process.env[EXECUTOR_CAPABILITY_ENV] === 'string'
    && process.env[EXECUTOR_CAPABILITY_ENV].length > 0;
}

/** Exact, order-independent key-set closure -- no extra, no missing. */
function hasExactKeys(obj, sortedExpectedKeys) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  const actual = Object.keys(obj).sort();
  if (actual.length !== sortedExpectedKeys.length) return false;
  return actual.every((k, i) => k === sortedExpectedKeys[i]);
}

// Role-binding records have a legitimately variable optional-field shape
// (driver/respawn_count/pending_action_id/team_ensure_action_id/
// failure_reason/updated_at all depend on which transition produced them)
// -- closed here means "no key outside this allowed superset", not an exact
// set. Canonical home for this constant/checker; runtime-bridge-codex.cjs
// imports both rather than keeping its own duplicate.
const ROLE_BINDING_ALLOWED_KEYS = Object.freeze([
  'binding_id', 'created_at', 'driver', 'failure_reason', 'pending_action_id',
  'plan_digest', 'profile_digest', 'respawn_count', 'role', 'schema',
  'session_generation_id', 'state', 'stop_reason', 'team_ensure_action_id', 'updated_at', 'worktree_id',
]);

function hasOnlyAllowedKeys(obj, sortedAllowedKeys) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  return Object.keys(obj).every((k) => sortedAllowedKeys.includes(k));
}

function executionClaimPathFor(projectRootOrRepoId, actionId) {
  return path.join(registryRepoDir(projectRootOrRepoId), 'execution-claims', actionId + '.json');
}

function executionClaimConsumedMarkerPathFor(projectRootOrRepoId, actionId) {
  return path.join(registryRepoDir(projectRootOrRepoId), 'execution-claims', actionId + '.consumed');
}

/**
 * Closed validator for MainOrchestratorBinding/v1 (PLAN.md ~L574): exact
 * nine-key closure, exact schema literal, `runtime` in the frozen provider
 * enum, non-empty `runtime_session_key`/`actor_instance_id`, well-formed
 * `created_at<=expiry` with `created_at` never in the future, not expired,
 * and full scope correlation (binding_id/worktree/plan) against `action`.
 * `session_generation_id` is never stored on the binding (see the section
 * header comment above) -- it is re-derived fresh from the binding's own
 * `(runtime, runtime_session_key)` tuple via `resolveSessionGeneration` and
 * compared against `action.session_generation_id`, so a since-expired or
 * rotated session tuple is caught here rather than against a stale snapshot.
 */
function validateMainOrchestratorBindingFor(repoDescriptor, bindingId, action) {
  // main_binding_id becomes a path segment (mainOrchestratorBindingPathFor) --
  // it must be a safe CSPRNG hex id, NEVER a free-form segment (rejects
  // traversal/absolute-path/symlink-name style forgeries before any fs call).
  if (!isHexActionId(bindingId)) return { ok: false, reason: 'main-binding-id-invalid' };
  const bindingRead = readRegistryRecord(mainOrchestratorBindingPathFor(repoDescriptor, bindingId));
  if (!bindingRead.ok) return { ok: false, reason: bindingRead.reason };
  if (bindingRead.absent) return { ok: false, reason: 'main-binding-absent' };
  const binding = bindingRead.obj;
  if (!binding || !hasExactKeys(binding, MAIN_BINDING_KEYS)) return { ok: false, reason: 'main-binding-shape-mismatch' };
  if (
    binding.schema !== 'runtime/main-orchestrator-binding/v1' || binding.binding_id !== bindingId
    || !IDENTITY_PROVIDER_ENUM.includes(binding.runtime)
    // runtime_session_key is an OPAQUE host-observed value (Claude's
    // session_id, Codex's supervisor_instance_id) -- never guaranteed
    // hex-shaped by design, so it stays a loose non-empty-string check.
    || typeof binding.runtime_session_key !== 'string' || binding.runtime_session_key.length === 0
    // R4 round 2, point 4 (tightened R4 round 3, block 2d): actor_instance_id
    // is crypto-random (32-hex, `isHexActionId`); worktree_id/plan_digest are
    // sha256 DIGESTS (64-hex, `isHexDigest64`) -- distinct contracts, per
    // PLAN.md ~L574, never validated via the SAME loose "32+" check.
    || !isHexActionId(binding.actor_instance_id)
    || !isHexDigest64(binding.worktree_id) || !isHexDigest64(binding.plan_digest)
    || binding.worktree_id !== action.worktree_id || binding.plan_digest !== action.plan_digest
  ) {
    return { ok: false, reason: 'main-binding-shape-mismatch' };
  }
  if (!isCanonicalIsoUtc(binding.created_at) || !isCanonicalIsoUtc(binding.expiry)) {
    return { ok: false, reason: 'main-binding-timestamp-shape-invalid' };
  }
  const createdAtMs = isoToMsForRegistry(binding.created_at);
  const expiryMs = isoToMsForRegistry(binding.expiry);
  if (createdAtMs > expiryMs) {
    return { ok: false, reason: 'main-binding-expiry-invalid' };
  }
  const nowMs = currentClockMsForRegistry();
  if (createdAtMs > nowMs) return { ok: false, reason: 'main-binding-created-in-future' };
  if (nowMs >= expiryMs) return { ok: false, reason: 'main-binding-expired' };
  // Point A.4: lookup-only -- a validation never mints a fresh generation
  // as a side effect of merely checking one.
  const genResult = peekSessionGeneration(repoDescriptor, { provider: binding.runtime, runtime_session_key: binding.runtime_session_key });
  if (!genResult.ok || genResult.generationId !== action.session_generation_id) {
    return { ok: false, reason: 'main-binding-shape-mismatch' };
  }
  return { ok: true, binding };
}

/**
 * Re-derives the live session_generation_id for `binding`'s own
 * (runtime, runtime_session_key) tuple and attaches it to the in-memory
 * object as a call-local convenience, since PLAN.md ~L574's binding is never
 * PERSISTED with this field (see the section header above) but every
 * subcommand handler below needs a working generation id to scope its
 * role-binding reads/writes. Never itself written back to disk under this
 * shape. A since-expired/rotated session tuple fails here rather than
 * silently propagating a stale value. Point A.4: lookup-only -- deriving
 * context for an ALREADY-granted operation is validation, never creation;
 * it must never mint a fresh generation as a side effect.
 * @returns {{ok:true}|{ok:false}}
 */
function attachDerivedSessionGenerationId(projectRootOrRepoDescriptor, binding) {
  const genResult = peekSessionGeneration(projectRootOrRepoDescriptor, { provider: binding.runtime, runtime_session_key: binding.runtime_session_key });
  if (!genResult.ok) return { ok: false };
  binding.session_generation_id = genResult.generationId;
  return { ok: true };
}

/**
 * Mints one no-clobber SupervisorExecutionClaim/v1 for a `supervisor-start`
 * action -- proof that the (fake, until WP4) top-level spawn-gate admitted
 * this exact action for execution. THE capability gate lives HERE, at the
 * actual mint point (not merely in the `fakeHostExecutorExecute` wrapper) --
 * a caller reaching this function directly without the double capability is
 * rejected identically to one going through the wrapper. Resolves+validates
 * the referenced MainOrchestratorBinding end to end (existence, exact
 * schema, binding_id/repo/worktree/plan/session correlation, not expired)
 * and bounds the claim's own expiry by `min(action.expires_at,
 * binding.expiry, now+policy.ready_timeout_seconds)` -- never a fixed
 * constant, per the user's own correction.
 * @param {{repoId:string}} repoDescriptor
 * @param {object} action
 * @param {string} mainBindingId
 * @param {number} readyTimeoutSeconds - the resolved policy's own bound; caller resolves it (this function has no `projectRoot` path to resolve policy itself).
 * @returns {{ok:true,claimPath:string,record:object}|{ok:false,reason:string}}
 */
function mintSupervisorExecutionClaim(repoDescriptor, action, mainBindingId, readyTimeoutSeconds) {
  if (!isFakeExecutorCapability()) return { ok: false, reason: 'fake-executor-capability-absent' };
  if (!action || action.kind !== 'supervisor-start' || action.role !== null) return { ok: false, reason: 'wrong-action-kind' };
  if (!Array.isArray(action.payload && action.payload.bridge_argv)) return { ok: false, reason: 'action-payload-malformed' };
  if (!Number.isInteger(readyTimeoutSeconds) || readyTimeoutSeconds < 1) return { ok: false, reason: 'ready-timeout-seconds-invalid' };

  const bindingResult = validateMainOrchestratorBindingFor(repoDescriptor, mainBindingId, action);
  if (!bindingResult.ok) return { ok: false, reason: bindingResult.reason };

  const nowMs = currentClockMsForRegistry();
  const actionExpiryMs = isoToMsForRegistry(action.expires_at);
  const bindingExpiryMs = isoToMsForRegistry(bindingResult.binding.expiry);
  const policyBoundMs = nowMs + readyTimeoutSeconds * 1000;
  const expiryMs = Math.min(actionExpiryMs, bindingExpiryMs, policyBoundMs);
  if (!(expiryMs > nowMs)) return { ok: false, reason: 'no-positive-ttl-remaining' };

  const claimPath = executionClaimPathFor(repoDescriptor, action.action_id);
  const dirResult = ensureSecureRegistryDir(path.dirname(claimPath));
  if (!dirResult.ok) return { ok: false, reason: dirResult.reason };
  const record = {
    schema: EXECUTION_CLAIM_SCHEMA,
    action_id: action.action_id,
    main_binding_id: mainBindingId,
    session_generation_id: action.session_generation_id,
    plan_digest: action.plan_digest,
    worktree_id: action.worktree_id,
    canonical_argv_digest: sha256String(canonicalJSONStringify(action.payload.bridge_argv)),
    created_at: nowIsoForRegistry(),
    expiry: new Date(expiryMs).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    execution_state: 'ISSUED',
  };
  if (!hasExactKeys(record, EXECUTION_CLAIM_KEYS)) return { ok: false, reason: 'internal-key-set-mismatch' };
  try {
    publishNoClobber(claimPath, Buffer.from(canonicalJSONStringify(record), 'utf8'), {});
  } catch (err) {
    return { ok: false, reason: 'execution-claim-already-issued' };
  }
  return { ok: true, claimPath, record };
}

/**
 * Validates+atomically-consumes the execution claim for `action.action_id`
 * against the exact expected scope -- `session-run`'s own gate BEFORE any
 * OTHER registry write. Every field is checked independently and fails
 * closed: exact key-set closure, schema, `execution_state==='ISSUED'`,
 * action/session/plan/worktree/argv correlation, finite ISO timestamps with
 * `created_at<=expiry`, and a FULL independent re-resolution of the
 * referenced MainOrchestratorBinding (never merely trusting the claim's own
 * recorded fields) -- a missing/forged/expired/cross-scope binding is
 * rejected before consumption. Consumption uses the same no-clobber
 * `.consumed`-marker idiom as `lifecycle-command-grant` so a replayed
 * `session-run` for the same action collides EEXIST.
 * @param {{repoId:string}} repoDescriptor
 * @param {object} action
 * @param {string} expectedArgvDigest - sha256(canonicalJSONStringify(the FULL bridge_argv this session-run process actually received)).
 * @returns {{ok:true,claim:object}|{ok:false,reason:string}}
 */
function validateAndConsumeExecutionClaim(repoDescriptor, action, expectedArgvDigest, projectRoot) {
  const claimRead = readRegistryRecord(executionClaimPathFor(repoDescriptor, action.action_id));
  if (!claimRead.ok) return { ok: false, reason: claimRead.reason };
  if (claimRead.absent) return { ok: false, reason: 'execution-claim-absent' };
  const claim = claimRead.obj;

  if (!hasExactKeys(claim, EXECUTION_CLAIM_KEYS)) return { ok: false, reason: 'execution-claim-key-set-invalid' };
  if (claim.schema !== EXECUTION_CLAIM_SCHEMA) return { ok: false, reason: 'execution-claim-schema-invalid' };
  if (claim.execution_state !== 'ISSUED') return { ok: false, reason: 'execution-claim-not-issued' };
  if (typeof claim.action_id !== 'string' || claim.action_id !== action.action_id) return { ok: false, reason: 'execution-claim-action-id-mismatch' };
  if (claim.session_generation_id !== action.session_generation_id) return { ok: false, reason: 'execution-claim-session-mismatch' };
  if (claim.plan_digest !== action.plan_digest) return { ok: false, reason: 'execution-claim-plan-mismatch' };
  if (claim.worktree_id !== action.worktree_id) return { ok: false, reason: 'execution-claim-worktree-mismatch' };
  if (claim.canonical_argv_digest !== expectedArgvDigest) return { ok: false, reason: 'execution-claim-argv-mismatch' };

  const createdAtMs = isoToMsForRegistry(claim.created_at);
  const expiryMs = isoToMsForRegistry(claim.expiry);
  if (!Number.isFinite(createdAtMs) || !Number.isFinite(expiryMs)) return { ok: false, reason: 'execution-claim-timestamp-invalid' };
  if (!(createdAtMs <= expiryMs)) return { ok: false, reason: 'execution-claim-timestamp-order-invalid' };
  const nowMsForClaim = currentClockMsForRegistry();
  if (createdAtMs > nowMsForClaim) return { ok: false, reason: 'execution-claim-created-in-future' };
  if (nowMsForClaim >= expiryMs) return { ok: false, reason: 'execution-claim-expired' };

  // Re-validate expiry against the CURRENT action and policy, not merely the
  // claim's own stored expiry -- a claim minted under a looser policy that has
  // since tightened (or an action whose own expiry has since been shortened)
  // must not outlive its governing bound.
  const actionExpiryMsForClaim = isoToMsForRegistry(action.expires_at);
  if (Number.isFinite(actionExpiryMsForClaim) && expiryMs > actionExpiryMsForClaim) {
    return { ok: false, reason: 'execution-claim-expiry-exceeds-action' };
  }
  const policyPairForClaim = resolvePolicyPair(projectRoot);
  if (!policyPairForClaim.ok) return { ok: false, reason: 'execution-claim-policy-invalid' };
  const policyBoundMsForClaim = createdAtMs + Math.min(policyPairForClaim.policy.ready_timeout_seconds, 120) * 1000;
  if (expiryMs > policyBoundMsForClaim) return { ok: false, reason: 'execution-claim-expiry-exceeds-policy' };

  const bindingResult = validateMainOrchestratorBindingFor(repoDescriptor, claim.main_binding_id, action);
  if (!bindingResult.ok) return { ok: false, reason: 'execution-claim-' + bindingResult.reason };
  // WP3 item C correction pass R3 (point A.2): the claim's own expiry can
  // never exceed the binding's -- independent of "is the binding itself
  // still unexpired right now" (already checked inside
  // validateMainOrchestratorBindingFor), this is "did the claim's OWN
  // recorded lifetime ever legitimately outlive the authority that minted
  // it", re-verified here rather than merely trusted from mint time.
  const bindingExpiryMsForClaim = isoToMsForRegistry(bindingResult.binding.expiry);
  if (!Number.isFinite(bindingExpiryMsForClaim) || expiryMs > bindingExpiryMsForClaim) {
    return { ok: false, reason: 'execution-claim-expiry-exceeds-binding' };
  }

  // Atomic one-use consumption -- LAST, only after every other check passes.
  const dir = path.dirname(executionClaimConsumedMarkerPathFor(repoDescriptor, action.action_id));
  const dirResult = ensureSecureRegistryDir(dir);
  if (!dirResult.ok) return { ok: false, reason: dirResult.reason };
  try {
    publishNoClobber(executionClaimConsumedMarkerPathFor(repoDescriptor, action.action_id), Buffer.from(canonicalJSONStringify({ consumed_at: nowIsoForRegistry() }), 'utf8'), {});
  } catch (err) {
    return { ok: false, reason: 'execution-claim-replay' };
  }
  return { ok: true, claim };
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
  // Point 3.1 (R4): retryable WITHIN the same session generation -- a
  // caller-visible driver/action failure for THIS role, never a
  // respawn-budget/ambiguous-owner/explicit-stop terminality (those go
  // through QUARANTINED/STOPPED instead, restart-only). A fresh `ensure`
  // excludes exactly the driver that produced this UNAVAILABLE record
  // (see handleEnsure's pass 1/2) and genuinely selects the next
  // routing-permitted, capability-proven one.
  UNAVAILABLE: Object.freeze(new Set(['STARTING'])),
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
/**
 * WP3 item C correction pass R3 (point A.3): closes RoleBinding/v1 and
 * correlates path<->role/worktree/PLAN/profile/session -- the path alone
 * (a hash of this exact tuple) was previously TRUSTED without cross-checking
 * the record's OWN embedded fields against it; a subset of fields (merely
 * schema+state) could never actually authorize anything by itself. Every
 * key-tuple field the path is a hash of is now independently re-verified
 * against the record's own claim, plus a closed (allowed-superset) key-set.
 */
// Point 1.5 (R4), closed bidirectionally in R4 round 2 (point 4): closed
// shape PER STATE, not merely an allowed-superset -- ROLE_BINDING_ALLOWED_KEYS
// alone permits any of its six optional fields (driver, respawn_count,
// pending_action_id, team_ensure_action_id, failure_reason, stop_reason) to
// co-occur with ANY state, so a READY record could previously carry a stale
// pending_action_id or a QUARANTINED-only failure_reason without being
// rejected.
//   driver/respawn_count   -- required for every persisted (non-ABSENT) state.
//   pending_action_id      -- REQUIRED (bidirectional) for STARTING/
//                             REHYDRATING, forbidden otherwise, and hex-
//                             shaped when present. Bidirectional is now safe:
//                             `transitionRoleBindingAtomicViaWaypoint`
//                             eliminated the one honest transient-absence
//                             case (noop's own former two-write STARTING
//                             hop) by never persisting the waypoint at all.
//   team_ensure_action_id  -- stays ONE-DIRECTIONAL (presence implies
//                             eligible, not the reverse): `rotate`'s own
//                             claude-sendmessage respawn legitimately omits
//                             it (team-ensure already succeeded the FIRST
//                             time this role was spawned via ensure, and
//                             rotate never re-stamps it). Only STARTING or
//                             REHYDRATING, and only driver claude-sendmessage
//                             (the routing-resolved driver name STORED on
//                             the record -- NOT the action's own `runtime`
//                             field value claude-native, a DIFFERENT,
//                             action-level concept). Hex-shaped when present.
//   failure_reason         -- only UNAVAILABLE or QUARANTINED; non-empty
//                             string when present.
//   stop_reason             -- only STOPPING or STOPPED; non-empty string
//                             when present.
//   binding_id              -- always required, hex-shaped.
//   created_at/updated_at   -- always required, canonical ISO-8601 UTC
//                             (`isCanonicalIsoUtc`), never merely
//                             Date.parse-able.
function roleBindingExtraFieldsAreClosedForState(rec) {
  const has = (k) => Object.prototype.hasOwnProperty.call(rec, k);
  if (typeof rec.driver !== 'string' || rec.driver.length === 0) return false;
  if (!Number.isInteger(rec.respawn_count) || rec.respawn_count < 0) return false;
  // R4 round 3 (round 4 correction, finding 2): THE choke point both the
  // reader (readRoleBindingState) and the writer (transitionRoleBinding
  // Unchecked's nextRecord check) call -- fixing it here closes BOTH ends
  // at once. Previously worktree_id/plan_digest/profile_digest/
  // session_generation_id were NEVER independently shape-validated at
  // all, only compared for EQUALITY against a caller's own parameters (in
  // readRoleBindingState) or against validateRoleBindingRecordForScope's
  // expectedTuple (in transitionRoleBindingUnchecked) -- a self-consistent
  // pair of wrong-length values (writer writes X, reader is asked to read
  // the SAME X) passed both, silently, since neither side ever asked "is X
  // itself well-formed". Reproduced empirically: a 63-hex worktree_id, a
  // 65-hex plan_digest, and a 63-hex profile_digest were all durably
  // written and successfully read back.
  if (!isHexDigest64(rec.worktree_id) || !isHexDigest64(rec.plan_digest) || !isHexDigest64(rec.profile_digest)) return false;
  if (!isHexCsprng32(rec.binding_id)) return false;
  if (!isHexCsprng32(rec.session_generation_id)) return false;
  if (!isCanonicalIsoUtc(rec.created_at) || !isCanonicalIsoUtc(rec.updated_at)) return false;
  const pendingEligible = rec.state === 'STARTING' || rec.state === 'REHYDRATING';
  if (has('pending_action_id') !== pendingEligible) return false;
  if (pendingEligible && !isHexActionId(rec.pending_action_id)) return false;
  const teamEnsureEligible = pendingEligible && rec.driver === 'claude-sendmessage';
  if (has('team_ensure_action_id') && !teamEnsureEligible) return false;
  if (has('team_ensure_action_id') && !isHexActionId(rec.team_ensure_action_id)) return false;
  const failureEligible = rec.state === 'UNAVAILABLE' || rec.state === 'QUARANTINED';
  if (has('failure_reason') !== failureEligible) return false;
  if (failureEligible && (typeof rec.failure_reason !== 'string' || rec.failure_reason.length === 0)) return false;
  const stopEligible = rec.state === 'STOPPING' || rec.state === 'STOPPED';
  if (has('stop_reason') !== stopEligible) return false;
  if (stopEligible && (typeof rec.stop_reason !== 'string' || rec.stop_reason.length === 0)) return false;
  return true;
}

/**
 * R4 round 3 (block 2a): closes an identity-overwrite bug empirically
 * reproduced against `transitionRoleBindingUnchecked` -- `nextRecord` is
 * assembled via `Object.assign(base, fromRecord||{}, {state,updated_at},
 * extraFields||{})`, which merges left-to-right, so a `fromRecord` or
 * `extraFields` carrying its OWN `role`/`worktree_id`/`plan_digest`/
 * `profile_digest`/`session_generation_id` SILENTLY OVERWRITES the base
 * object's correct values (the function's own verified parameters).
 * Reproduced concretely: a transition at the arch-testing role-binding path
 * with `extraFields.role = 'verifier'` returned `{ok:true}` and wrote a
 * record whose own `role` field said "verifier" while living at the
 * arch-testing-keyed path; the very next `readRoleBindingState` call
 * correctly REJECTED it as `role-binding-shape-invalid`, but the WRITE
 * itself should never have succeeded. Applied to `current`/`fromRecord`/
 * `nextRecord`, all under the SAME lock inside
 * `transitionRoleBindingUnchecked` -- fails closed (never silently
 * corrects the mismatched field back to the expected value, which would
 * mask a genuine caller bug rather than surface it) so identity fields can
 * never be overwritten by a caller-supplied `fromRecord` or `extraFields`
 * regardless of what either one claims.
 * @param {object} record
 * @param {{role:*, worktree_id:string, plan_digest:string, profile_digest:string, session_generation_id:string}} expectedTuple
 * @returns {boolean}
 */
function validateRoleBindingRecordForScope(record, expectedTuple) {
  if (!record || typeof record !== 'object') return false;
  return (
    record.role === expectedTuple.role
    && record.worktree_id === expectedTuple.worktree_id
    && record.plan_digest === expectedTuple.plan_digest
    && record.profile_digest === expectedTuple.profile_digest
    && record.session_generation_id === expectedTuple.session_generation_id
  );
}

function readRoleBindingState(projectRoot, worktreeId, planDigest, profileDigest, generationId, role) {
  const recordPath = roleBindingPathFor(projectRoot, worktreeId, planDigest, profileDigest, generationId, role);
  const read = readRegistryRecord(recordPath);
  if (!read.ok) return { ok: false, reason: read.reason };
  if (read.absent) return { ok: true, state: 'ABSENT' };
  const rec = read.obj;
  if (
    !rec || !hasOnlyAllowedKeys(rec, ROLE_BINDING_ALLOWED_KEYS)
    || rec.schema !== 'runtime/role-binding/v1' || !ROLE_BINDING_STATE_ENUM.includes(rec.state)
    || rec.worktree_id !== worktreeId || rec.plan_digest !== planDigest
    || rec.profile_digest !== profileDigest || rec.session_generation_id !== generationId || rec.role !== role
    || !roleBindingExtraFieldsAreClosedForState(rec)
  ) {
    return { ok: false, reason: 'role-binding-shape-invalid' };
  }
  return { ok: true, state: rec.state, record: rec };
}

/**
 * The CAS+write internals, shared by `transitionRoleBinding` (which enforces
 * the closed PUBLIC single-hop graph before delegating here) and
 * `transitionRoleBindingAtomicViaWaypoint` (which enforces its OWN two-hop
 * legality via the SAME graph data before delegating here, but persists
 * only the FINAL state -- R4 round 2, point 4). NEVER called directly by a
 * handler; always through one of those two checked entry points.
 * `fromRecord` is `null` only for the ABSENT->STARTING transition (first
 * creation); every other transition requires the CURRENT on-disk record's
 * `binding_id` to match `fromRecord.binding_id` (a stale/superseded reader can
 * never blindly overwrite a newer transition -- checked under the registry
 * lock). Point 4: the fully-assembled `nextRecord` is validated via the SAME
 * closed-shape check a reader would apply BEFORE it is ever persisted --
 * this function can never durably write a record its own sibling reader
 * would immediately reject.
 * @returns {{ok:true,record:object}|{ok:false,reason:string}}
 */
function transitionRoleBindingUnchecked(projectRoot, worktreeId, planDigest, profileDigest, generationId, role, fromState, toState, fromRecord, extraFields) {
  const recordPath = roleBindingPathFor(projectRoot, worktreeId, planDigest, profileDigest, generationId, role);
  const lockDir = recordPath + '.lock';
  // Block 2a: THIS call's own verified parameters -- the single source of
  // truth every record touched below (current/fromRecord/nextRecord) is
  // checked against, so none of them can ever smuggle a different tuple
  // into what gets persisted.
  const expectedTuple = { role, worktree_id: worktreeId, plan_digest: planDigest, profile_digest: profileDigest, session_generation_id: generationId };
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
      // Block 2a: the on-disk record this transition is reading FROM must
      // already belong to this exact tuple -- never transition off of a
      // record that (somehow) does not.
      if (!validateRoleBindingRecordForScope(current.obj, expectedTuple)) {
        return { ok: false, reason: 'current-record-scope-mismatch' };
      }
    }
    // Block 2a: the caller-supplied fromRecord is about to be merged into
    // nextRecord below (Object.assign merges left-to-right, so a
    // fromRecord carrying a DIFFERENT role/worktree_id/plan_digest/
    // profile_digest/session_generation_id would otherwise silently
    // overwrite the correct base values) -- checked BEFORE that merge ever
    // happens, never merely inferred from current's own check above (a
    // caller can pass ANY object here, not necessarily what was just read).
    if (fromRecord && !validateRoleBindingRecordForScope(fromRecord, expectedTuple)) {
      return { ok: false, reason: 'from-record-scope-mismatch' };
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
    // Point 1.5 (R4): pending_action_id/team_ensure_action_id are ONLY
    // meaningful while a host-native action is actually pending
    // (STARTING/REHYDRATING) -- without this, a plain Object.assign merge
    // silently carries a NOW-STALE reference forward into READY/
    // UNAVAILABLE/QUARANTINED/etc, exactly the kind of leftover field a
    // per-state closed shape must reject. Stripped centrally here
    // (`delete`, not `undefined` -- both are omitted by
    // canonicalJSONStringify, but `delete` also keeps the IN-MEMORY object
    // this function returns to its caller honest, not just the eventual
    // serialized bytes) so every call site is covered uniformly, never
    // requiring each caller to remember to clear them individually.
    if (toState !== 'STARTING' && toState !== 'REHYDRATING') {
      delete nextRecord.pending_action_id;
      delete nextRecord.team_ensure_action_id;
    }
    // Point 3.1 (R4): the SAME stale-carry-forward hazard, now reachable
    // for `failure_reason` too now that UNAVAILABLE has an outgoing edge
    // (UNAVAILABLE->STARTING, the same-generation driver-fallback retry) --
    // an Object.assign merge would otherwise silently carry the FAILED
    // attempt's failure_reason forward onto the fresh STARTING record,
    // which roleBindingExtraFieldsAreClosedForState's bidirectional check
    // (has('failure_reason') !== failureEligible) then permanently rejects
    // as shape-invalid the moment anything reads it back. stop_reason is
    // stripped symmetrically for the same reason, even though no current
    // edge yet carries it forward (STOPPED is terminal) -- defends the
    // same invariant if that ever changes.
    if (toState !== 'UNAVAILABLE' && toState !== 'QUARANTINED') {
      delete nextRecord.failure_reason;
    }
    if (toState !== 'STOPPING' && toState !== 'STOPPED') {
      delete nextRecord.stop_reason;
    }
    // Block 2a: the decisive check -- regardless of what fromRecord or
    // extraFields claimed, nextRecord's identity fields must match THIS
    // call's own verified parameters. This is what actually closes the
    // reproduced bug (extraFields.role='verifier' silently accepted onto
    // the arch-testing-keyed path): even though the checks above already
    // reject a poisoned current/fromRecord, this is the last,
    // unconditional gate immediately before the write -- fails closed
    // rather than silently correcting the mismatched field back to the
    // expected value, which would mask a genuine caller bug instead of
    // surfacing it.
    if (!validateRoleBindingRecordForScope(nextRecord, expectedTuple)) {
      return { ok: false, reason: 'next-record-scope-mismatch' };
    }
    // Point 4 (R4 round 2): validate the FULL nextRecord -- exact key-set,
    // schema, and every per-state field/shape rule -- before it is ever
    // persisted. A writer that could durably publish a record its own
    // sibling reader would reject is exactly the gap this closes.
    if (
      !hasOnlyAllowedKeys(nextRecord, ROLE_BINDING_ALLOWED_KEYS)
      || nextRecord.schema !== 'runtime/role-binding/v1'
      || !roleBindingExtraFieldsAreClosedForState(nextRecord)
    ) {
      return { ok: false, reason: 'nextrecord-shape-invalid' };
    }
    const writeResult = writeRegistryRecordReplace(recordPath, Buffer.from(canonicalJSONStringify(nextRecord), 'utf8'));
    if (!writeResult.ok) return { ok: false, reason: writeResult.reason };
    return { ok: true, record: nextRecord };
  });
  if (!result.ok) return { ok: false, reason: result.reason };
  return result.value;
}

/**
 * Enforces the closed PUBLIC single-hop transition graph, then delegates to
 * `transitionRoleBindingUnchecked`.
 * @returns {{ok:true,record:object}|{ok:false,reason:string}}
 */
function transitionRoleBinding(projectRoot, worktreeId, planDigest, profileDigest, generationId, role, fromState, toState, fromRecord, extraFields) {
  if (!ROLE_BINDING_TRANSITIONS[fromState] || !ROLE_BINDING_TRANSITIONS[fromState].has(toState)) {
    return { ok: false, reason: 'illegal-state-transition' };
  }
  return transitionRoleBindingUnchecked(projectRoot, worktreeId, planDigest, profileDigest, generationId, role, fromState, toState, fromRecord, extraFields);
}

/**
 * R4 round 2, point 4: a compound two-hop transition (`fromState` ->
 * `waypointState` -> `toState`) that validates BOTH hops are legal per the
 * SAME closed `ROLE_BINDING_TRANSITIONS` graph `transitionRoleBinding`
 * itself enforces, but persists ONLY the final `toState` record -- the
 * `waypointState` is never durably written, so it can never be observed
 * mid-flight (by a concurrent reader) in an intentionally-incomplete shape,
 * and never needs its own now-bidirectionally-required fields (e.g.
 * `pending_action_id`) fabricated dishonestly. This is deliberately NOT a
 * new direct edge in the PUBLIC graph (`fromState` -> `toState` stays
 * illegal for every OTHER caller) -- only this function's own two
 * discrete, independently-checked hops license the jump.
 * Used by: `noop`'s own STARTING/REHYDRATING->READY hop (never a genuine
 * pending action to reference) and `quarantineViaRehydrating`'s
 * DEAD/ROTATING->REHYDRATING->QUARANTINED hop (REHYDRATING is a structural
 * graph waypoint only, never a genuine wait).
 * @returns {{ok:true,record:object}|{ok:false,reason:string}}
 */
function transitionRoleBindingAtomicViaWaypoint(projectRoot, worktreeId, planDigest, profileDigest, generationId, role, fromState, waypointState, toState, fromRecord, extraFields) {
  if (!ROLE_BINDING_TRANSITIONS[fromState] || !ROLE_BINDING_TRANSITIONS[fromState].has(waypointState)) {
    return { ok: false, reason: 'illegal-state-transition' };
  }
  if (!ROLE_BINDING_TRANSITIONS[waypointState] || !ROLE_BINDING_TRANSITIONS[waypointState].has(toState)) {
    return { ok: false, reason: 'illegal-state-transition' };
  }
  return transitionRoleBindingUnchecked(projectRoot, worktreeId, planDigest, profileDigest, generationId, role, fromState, toState, fromRecord, extraFields);
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
/**
 * @param {object} routing
 * @param {string} role
 * @param {{availableDrivers:string[]}} capabilityManifest
 * @param {string[]} [excludedDrivers] - WP3 item C correction pass R2 (point
 *   5): driver NAMES to skip regardless of capability/noop status. Unlike
 *   filtering `capabilityManifest.availableDrivers` (which a caller might be
 *   tempted to do instead), this does NOT make `noop` spuriously reachable
 *   -- `noop` is unconditionally selectable once the routing list reaches
 *   it, so hiding a driver from the manifest alone can skip past every OTHER
 *   real driver still later in the list and land on noop by accident.
 *   Optional; omitted/empty is byte-identical to prior behavior for every
 *   existing caller.
 */
function selectDriverForRole(routing, role, capabilityManifest, excludedDrivers) {
  const allowed = routing.routes[role];
  if (!Array.isArray(allowed)) return null;
  for (const driver of allowed) {
    if (excludedDrivers && excludedDrivers.includes(driver)) continue;
    if (driver === 'noop' || capabilityManifest.availableDrivers.includes(driver)) return driver;
  }
  return null;
}

// Point 3.2 (R4): claude-agent/codex-mcp/runtime-spawn are capability-proven,
// routing-permitted drivers with NO ensure()-mintable persistent
// role-lifecycle-action at all (PLAN.md's closed action kind/runtime union,
// ~L154-163, has no member for any of the three).
const LIFECYCLE_INELIGIBLE_DRIVERS = Object.freeze(['claude-agent', 'codex-mcp', 'runtime-spawn']);

/**
 * A persistent ensure() variant of `selectDriverForRole` that unconditionally
 * treats `LIFECYCLE_INELIGIBLE_DRIVERS` as excluded, IN ADDITION to any
 * caller-supplied `excludedDrivers` -- so persistent ensure() genuinely
 * iterates PAST a capability-proven-but-lifecycle-ineligible driver to the
 * next routing-permitted one (including `noop`) rather than stopping short
 * the moment routing/capability lands on one of the three. Per-request
 * dispatch (a DIFFERENT subsystem, runtime-consultation.cjs) is unaffected --
 * it calls `selectDriverForRole` directly and may still select any of them.
 * @returns {string|null}
 */
function selectLifecycleEligibleDriverForRole(routing, role, capabilityManifest, excludedDrivers) {
  return selectDriverForRole(routing, role, capabilityManifest, LIFECYCLE_INELIGIBLE_DRIVERS.concat(excludedDrivers || []));
}

/**
 * Point 3.3 (R4): `noop` may only declare a role-binding READY when a
 * genuinely registered, validated disk consumer is polling for THIS exact
 * role -- never unconditionally the instant routing/capability reaches it.
 * No production registration mechanism is wired yet (WP4); the honest
 * production answer is always "no", mirroring `getCapabilityManifest`'s
 * honest-empty-in-production pattern -- NEVER inferred from a file's mere
 * presence, a PID, or process ancestry.
 * @returns {boolean}
 */
function hasRegisteredValidatedDiskConsumer(role) {
  if (!isTestCapability()) return false;
  const raw = process.env.RUNTIME_ROLE_LIFECYCLE_TEST_DISK_CONSUMERS;
  if (typeof raw !== 'string' || raw.length === 0) return false;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return false;
  }
  if (!Array.isArray(parsed) || !parsed.every((r) => typeof r === 'string' && CANONICAL_ROLES.includes(r))) {
    return false;
  }
  return parsed.includes(role);
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
const ACTION_TTL_CEILING_SECONDS = 120; // PLAN.md ~L154: expiry bounded by ready_timeout_seconds, max 120s.

/**
 * WP3 item C correction (point 4): an action's expiry is never a flat
 * constant. It is bounded by the min of: the selected policy's own
 * `ready_timeout_seconds`, the frozen 120s ceiling (PLAN.md ~L154), and the
 * MainOrchestratorBinding's own remaining lifetime -- an action can never
 * outlive either the policy that governs it or the authority that requested
 * it. Whole seconds, floored, minimum 1 (never zero/negative -- a
 * caller with an already-expired/near-expired binding should fail at the
 * binding-expiry check upstream, not mint a self-contradictory 0s action).
 * @param {{ready_timeout_seconds:number}} policy
 * @param {string} bindingExpiryIso
 * @returns {number}
 */
/**
 * WP3 item C correction pass R3 (point A.5): a binding with LESS THAN ONE
 * SECOND of remaining lifetime can never produce an action that would
 * outlive it -- fails closed rather than flooring to a fabricated minimum
 * (the previous `Math.max(1, ...)` could mint a 1s action against a binding
 * already expired or expiring in milliseconds, letting the action legitimately
 * outlive the authority that requested it).
 * @returns {{ok:true,ttlSeconds:number}|{ok:false,reason:string}}
 */
function computeActionTtlSeconds(policy, bindingExpiryIso) {
  const nowMs = currentClockMsForRegistry();
  const bindingRemainingMs = isoToMsForRegistry(bindingExpiryIso) - nowMs;
  if (!Number.isFinite(bindingRemainingMs) || bindingRemainingMs < 1000) {
    return { ok: false, reason: 'binding-remaining-lifetime-insufficient' };
  }
  const bindingRemainingSeconds = Math.floor(bindingRemainingMs / 1000);
  return { ok: true, ttlSeconds: Math.max(1, Math.min(policy.ready_timeout_seconds, ACTION_TTL_CEILING_SECONDS, bindingRemainingSeconds)) };
}

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
function mintRoleLifecycleAction(projectRoot, actionId, kind, runtime, repoId, worktreeId, planDigest, policyDigest, generationId, role, payload, expiresAtIso) {
  if (!isHexActionId(actionId)) return { ok: false, reason: 'invalid-action-id' };
  if (!ACTION_KIND_ENUM.includes(kind)) return { ok: false, reason: 'invalid-kind' };
  if (!ACTION_RUNTIME_ENUM.includes(runtime)) return { ok: false, reason: 'invalid-runtime' };
  // A precomputed ISO instant, never a TTL re-derived here -- when this
  // value also seeds a supervisor-start payload's --session-expiry
  // (buildSupervisorStartPayload), the two must be BYTE-IDENTICAL, which a
  // second independent `now()`-based computation inside this function could
  // never guarantee (point 4: "el --session-expiry del bridge debe ser
  // exactamente ese expiry"). Bounding against policy/ceiling/binding
  // lifetime is computeActionTtlSeconds's job, called once by the caller.
  const expiresAtMs = isoToMsForRegistry(expiresAtIso);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= currentClockMsForRegistry()) {
    return { ok: false, reason: 'invalid-expiry' };
  }
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
    expires_at: expiresAtIso,
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

let cachedResolvedNodePath = null;

/**
 * The `<resolved-node>` bridge_argv[0] component (PLAN.md ~L162): the
 * absolute, realpath-verified path to the CURRENTLY-RUNNING node binary --
 * never the bare `"node"` literal, which a spawned child would resolve
 * against its OWN inherited PATH at launch time (point 4: an attacker- or
 * environment-controlled PATH could substitute a different binary).
 * Memoized -- process.execPath is invariant for the life of this process.
 */
function resolvedNodePath() {
  if (cachedResolvedNodePath) return cachedResolvedNodePath;
  try {
    cachedResolvedNodePath = fs.realpathSync(process.execPath);
  } catch (err) {
    cachedResolvedNodePath = process.execPath;
  }
  return cachedResolvedNodePath;
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
// action-failed/wait-ready surface deterministically without a real host. For
// a `supervisor-start` action with `outcome==='executed'`, it ALSO mints the
// SupervisorExecutionClaim this simulates the (WP4, not yet real) spawn-gate
// issuing -- gated behind the DOUBLE capability check above, never available
// just because the general fake-capability seam happens to be on.
// ─────────────────────────────────────────────────────────────────────────────

function fakeHostExecutorExecute(projectRoot, actionId, outcome, mainBindingId) {
  const actionRead = readRegistryRecord(actionPathFor(projectRoot, actionId));
  if (!actionRead.ok || actionRead.absent) return { ok: false, reason: 'action-absent' };
  const action = actionRead.obj;
  const repoDescriptor = { repoId: action.repo_id };
  if (outcome === 'executed' && action.kind === 'supervisor-start') {
    const pair = resolvePolicyPair(projectRoot);
    if (!pair.ok) return { ok: false, reason: 'policy-invalid' };
    const claimResult = mintSupervisorExecutionClaim(repoDescriptor, action, mainBindingId, pair.policy.ready_timeout_seconds);
    if (!claimResult.ok) return { ok: false, reason: claimResult.reason };
    return { ok: true, action, outcome, executionClaim: claimResult.record };
  }
  if (outcome === 'executed' && action.kind === 'team-ensure') {
    const registerResult = registerTeamEnsureSuccess(repoDescriptor, action.session_generation_id, action.worktree_id, action.plan_digest, action.action_id);
    if (!registerResult.ok) return { ok: false, reason: registerResult.reason };
    return { ok: true, action, outcome };
  }
  return { ok: true, action, outcome };
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

  // Point 1.1 (R4): PLAN.md ~L150 -- every lifecycle command requires a
  // grant; missing/invalid fails closed, never a silent pass-through.
  const lifecycleBindingRef = parsed.values['--lifecycle-binding'];
  if (lifecycleBindingRef === undefined) {
    invalidError('probe', 'IDENTITY_MISMATCH');
    return;
  }
  const argvDigest = sha256String('probe');
  const consumeResult = validateAndConsumeLifecycleCommandGrant(projectRoot, lifecycleBindingRef, argvDigest, null, 'probe');
  if (!consumeResult.ok) {
    invalidError('probe', 'IDENTITY_MISMATCH');
    return;
  }
  const binding = consumeResult.binding;
  const planResult = discoverPlan(projectRoot);
  if (!planResult.ok) {
    invalidError('probe', 'POLICY_INVALID');
    return;
  }
  if (binding.plan_digest !== planResult.planDigest || binding.worktree_id !== computeWorktreeId(projectRoot)) {
    invalidError('probe', 'IDENTITY_MISMATCH');
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

  // Point 1.1 (R4): every lifecycle command requires a grant. `role` is the
  // caller's own optional --role when supplied, else null (whole-plane) --
  // PLAN.md ~L576's closed role union names status explicitly in the
  // null-role case.
  const lifecycleBindingRef = parsed.values['--lifecycle-binding'];
  if (lifecycleBindingRef === undefined) {
    invalidError('status', 'IDENTITY_MISMATCH');
    return;
  }
  const argvDigest = sha256String('status:' + (role === undefined ? '' : role));
  const consumeResult = validateAndConsumeLifecycleCommandGrant(projectRoot, lifecycleBindingRef, argvDigest, role === undefined ? null : role, 'status');
  if (!consumeResult.ok) {
    invalidError('status', 'IDENTITY_MISMATCH');
    return;
  }
  const binding = consumeResult.binding;
  const planResult = discoverPlan(projectRoot);
  if (!planResult.ok) {
    invalidError('status', 'POLICY_INVALID');
    return;
  }
  if (binding.plan_digest !== planResult.planDigest || binding.worktree_id !== computeWorktreeId(projectRoot)) {
    invalidError('status', 'IDENTITY_MISMATCH');
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
 * R4 round 2, point 4: REHYDRATING here is a pure STRUCTURAL graph
 * waypoint, never a genuine wait for a real pending action -- persisting it
 * (the OLD two-write approach) left a durable, on-disk REHYDRATING record
 * with no `pending_action_id`, which is exactly the shape
 * `roleBindingExtraFieldsAreClosedForState`'s now-bidirectional check
 * correctly rejects. `transitionRoleBindingAtomicViaWaypoint` validates
 * both hops but persists only the final QUARANTINED record, so the
 * incomplete waypoint is never durably observable at all.
 * @returns {{ok:true,record:object}|{ok:false,reason:string}}
 */
function quarantineViaRehydrating(repoDirDescriptor, worktreeId, planDigest, profileDigest, generationId, role, fromState, fromRecord, reason) {
  // Point A.3: the extraFields KEY is failure_reason, matching every other
  // quarantine/terminalization path (terminalizeSupervisorStartAction et
  // al.) and ROLE_BINDING_ALLOWED_KEYS -- a bare `reason` here was a
  // pre-existing field-name drift readRoleBindingState's closed key-set
  // check correctly surfaces as role-binding-shape-invalid.
  return transitionRoleBindingAtomicViaWaypoint(repoDirDescriptor, worktreeId, planDigest, profileDigest, generationId, role, fromState, 'REHYDRATING', 'QUARANTINED', fromRecord, { failure_reason: reason });
}

/**
 * Mints ONE `supervisor-start` action covering the complete sorted+deduped
 * set of `roles` routed to `codex-app-server` (PLAN.md ~L167: "retained
 * Codex emits AT MOST ONE supervisor-start for that complete set, and no
 * later add-role/second-supervisor path exists" -- previously simplified to
 * one action per role; fixed per WP3 item C correction). `roles.length===1`
 * is the trivial single-role case `rotate` also uses via
 * `spawnOrRehydrateSingleRole` below -- same payload shape either way.
 * @returns {{ok:true,actionId:string,action:object}|{ok:false}}
 */
// ─────────────────────────────────────────────────────────────────────────────
// WP3 item C correction pass R2 (point 1), hardened R3 (points B.1/B.3/B.4):
// ONE authoritative lock+durable-owner marker per `coordination_root_id`
// ALONE -- never per {worktree,plan,session_generation}. coordination_root
// IS a deterministic function of repo/projectRoot (PLAN.md's own frozen
// `.planning/coordination` shape), so worktree_id is implied by it, but
// plan_digest and session_generation_id are NOT: PLAN.md ~L536-538 anchors
// the underlying retained-process singleton (the bridge's own role-owner
// records) to `coordination_root_id` alone, and a supervisor-start batch
// backs exactly ONE such retained process. Scoping the LIFECYCLE-level
// owner marker any narrower (as a prior pass did, keying it by
// session_generation_id) let a second, fully independent batch mint for the
// SAME coordination root the moment a new generation appeared -- which the
// bridge would eventually reject at session-run time, but only after
// wastefully starting a second real supervisor race. Classify-singleton,
// mint-the-one-action, transition-the-whole-batch, and publish-the-global-
// owner all happen under this SAME lock -- per-role owner locks
// (roleOwnerLockDirFor, in the bridge) are strictly SUBORDINATE: they
// serialize the LATER real-process rendezvous claim for an ALREADY-decided
// action, never the decision to mint one in the first place. Two concurrent
// `ensure` calls, even for fully disjoint roles and even across two
// DIFFERENT session generations, can therefore never both mint: whichever
// acquires this lock second always finds the first's owner marker already
// published (ACTIVE) and returns unavailable without minting anything --
// never an orphaned action file from a "loser".
//
// The owner marker is itself an explicit, recoverable two-state durable
// machine (point B.3) -- ACTIVE while its action_id's fate is still
// undecided, TERMINATED once that fate is settled -- rather than a
// write-once marker whose mere PRESENCE blocked every future mint forever.
// Two independent, redundant paths drive ACTIVE->TERMINATED, so neither a
// missed explicit call NOR a hard crash can leave the scope permanently,
// silently blocked:
//   1. Explicit (point B.4): `action-failed` (CLI or bridge-internal, both
//      funnel through the SAME `terminalizeSupervisorStartAction`) settles
//      the owner in the SAME call that settles its role-bindings.
//   2. Self-healing (point B.3): a LATER mint attempt that finds an ACTIVE
//      owner independently re-checks whether ITS OWN referenced action has
//      since expired (the SAME bounded TTL every other authority artifact
//      in this system already carries) -- a crash that killed the process
//      before it could ever call action-failed still self-heals here,
//      bounded by that action's own expiry, never by an unbounded wait.
// A rollback mid-transaction (a sibling role-binding transition failing
// after the action was already minted) is unaffected: it unwinds BEFORE the
// owner marker is ever published, so it can never itself strand one. An
// orphaned LOCK directory (the mkdir itself never released) is a SEPARATE
// concern from the owner marker above and is explicitly NOT self-healing:
// withRegistryLock never inspects a held lock's age, so a waiter always
// times out loudly (an explicit {ok:false,reason:'lock-timeout'}, never a
// hang, never a force-reclaim/adopt of someone else's lock) -- proven
// directly against THIS file's own withRegistryLock, at the exact
// supervisorLifecycleTxLockDirFor path shape, by
// runtime-role-lifecycle-registry.test.js's "point 2.5" test (the
// LOCK-ORPHAN-01 name/pattern in runtime-consultation.cjs covers a
// SEPARATE, structurally-similar-but-different lock implementation --
// cited here only as prior art, never as evidence for this one). Because
// nothing can enter this critical section while the lock is held, the
// owner record it protects cannot be corrupted by a stuck lock -- only
// progress on this exact coordination root pauses until an operator
// clears the orphan (declared STOP; no accredited automatic recovery
// exists for this case).
// ─────────────────────────────────────────────────────────────────────────────

const SUPERVISOR_LIFECYCLE_OWNER_SCHEMA = 'runtime/supervisor-lifecycle-owner/v1';
const SUPERVISOR_LIFECYCLE_OWNER_STATE_ENUM = Object.freeze(['ACTIVE', 'TERMINATED']);
const SUPERVISOR_LIFECYCLE_OWNER_ALLOWED_KEYS = Object.freeze([
  'action_id', 'coordination_root_id', 'created_at', 'failure_reason', 'plan_digest',
  'roles', 'schema', 'session_generation_id', 'state', 'updated_at', 'worktree_id',
].sort());

function supervisorLifecycleTxLockDirFor(projectRootOrRepoId, coordinationRootId) {
  return path.join(registryRepoDir(projectRootOrRepoId), 'supervisor-lifecycle-tx', coordinationRootId + '.lock');
}

function supervisorLifecycleOwnerPathFor(projectRootOrRepoId, coordinationRootId) {
  return path.join(registryRepoDir(projectRootOrRepoId), 'supervisor-lifecycle-tx', coordinationRootId + '.json');
}

/**
 * Reads the current owner marker, or synthesizes ABSENT if none exists yet.
 * Closed shape/schema/state-enum/coordination_root_id correlation -- a
 * subset of fields (schema alone) can never authorize treating a foreign or
 * malformed record as this exact scope's owner (mirrors
 * `readRoleBindingState`'s point A.3 closure).
 * @returns {{ok:true,state:'ABSENT'}|{ok:true,state:string,record:object}|{ok:false,reason:string}}
 */
function readSupervisorLifecycleOwnerState(projectRootOrRepoId, coordinationRootId) {
  const recordPath = supervisorLifecycleOwnerPathFor(projectRootOrRepoId, coordinationRootId);
  const read = readRegistryRecord(recordPath);
  if (!read.ok) return { ok: false, reason: read.reason };
  if (read.absent) return { ok: true, state: 'ABSENT' };
  const rec = read.obj;
  const hasFailureReason = !!rec && Object.prototype.hasOwnProperty.call(rec, 'failure_reason');
  if (
    !rec || !hasOnlyAllowedKeys(rec, SUPERVISOR_LIFECYCLE_OWNER_ALLOWED_KEYS)
    || rec.schema !== SUPERVISOR_LIFECYCLE_OWNER_SCHEMA
    || !SUPERVISOR_LIFECYCLE_OWNER_STATE_ENUM.includes(rec.state)
    || rec.coordination_root_id !== coordinationRootId
    || typeof rec.worktree_id !== 'string' || rec.worktree_id.length === 0
    || typeof rec.plan_digest !== 'string' || rec.plan_digest.length === 0
    || typeof rec.session_generation_id !== 'string' || rec.session_generation_id.length === 0
    || typeof rec.action_id !== 'string' || rec.action_id.length === 0
    || !Array.isArray(rec.roles) || rec.roles.length === 0 || !rec.roles.every((r) => typeof r === 'string' && r.length > 0)
    || typeof rec.created_at !== 'string' || typeof rec.updated_at !== 'string'
    || (rec.state === 'TERMINATED' ? (typeof rec.failure_reason !== 'string' || rec.failure_reason.length === 0) : hasFailureReason)
  ) {
    return { ok: false, reason: 'supervisor-lifecycle-owner-shape-invalid' };
  }
  return { ok: true, state: rec.state, record: rec };
}

/**
 * CAS-verified state transition, mirroring `transitionRoleBinding`'s shape.
 * NEVER acquires its own lock -- every caller already holds
 * `supervisorLifecycleTxLockDirFor` for the SAME coordination_root_id, so a
 * self-contained lock here would either be redundant or (nested) deadlock.
 * @returns {{ok:true,record:object}|{ok:false,reason:string}}
 */
function transitionSupervisorLifecycleOwner(projectRootOrRepoId, coordinationRootId, fromState, toState, fromRecord, extraFields) {
  if (fromState === toState || !SUPERVISOR_LIFECYCLE_OWNER_STATE_ENUM.includes(toState)) {
    return { ok: false, reason: 'illegal-owner-transition' };
  }
  const recordPath = supervisorLifecycleOwnerPathFor(projectRootOrRepoId, coordinationRootId);
  const current = readRegistryRecord(recordPath);
  if (!current.ok) return { ok: false, reason: current.reason };
  if (current.absent || !current.obj || current.obj.action_id !== fromRecord.action_id || current.obj.state !== fromState) {
    return { ok: false, reason: 'stale-owner-read' };
  }
  const nextRecord = Object.assign({}, fromRecord, { state: toState, updated_at: nowIsoForRegistry() }, extraFields || {});
  const writeResult = writeRegistryRecordReplace(recordPath, Buffer.from(canonicalJSONStringify(nextRecord), 'utf8'));
  if (!writeResult.ok) return { ok: false, reason: writeResult.reason };
  return { ok: true, record: nextRecord };
}

/**
 * Point B.3: is the ACTIVE owner's own referenced action past its bounded
 * expiry (or gone entirely)? The SAME self-expiry idiom every other
 * authority artifact in this system already carries (grants, claims,
 * bindings) -- an owner marker is never authoritative for longer than the
 * one action it backs could possibly still be alive.
 * @returns {{ok:true,stale:boolean}|{ok:false,reason:string}}
 */
function isSupervisorLifecycleOwnerActionStale(projectRootOrRepoId, ownerRecord) {
  const actionRead = readRegistryRecord(actionPathFor(projectRootOrRepoId, ownerRecord.action_id));
  if (!actionRead.ok) return { ok: false, reason: actionRead.reason };
  if (actionRead.absent) return { ok: true, stale: true };
  const expiryMs = isoToMsForRegistry(actionRead.obj && actionRead.obj.expires_at);
  if (!Number.isFinite(expiryMs)) return { ok: true, stale: true };
  return { ok: true, stale: currentClockMsForRegistry() >= expiryMs };
}

/**
 * Point B.4/B.3: settle the owner marker for `coordinationRootId` IF it is
 * still the one this exact action_id minted -- never touch a record a
 * different, later batch has already superseded. Acquires the SAME
 * `supervisorLifecycleTxLockDirFor` lock a concurrent mint attempt would, as
 * a SEPARATE (non-nested) critical section from the caller's own
 * per-action role-binding lock: a brief window where role-bindings are
 * already terminal but the owner is not YET is benign (a racing ensure()
 * for THIS exact generation already sees terminal role-bindings and never
 * re-mints; only a DIFFERENT generation's mint could observe stale-ACTIVE
 * here, and its own staleness self-heal above covers that).
 * @returns {{ok:true,terminalized:boolean}|{ok:false,reason:string}}
 */
function terminalizeSupervisorLifecycleOwnerIfCurrent(projectRootOrRepoId, coordinationRootId, actionId, reason) {
  const lockDir = supervisorLifecycleTxLockDirFor(projectRootOrRepoId, coordinationRootId);
  const result = withRegistryLock(lockDir, () => {
    const ownerState = readSupervisorLifecycleOwnerState(projectRootOrRepoId, coordinationRootId);
    if (!ownerState.ok) return { ok: false, reason: ownerState.reason };
    if (ownerState.state !== 'ACTIVE' || ownerState.record.action_id !== actionId) {
      return { ok: true, terminalized: false };
    }
    const transitioned = transitionSupervisorLifecycleOwner(projectRootOrRepoId, coordinationRootId, 'ACTIVE', 'TERMINATED', ownerState.record, { failure_reason: reason });
    return transitioned.ok ? { ok: true, terminalized: true } : { ok: false, reason: transitioned.reason };
  }, { maxWaitMs: 2000 });
  if (!result.ok) return { ok: false, reason: result.reason };
  return result.value;
}

/**
 * Classify (is a supervisor already owned/being-established for this exact
 * coordination root), mint the ONE batched action, transition every
 * affected binding to STARTING, and publish/refresh the durable
 * SupervisorLifecycleOwner marker -- all inside a single lock. A partial
 * failure mid-transaction (e.g. a role-binding transition failing after the
 * action was already minted) rolls back EVERYTHING already done -- the
 * minted action file is deleted and any already-transitioned bindings are
 * quarantined -- before the lock releases, so no concurrent caller can ever
 * observe, and no retry can ever reference, an orphaned action.
 * @param {Array<{role:string,profileDigest:string,fromState:string,toState:string,fromRecord:object|null,respawnCount:number,driver:string}>} codexGroup
 * @returns {{ok:true,unavailable:boolean,actionId?:string,action?:object}|{ok:false,reason?:string}}
 */
function mintSupervisorBatchUnderTransaction(projectRoot, pair, repoId, worktreeId, planDigest, generationId, codexGroup, bindingExpiryIso) {
  const coordinationRootId = computeCoordinationRootId(projectRoot);
  const lockDir = supervisorLifecycleTxLockDirFor(projectRoot, coordinationRootId);
  const ownerPath = supervisorLifecycleOwnerPathFor(projectRoot, coordinationRootId);
  const result = withRegistryLock(lockDir, () => {
    // Fresh, lock-protected re-check -- never trust a pre-lock snapshot.
    const ownerState = readSupervisorLifecycleOwnerState(projectRoot, coordinationRootId);
    if (!ownerState.ok) return { ok: false, reason: ownerState.reason };

    let replacingSettledOwner = false;
    if (ownerState.state === 'ACTIVE') {
      const staleCheck = isSupervisorLifecycleOwnerActionStale(projectRoot, ownerState.record);
      if (!staleCheck.ok) return { ok: false, reason: staleCheck.reason };
      if (!staleCheck.stale) {
        return { ok: true, unavailable: true };
      }
      // Point B.3 self-heal: the owning action expired without ever being
      // explicitly resolved (crash) -- terminalize the stale owner right
      // here, under this SAME lock, before considering the root free.
      const healed = transitionSupervisorLifecycleOwner(projectRoot, coordinationRootId, 'ACTIVE', 'TERMINATED', ownerState.record, { failure_reason: 'stale-action-expired' });
      if (!healed.ok) return { ok: false, reason: healed.reason };
      replacingSettledOwner = true;
    } else if (ownerState.state === 'TERMINATED') {
      replacingSettledOwner = true;
    }
    // ownerState.state === 'ABSENT' -> replacingSettledOwner stays false (fresh create).

    // Test-only synchronous widening of this critical section, so a bats/
    // node:test can deterministically prove a SECOND real concurrent process
    // genuinely blocks on withRegistryLock rather than racing past it. Grants
    // no authority (timing only) -- single isTestCapability() gate is
    // sufficient, mirroring the bridge's own testAcquisitionDelayMs. Safe to
    // use a blocking sleep here (unlike session-run's long-lived acquisition
    // loop): `ensure` is a short-lived CLI invocation with no concurrent
    // signal-handling requirement to preserve.
    if (isTestCapability()) {
      const raw = process.env.RUNTIME_ROLE_LIFECYCLE_TEST_TX_DELAY_MS;
      const delayMs = raw ? parseInt(raw, 10) : NaN;
      if (Number.isFinite(delayMs) && delayMs > 0) {
        try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs); } catch (err) { /* best effort */ }
      }
    }

    const batched = mintBatchedSupervisorStartAction(projectRoot, pair, repoId, worktreeId, planDigest, generationId, codexGroup.map((s) => s.role), bindingExpiryIso);
    if (!batched.ok) return { ok: false, reason: 'mint-failed' };

    const transitioned = [];
    for (const spawn of codexGroup) {
      const t1 = transitionRoleBinding(projectRoot, worktreeId, planDigest, spawn.profileDigest, generationId, spawn.role, spawn.fromState, spawn.toState, spawn.fromRecord, { driver: spawn.driver, respawn_count: spawn.respawnCount, pending_action_id: batched.actionId });
      if (!t1.ok) {
        for (const t of transitioned) {
          transitionRoleBinding(projectRoot, worktreeId, planDigest, t.spawn.profileDigest, generationId, t.spawn.role, t.spawn.toState, 'QUARANTINED', t.record, { failure_reason: 'batch-sibling-transition-failed' });
        }
        try { fs.unlinkSync(actionPathFor(projectRoot, batched.actionId)); } catch (err) { /* best effort -- never fatal for a rollback */ }
        return { ok: false, reason: 'transition-failed' };
      }
      transitioned.push({ spawn, record: t1.record });
    }

    const ownerRecord = {
      schema: SUPERVISOR_LIFECYCLE_OWNER_SCHEMA,
      coordination_root_id: coordinationRootId,
      worktree_id: worktreeId,
      plan_digest: planDigest,
      session_generation_id: generationId,
      action_id: batched.actionId,
      roles: codexGroup.map((s) => s.role).sort(),
      state: 'ACTIVE',
      created_at: nowIsoForRegistry(),
      updated_at: nowIsoForRegistry(),
    };
    let publishOk = true;
    try {
      if (replacingSettledOwner) {
        // A prior batch at this SAME coordination root already definitively
        // settled (terminalized, just now or earlier) -- a plain no-clobber
        // create would wrongly EEXIST-reject the next legitimate batch.
        const replaced = writeRegistryRecordReplace(ownerPath, Buffer.from(canonicalJSONStringify(ownerRecord), 'utf8'));
        publishOk = replaced.ok;
      } else {
        const dirResult = ensureSecureRegistryDir(path.dirname(ownerPath));
        publishOk = dirResult.ok;
        if (publishOk) publishNoClobber(ownerPath, Buffer.from(canonicalJSONStringify(ownerRecord), 'utf8'), {});
      }
    } catch (err) {
      publishOk = false; // fall through to the shared rollback below
    }
    if (!publishOk) {
      // Structurally should be impossible (the prior state was just proven
      // under THIS SAME lock) -- fail closed and roll back rather than
      // proceed on an ambiguous durability outcome.
      for (const t of transitioned) {
        transitionRoleBinding(projectRoot, worktreeId, planDigest, t.spawn.profileDigest, generationId, t.spawn.role, t.spawn.toState, 'QUARANTINED', t.record, { failure_reason: 'owner-publish-failed' });
      }
      try { fs.unlinkSync(actionPathFor(projectRoot, batched.actionId)); } catch (err) { /* best effort */ }
      return { ok: false, reason: 'owner-publish-failed' };
    }

    return { ok: true, unavailable: false, actionId: batched.actionId, action: batched.action };
  }, { maxWaitMs: 2000 });
  if (!result.ok) return { ok: false, reason: result.reason };
  return result.value;
}

function mintBatchedSupervisorStartAction(projectRoot, pair, repoId, worktreeId, planDigest, generationId, roles, bindingExpiryIso) {
  const sortedUniqueRoles = Array.from(new Set(roles)).sort();
  const policyDigest = sha256String(canonicalJSONStringify(pair.routing));
  const actionId = generateActionId();
  const bridgePath = path.join(projectRoot, 'scripts', 'lib', 'runtime-bridge-codex.cjs');
  const coordRoot = coordinationRootPathFor(projectRoot);
  // Computed ONCE and reused byte-identically for both the action's own
  // expires_at and the embedded --session-expiry (point 4: they must be
  // EXACTLY the same instant, never two independent now()-based computations).
  const ttlResult = computeActionTtlSeconds(pair.policy, bindingExpiryIso);
  if (!ttlResult.ok) return { ok: false, reason: ttlResult.reason };
  const expiresAtIso = isoPlusSecondsForRegistry(nowIsoForRegistry(), ttlResult.ttlSeconds);
  const payload = buildSupervisorStartPayload(resolvedNodePath(), bridgePath, actionId, coordRoot, sortedUniqueRoles, expiresAtIso);
  const mintResult = mintRoleLifecycleAction(projectRoot, actionId, 'supervisor-start', 'host-process', repoId, worktreeId, planDigest, policyDigest, generationId, null, payload, expiresAtIso);
  if (!mintResult.ok) return { ok: false };
  return { ok: true, actionId: mintResult.actionId, action: mintResult.action };
}

/**
 * `rotate`'s own single-role "this role-binding needs a fresh connector"
 * step (ROTATING->REHYDRATING): selects a capability-proven driver, then
 * either transitions straight through to READY (`noop`) or mints the
 * matching closed action (a batch-of-one `supervisor-start` via
 * `mintBatchedSupervisorStartAction`, or a `role-spawn`) and leaves the
 * binding in REHYDRATING with `pending_action_id` recorded. Team-ensure
 * ordering does not apply here -- rotate only ever respawns an ALREADY
 * previously-READY binding, so a team-ensure must already have succeeded
 * the first time this role was spawned via `ensure`.
 * @returns {{ok:true,terminal:boolean,record:object,action:object|null}|{ok:false,unavailable?:boolean}}
 */
function spawnOrRehydrateSingleRole(projectRoot, pair, capabilityManifest, role, profileDigest, worktreeId, planDigest, generationId, fromState, toState, fromRecord, respawnCount, bindingExpiryIso) {
  // R4 NO-GO round 2 (point 3): rotate must reuse the EXACT same
  // lifecycle-eligible selector + noop consumer gate as ensure's pass 2
  // (points 3.2/3.3) -- a prior pass fixed ensure's driver-selection loop
  // but never touched this SEPARATE, rotate-only selection call, leaving it
  // with the SAME two bugs ensure had before that fix: falling through to a
  // dishonestly-labeled claude-native role-spawn for claude-agent/codex-mcp/
  // runtime-spawn (see the closed-enum check below), and declaring noop
  // unconditionally READY with zero registered-consumer check.
  const excludedDrivers = hasRegisteredValidatedDiskConsumer(role) ? [] : ['noop'];
  const driver = selectLifecycleEligibleDriverForRole(pair.routing, role, capabilityManifest, excludedDrivers);
  if (!driver) return { ok: false, unavailable: true };

  if (driver === 'noop') {
    // R4 round 2, point 4: a single atomic fromState->READY write (via the
    // toState waypoint, validated but never persisted) -- never the OLD
    // two-write fromState->toState->READY that left a durable,
    // pending_action_id-less waypoint record on disk.
    const t = transitionRoleBindingAtomicViaWaypoint(projectRoot, worktreeId, planDigest, profileDigest, generationId, role, fromState, toState, 'READY', fromRecord, { driver, respawn_count: respawnCount });
    if (!t.ok) return { ok: false };
    return { ok: true, terminal: true, record: t.record, action: null };
  }

  if (driver === 'codex-app-server') {
    // Point A: rotate must never mint a batch-of-one supervisor-start --
    // that would be a second retained supervisor racing whatever the
    // (possibly still-live) original one is doing. C1 has no real
    // control/rebind path to hand this role to an EXISTING supervisor yet
    // (that is C2's job) -- fail closed rather than fabricate one.
    return { ok: false, unavailable: true };
  }

  if (driver !== 'claude-sendmessage') {
    // Closed routing-driver enum minus the always-excluded
    // LIFECYCLE_INELIGIBLE_DRIVERS (selectLifecycleEligibleDriverForRole
    // already excludes claude-agent/codex-mcp/runtime-spawn) makes this
    // structurally unreachable -- fail closed rather than silently mint a
    // role-spawn action carrying a dishonest driver literal.
    return { ok: false };
  }

  const repoId = computeRepoId(projectRoot);
  let mintResult;
  {
    const policyDigest = sha256String(canonicalJSONStringify(pair.routing));
    const actionId = generateActionId();
    const payload = buildRoleSpawnPayload('wp3-support-plane', role, 'general-purpose', null, 'Execute `ready --action <id>`, read the validated bootstrap/bundle, then enter WAITING.');
    const ttlResult = computeActionTtlSeconds(pair.policy, bindingExpiryIso);
    if (!ttlResult.ok) return { ok: false, reason: ttlResult.reason };
    const expiresAtIso = isoPlusSecondsForRegistry(nowIsoForRegistry(), ttlResult.ttlSeconds);
    mintResult = mintRoleLifecycleAction(projectRoot, actionId, 'role-spawn', 'claude-native', repoId, worktreeId, planDigest, policyDigest, generationId, role, payload, expiresAtIso);
  }
  if (!mintResult.ok) return { ok: false };

  const t1 = transitionRoleBinding(projectRoot, worktreeId, planDigest, profileDigest, generationId, role, fromState, toState, fromRecord, { driver, respawn_count: respawnCount, pending_action_id: mintResult.actionId });
  if (!t1.ok) return { ok: false };
  return { ok: true, terminal: false, record: t1.record, action: mintResult.action };
}

// ─────────────────────────────────────────────────────────────────────────────
// WP3 item C, point A.3: team-ensure ordering (PLAN.md ~L167: "Claude orders
// team-ensure before role-spawn; failure suppresses the dependent spawn and
// triggers routing fallback" -- previously simplified to skip straight to
// role-spawn). A per-session-generation marker tracks whether a team-ensure
// action has already been minted: a repeat `ensure` call while it is still
// PENDING re-reports the SAME action_id (idempotent, never a second mint,
// mirroring the STARTING-state "re-report the pending action" idiom already
// used for role-bindings); `action-failed` on that action_id moves it to
// FAILED, after which affected roles report CAPABILITY_UNAVAILABLE rather
// than silently retrying forever ("routing fallback" -- a fresh `ensure` in
// a NEW session generation is the natural retry path, same as any other
// terminal-for-this-generation state elsewhere in this file). The mint
// itself cannot be awaited synchronously (the executor's TeamCreate call
// happens OUTSIDE this process) -- ordering is expressed by returning
// team-ensure FIRST in the `actions[]` array, per PLAN.md's own "ordered..."
// action-envelope contract; the executor's own sequencing contract (PLAN.md
// ~L165) is what actually suppresses the dependent Agent()/SendMessage calls
// on team-ensure failure.
// ─────────────────────────────────────────────────────────────────────────────

const TEAM_ENSURE_STATE_ENUM = Object.freeze(['PENDING', 'SUCCEEDED', 'FAILED']);
const TEAM_ENSURE_MARKER_SCHEMA = 'runtime/team-ensure-marker/v1';

// Marker path is keyed by BOTH session generation AND plan_digest -- a
// draft->final PLAN transition changes plan_digest, which by construction
// addresses a DISJOINT marker path (same structural-invalidation idiom as
// session_generation_id itself elsewhere in this file), so a marker bound to
// the OLD PLAN can never be silently reused after a PLAN change.
// WP3 item C correction pass R2 (point 5): worktree_id is part of the PATH,
// not merely the record's own cross-checked field -- two distinct worktrees
// of the same repo (same repoId) that happened to share a session
// generation and PLAN digest would otherwise collide on the SAME marker
// path despite being logically disjoint team-ensure contexts.
function teamEnsureMarkerPathFor(projectRootOrRepoId, generationId, worktreeId, planDigest) {
  return path.join(registryRepoDir(projectRootOrRepoId), 'team-ensures', generationId, worktreeId, planDigest + '.json');
}

/**
 * @returns {{ok:true,state:'ABSENT'}|{ok:true,state:'PENDING'|'SUCCEEDED'|'FAILED',record:object}|{ok:false,reason:string}}
 */
function readTeamEnsureState(repoDescriptor, generationId, worktreeId, planDigest) {
  const read = readRegistryRecord(teamEnsureMarkerPathFor(repoDescriptor, generationId, worktreeId, planDigest));
  if (!read.ok) return { ok: false, reason: read.reason };
  if (read.absent) return { ok: true, state: 'ABSENT' };
  const rec = read.obj;
  if (
    !rec || rec.schema !== TEAM_ENSURE_MARKER_SCHEMA || !TEAM_ENSURE_STATE_ENUM.includes(rec.state)
    // Defense in depth: cross-check the marker's OWN embedded scope against
    // the caller's expected scope, not merely trusting the path encoding.
    || rec.session_generation_id !== generationId || rec.worktree_id !== worktreeId || rec.plan_digest !== planDigest
  ) {
    return { ok: false, reason: 'team-ensure-marker-shape-invalid' };
  }
  return { ok: true, state: rec.state, record: rec };
}

/**
 * Locked check-then-mint: idempotently returns the current team-ensure state
 * for this exact (session generation, worktree, PLAN), minting a fresh
 * PENDING one only if none exists yet. Mirrors `resolveSessionGeneration`'s
 * own locked check-then-write idiom to close the same two-concurrent-callers
 * race. Reaching SUCCEEDED requires a SEPARATE call to
 * `registerTeamEnsureSuccess` (point C: minting PENDING alone never unlocks
 * dependent role-spawns).
 * @returns {{ok:true,state:'PENDING',actionId:string,action:object|null}|{ok:true,state:'SUCCEEDED'|'FAILED'}|{ok:false,reason:string}}
 */
function ensureTeamEnsureAction(projectRoot, repoId, worktreeId, planDigest, policyDigest, generationId, policy, bindingExpiryIso) {
  const lockDir = teamEnsureMarkerPathFor(projectRoot, generationId, worktreeId, planDigest) + '.lock';
  const result = withRegistryLock(lockDir, () => {
    const stateResult = readTeamEnsureState(projectRoot, generationId, worktreeId, planDigest);
    if (!stateResult.ok) return { ok: false, reason: stateResult.reason };
    if (stateResult.state === 'FAILED') return { ok: true, state: 'FAILED' };
    if (stateResult.state === 'SUCCEEDED') return { ok: true, state: 'SUCCEEDED', actionId: stateResult.record.pending_action_id };
    if (stateResult.state === 'PENDING') {
      const actionRead = readRegistryRecord(actionPathFor(projectRoot, stateResult.record.pending_action_id));
      return { ok: true, state: 'PENDING', actionId: stateResult.record.pending_action_id, action: (actionRead.ok && !actionRead.absent) ? actionRead.obj : null };
    }
    const actionId = generateActionId();
    const payload = buildTeamEnsurePayload('wp3-support-plane', 'WP3 persistent support plane');
    const ttlResult = computeActionTtlSeconds(policy, bindingExpiryIso);
    if (!ttlResult.ok) return { ok: false, reason: ttlResult.reason };
    const expiresAtIso = isoPlusSecondsForRegistry(nowIsoForRegistry(), ttlResult.ttlSeconds);
    const mintResult = mintRoleLifecycleAction(projectRoot, actionId, 'team-ensure', 'claude-native', repoId, worktreeId, planDigest, policyDigest, generationId, null, payload, expiresAtIso);
    if (!mintResult.ok) return { ok: false, reason: 'team-ensure-mint-failed' };
    const record = {
      schema: TEAM_ENSURE_MARKER_SCHEMA,
      session_generation_id: generationId,
      worktree_id: worktreeId,
      plan_digest: planDigest,
      pending_action_id: actionId,
      state: 'PENDING',
      created_at: nowIsoForRegistry(),
    };
    const writeResult = writeRegistryRecordReplace(teamEnsureMarkerPathFor(projectRoot, generationId, worktreeId, planDigest), Buffer.from(canonicalJSONStringify(record), 'utf8'));
    if (!writeResult.ok) return { ok: false, reason: writeResult.reason };
    return { ok: true, state: 'PENDING', actionId, action: mintResult.action };
  });
  if (!result.ok) return { ok: false, reason: result.reason };
  return result.value;
}

/**
 * Host-authority registration that team-ensure SUCCEEDED -- the capability
 * gate lives HERE (mirrors `mintSupervisorExecutionClaim`), not merely in a
 * wrapper. Only a CURRENT PENDING marker for `expectedActionId` may
 * transition (replay/stale/wrong-action rejected). Point 3.4 (R4): `ensure`
 * now eagerly mints role-spawn action(s) alongside a freshly-PENDING
 * team-ensure too (ordered after it) -- this registration is no longer a
 * PREREQUISITE for role-spawn to exist, only for the interpreter to know it
 * may proceed to actually EXECUTE (Agent-spawn) the already-minted one.
 * @returns {{ok:true}|{ok:false,reason:string}}
 */
function registerTeamEnsureSuccess(repoDescriptor, generationId, worktreeId, planDigest, expectedActionId) {
  if (!isFakeExecutorCapability()) return { ok: false, reason: 'fake-executor-capability-absent' };
  const lockDir = teamEnsureMarkerPathFor(repoDescriptor, generationId, worktreeId, planDigest) + '.lock';
  const locked = withRegistryLock(lockDir, () => {
    const stateResult = readTeamEnsureState(repoDescriptor, generationId, worktreeId, planDigest);
    if (!stateResult.ok) return { ok: false, reason: stateResult.reason };
    if (stateResult.state !== 'PENDING' || stateResult.record.pending_action_id !== expectedActionId) {
      return { ok: false, reason: 'team-ensure-not-current-pending' };
    }
    const record = Object.assign({}, stateResult.record, { state: 'SUCCEEDED', updated_at: nowIsoForRegistry() });
    return writeRegistryRecordReplace(teamEnsureMarkerPathFor(repoDescriptor, generationId, worktreeId, planDigest), Buffer.from(canonicalJSONStringify(record), 'utf8'));
  });
  const inner = locked.ok ? locked.value : { ok: false, reason: locked.reason };
  if (!inner.ok) return { ok: false, reason: inner.reason };
  return { ok: true };
}

/**
 * Finds every role-binding in this (worktree, plan, session) whose
 * `team_ensure_action_id` matches -- the dependents a team-ensure FAILURE
 * must terminalize (point C: "un fallo debe invalidar/transicionar todos
 * los bindings/actions dependientes"). Scans the closed `CANONICAL_ROLES`
 * set (bounded, cheap) rather than requiring a separate reverse index.
 * @returns {{ok:true,dependents:Array<{role:string,state:string,record:object}>}|{ok:false,reason:string}}
 */
function findRoleBindingsDependentOnTeamEnsure(repoDescriptor, worktreeId, planDigest, generationId, teamEnsureActionId) {
  const dependents = [];
  for (const role of CANONICAL_ROLES) {
    const profileDigest = roleProfileDigestFor(role);
    const stateResult = readRoleBindingState(repoDescriptor, worktreeId, planDigest, profileDigest, generationId, role);
    if (!stateResult.ok) return { ok: false, reason: stateResult.reason };
    if (stateResult.state === 'ABSENT') continue;
    if (stateResult.record && stateResult.record.team_ensure_action_id === teamEnsureActionId) {
      dependents.push({ role, state: stateResult.state, record: stateResult.record, profileDigest });
    }
  }
  return { ok: true, dependents };
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
 * registry-backed state machine in two passes: pass 1 classifies each role's
 * current state (READY/WAITING/BUSY collected directly; STARTING re-reports
 * its pending action, idempotent, never a second mint; QUARANTINED/STOPPED/
 * ROTATING/REHYDRATING mark CAPABILITY_UNAVAILABLE, restart-only recovery)
 * and collects ABSENT/DEAD/UNAVAILABLE roles needing a fresh connector
 * WITHOUT yet minting anything -- UNAVAILABLE alone is retryable WITHIN the
 * same generation (point 3.1), excluding exactly the driver that produced
 * it; pass 2 resolves each one's driver (pure lookup, always skipping
 * claude-agent/codex-mcp/runtime-spawn and a `noop` lacking a registered
 * consumer, point 3.2/3.3) and groups them so `codex-app-server` mints
 * exactly ONE batched `supervisor-start` action for its whole group
 * (PLAN.md ~L167), while Claude-native roles get a team-ensure action and
 * its dependent, team-ensure-ordered `role-spawn` action(s) together in
 * THIS SAME call (point 3.4) whenever team-ensure is PENDING or SUCCEEDED.
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

  const lifecycleBindingRef = parsed.values['--lifecycle-binding'];

  // R4 NO-GO round 2 (point 1): PLAN.md ~L150 -- "Every lifecycle command
  // requires the separate one-use lifecycle-command-grant/v1" -- with NO
  // carve-out for ensure. A prior pass kept ensure's pre-grant-enforcement
  // WP1 behavior (grantless EPHEMERAL_AVAILABLE/UNAVAILABLE by mode) even
  // after every OTHER lifecycle command was closed (point 1.1) -- a missing
  // grant must fail as an AUTHORITY error here too, never a degraded-but-OK
  // ephemeral success. Mirrors probe/status's own IDENTITY_MISMATCH shape.
  if (lifecycleBindingRef === undefined) {
    invalidError('ensure', 'IDENTITY_MISMATCH');
    return;
  }

  // A grant WAS supplied: attempt the real, registry-backed capability-proven
  // path. Order-independent binding scope (PLAN.md ~L748's own
  // {repo_id,profile,session_generation,canonical_role} framing) -- sorted
  // roles, never the literal repeated-flag order a caller happened to type.
  const sortedRoles = roles.slice().sort();
  const argvDigest = sha256String('ensure:' + sortedRoles.join(','));
  // PLAN.md ~L576's closed role union: a single canonical STRING for
  // single-role ensure, a sorted-unique ARRAY for multi-role -- never a
  // comma-joined string for either shape (point A.1 correction).
  const roleKey = sortedRoles.length === 1 ? sortedRoles[0] : sortedRoles;

  const consumeResult = validateAndConsumeLifecycleCommandGrant(projectRoot, lifecycleBindingRef, argvDigest, roleKey, 'ensure');
  if (!consumeResult.ok) {
    // Forged/replayed/expired/wrong-shape grant: never launder an invalid
    // grant into a "successful" response of any kind -- reject outright.
    invalidError('ensure', 'IDENTITY_MISMATCH');
    return;
  }
  const binding = consumeResult.binding;
  if (!attachDerivedSessionGenerationId(projectRoot, binding).ok) {
    invalidError('ensure', 'INTERNAL_ERROR');
    return;
  }

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

  // R4 NO-GO round 2 (point 1) fallout: eliminating grantless success (above)
  // left `ephemeral` mode's own PLAN.md ~L167 contract -- "ensure returns
  // EPHEMERAL_AVAILABLE and does not spawn/claim five READY peers" --
  // completely unreachable (it previously existed ONLY in the now-removed
  // grantless shortcut). A genuinely granted, identity-confirmed call must
  // still honor it: unconditionally, regardless of routing/capability,
  // never proceeding to pass 1/2's real driver resolution. `auto` is
  // DELIBERATELY excluded here -- unlike the old grantless path (which
  // treated auto/ephemeral identically because grantless could never do
  // better regardless of mode), a genuinely granted `auto` call now gets
  // its own real "richest capability-proven profile" resolution below.
  if (pair.policy.mode === 'ephemeral') {
    emitAndExit(makeResult('ensure', RC.OK, 'EPHEMERAL_AVAILABLE', 'NONE', [], []));
    return;
  }

  const capabilityManifest = getCapabilityManifest();
  const collectedActions = [];
  const collectedBindings = [];
  let sawActionRequired = false;
  let sawUnavailable = false;
  let hardError = false;

  // Pass 1: classify each role's current state; collect ABSENT/DEAD roles
  // needing a fresh connector WITHOUT yet minting anything (batching decision
  // happens in pass 2, once every role's fate is known).
  const pendingSpawns = [];
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

    if (stateResult.state === 'QUARANTINED' || stateResult.state === 'STOPPED' || stateResult.state === 'ROTATING' || stateResult.state === 'REHYDRATING') {
      // Terminal for this exact binding key (QUARANTINED/STOPPED) or already
      // mid-transition (ROTATING/REHYDRATING, driven by `rotate`/respawn --
      // ensure never races an in-flight rotation). Restart-invalidation (a
      // NEW session_generation_id) is the only recovery path for these.
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

    // Point 3.1 (R4): UNAVAILABLE is the one role-binding-level terminal
    // state that IS retryable within the SAME session generation -- a
    // prior driver-selection/action failure for THIS exact role, never a
    // respawn-budget/ambiguous-owner/explicit-stop terminality (those stay
    // QUARANTINED/STOPPED above, restart-only). The failed record's own
    // `driver` field (point 1.5: always present once persisted) is
    // extracted here so pass 2 can exclude exactly that ONE driver and
    // genuinely select the next routing-permitted, capability-proven one
    // -- never re-select the driver that JUST failed, never stay stuck
    // UNAVAILABLE for the rest of this generation merely because ONE
    // driver did.
    const fromState = stateResult.state; // 'ABSENT' | 'DEAD' | 'UNAVAILABLE'
    const toState = fromState === 'DEAD' ? 'REHYDRATING' : 'STARTING';
    const fromRecord = fromState === 'ABSENT' ? null : stateResult.record;
    const respawnCount = fromState === 'DEAD' ? ((stateResult.record.respawn_count || 0) + 1) : (fromState === 'UNAVAILABLE' ? (stateResult.record.respawn_count || 0) : 0);
    const excludeDriver = fromState === 'UNAVAILABLE' ? stateResult.record.driver : null;
    pendingSpawns.push({ role, profileDigest, fromState, toState, fromRecord, respawnCount, excludeDriver });
  }

  if (hardError) {
    invalidError('ensure', 'INTERNAL_ERROR');
    return;
  }

  // WP3 item C correction pass R2 (point 5): a team-ensure that has ALREADY
  // reached FAILED for this exact scope is terminal for `claude-sendmessage`
  // specifically -- retrying selectDriverForRole without accounting for that
  // history would keep re-selecting it (capability != history) and never
  // fall through to the next routing-permitted driver, leaving the role
  // UNAVAILABLE forever. Read-only, cheap (a single marker lookup) --
  // excluded by NAME (never by hiding it from the capability manifest,
  // which would make `noop` spuriously reachable past every other real
  // driver still later in the routing list).
  let driverExclusions;
  const teamEnsureFailedCheck = readTeamEnsureState(projectRoot, binding.session_generation_id, binding.worktree_id, binding.plan_digest);
  if (teamEnsureFailedCheck.ok && teamEnsureFailedCheck.state === 'FAILED') {
    driverExclusions = ['claude-sendmessage'];
  }

  // Pass 2: resolve a driver for each pending spawn (pure lookup, no
  // mutation). WP3 item C correction pass R3 (point C.1): the six routing
  // drivers are NOT interchangeable -- only `claude-sendmessage`
  // (team-ensure->role-spawn) and `codex-app-server` (supervisor-start) have
  // an ensure()-mintable persistent role-lifecycle-action at all (the CLOSED
  // action kind/runtime union, PLAN.md ~L154-163, has no member for any of
  // the other three). `claude-agent` is a one-shot, per-CONSULTATION-REQUEST
  // accelerator selected later by `dispatch` (PLAN.md ~L592/~L829) that
  // creates no READY/presence/reuse claim; `codex-mcp` is a separate
  // per-request MCP frontend to the SAME trusted Codex bridge, activated via
  // `claude-mcp-launch`, never `session-run` (PLAN.md ~L789); `runtime-spawn`
  // wakes an ALREADY-registered, externally-supervised disk consumer whose
  // binding its trusted owner creates directly, never through this lifecycle
  // registry (PLAN.md ~L586). Each of the six therefore gets its OWN
  // explicit branch -- never a shared catch-all bucket that (as a prior pass
  // did) would mint a fabricated `role-spawn`/`claude-native` action, with a
  // dishonest driver literal, for a role that actually resolved to
  // codex-mcp or runtime-spawn.
  const codexAppServerGroup = [];
  const claudeSendmessageGroup = [];
  for (const spawn of pendingSpawns) {
    // Point 3.1 (R4): a role re-entering this loop from UNAVAILABLE (a
    // prior driver-selection/action failure THIS SAME generation) excludes
    // exactly the ONE driver that just failed, on top of the batch-wide
    // `driverExclusions` and the always-ineligible/noop-consumer-gate
    // exclusions below -- never re-selects the driver that just failed,
    // never excludes a driver some OTHER role never even attempted.
    const perRoleExclusions = (driverExclusions || [])
      .concat(spawn.excludeDriver ? [spawn.excludeDriver] : [])
      .concat(hasRegisteredValidatedDiskConsumer(spawn.role) ? [] : ['noop']);
    const driver = selectLifecycleEligibleDriverForRole(pair.routing, spawn.role, capabilityManifest, perRoleExclusions);
    if (!driver) { sawUnavailable = true; continue; }
    if (driver === 'noop') {
      // R4 round 2, point 4: a single atomic fromState->READY write (via
      // the toState waypoint, validated but never persisted) -- never the
      // OLD two-write fromState->toState->READY that left a durable,
      // pending_action_id-less waypoint record on disk.
      const t = transitionRoleBindingAtomicViaWaypoint(projectRoot, binding.worktree_id, binding.plan_digest, spawn.profileDigest, binding.session_generation_id, spawn.role, spawn.fromState, spawn.toState, 'READY', spawn.fromRecord, { driver, respawn_count: spawn.respawnCount });
      if (!t.ok) { hardError = true; break; }
      collectedBindings.push(roleBindingForEnvelope(t.record));
      continue;
    }
    if (driver === 'codex-app-server') { codexAppServerGroup.push(Object.assign({ driver }, spawn)); continue; }
    if (driver === 'claude-sendmessage') { claudeSendmessageGroup.push(Object.assign({ driver }, spawn)); continue; }
    // Closed routing-driver enum (runtime-routing.json/isValidRouting) minus
    // the always-excluded LIFECYCLE_INELIGIBLE_DRIVERS
    // (selectLifecycleEligibleDriverForRole) makes this structurally
    // unreachable -- fail closed rather than silently drop an unrecognized
    // driver into an implicit bucket.
    hardError = true;
    break;
  }
  if (hardError) {
    invalidError('ensure', 'INTERNAL_ERROR');
    return;
  }

  // codex-app-server: at most ONE RETAINED supervisor per (worktree, plan,
  // session) -- point A's singleton invariant. WP3 item C correction pass R2
  // (point 1): classify+mint+transition+publish-owner all happen ATOMICALLY
  // under mintSupervisorBatchUnderTransaction's single lock -- never a
  // separate read-then-act check outside it, which is exactly the window
  // that let two concurrent ensure(disjoint-roles) calls both mint.
  if (codexAppServerGroup.length > 0) {
    const repoId = computeRepoId(projectRoot);
    const txResult = mintSupervisorBatchUnderTransaction(projectRoot, pair, repoId, binding.worktree_id, binding.plan_digest, binding.session_generation_id, codexAppServerGroup, binding.expiry);
    if (!txResult.ok) {
      invalidError('ensure', 'INTERNAL_ERROR');
      return;
    }
    if (txResult.unavailable) {
      sawUnavailable = true;
    } else {
      sawActionRequired = true;
      collectedActions.push(actionForEnvelope(txResult.action));
    }
  }

  // Claude-native: team-ensure-before-role-spawn ordering (PLAN.md ~L167:
  // "Claude orders team-ensure before role-spawn; failure suppresses the
  // dependent spawn"). Point 3.4 (R4): a SINGLE ensure() call now returns
  // BOTH, ordered team-ensure then role-spawn(s), whether team-ensure is
  // freshly PENDING or already SUCCEEDED -- eliminating the second
  // ensure()/grant round-trip a prior pass required the interpreter to
  // make ONLY to "unlock" role-spawn after registering team-ensure
  // SUCCEEDED out-of-band. Each role-spawn is stamped with
  // `team_ensure_action_id` regardless of team-ensure's CURRENT state, so
  // the pre-existing action-failed dependent-invalidation path (point C,
  // `findRoleBindingsDependentOnTeamEnsure`) still correctly quarantines
  // it if team-ensure is LATER explicitly failed. This is the safety net
  // that makes eager minting sound: PLAN.md ~L165 already forbids the
  // executor from "continu[ing] to a dependent action" once an earlier one
  // errors -- the interpreter is contractually required to execute
  // actions[] IN ORDER and never call role-spawn's Agent-spawn if its
  // ordered predecessor (TeamCreate) did not itself already succeed. The
  // core does not need to WITHHOLD MINTING role-spawn to enforce that; it
  // only needs the dependent-invalidation safety net for when the
  // interpreter correctly stops and reports action-failed instead.
  if (claudeSendmessageGroup.length > 0) {
    const repoId = computeRepoId(projectRoot);
    const policyDigest = sha256String(canonicalJSONStringify(pair.routing));
    const teamResult = ensureTeamEnsureAction(projectRoot, repoId, binding.worktree_id, binding.plan_digest, policyDigest, binding.session_generation_id, pair.policy, binding.expiry);
    if (!teamResult.ok) {
      invalidError('ensure', 'INTERNAL_ERROR');
      return;
    }
    if (teamResult.state === 'FAILED') {
      sawUnavailable = true;
    } else {
      // PENDING or SUCCEEDED: mint/return role-spawn action(s) too, in the
      // SAME call, ordered AFTER team-ensure's own action when it is
      // freshly PENDING. Role-spawn actions stay one-per-role (PLAN.md's
      // batching applies ONLY to the codex-app-server supervisor-start).
      sawActionRequired = true;
      if (teamResult.state === 'PENDING' && teamResult.action) collectedActions.push(actionForEnvelope(teamResult.action));
      const transitioned = [];
      for (const spawn of claudeSendmessageGroup) {
        const spawnPolicyDigest = sha256String(canonicalJSONStringify(pair.routing));
        const actionId = generateActionId();
        const payload = buildRoleSpawnPayload('wp3-support-plane', spawn.role, 'general-purpose', null, 'Execute `ready --action <id>`, read the validated bootstrap/bundle, then enter WAITING.');
        const spawnTtlResult = computeActionTtlSeconds(pair.policy, binding.expiry);
        if (!spawnTtlResult.ok) { hardError = true; break; }
        const spawnExpiresAtIso = isoPlusSecondsForRegistry(nowIsoForRegistry(), spawnTtlResult.ttlSeconds);
        const mintResult = mintRoleLifecycleAction(projectRoot, actionId, 'role-spawn', 'claude-native', repoId, binding.worktree_id, binding.plan_digest, spawnPolicyDigest, binding.session_generation_id, spawn.role, payload, spawnExpiresAtIso);
        if (!mintResult.ok) { hardError = true; break; }
        const t1 = transitionRoleBinding(projectRoot, binding.worktree_id, binding.plan_digest, spawn.profileDigest, binding.session_generation_id, spawn.role, spawn.fromState, spawn.toState, spawn.fromRecord, { driver: spawn.driver, respawn_count: spawn.respawnCount, pending_action_id: mintResult.actionId, team_ensure_action_id: teamResult.actionId });
        if (!t1.ok) { hardError = true; break; }
        transitioned.push({ spawn, record: t1.record });
        collectedActions.push(actionForEnvelope(mintResult.action));
      }
      if (hardError) {
        for (const t of transitioned) {
          transitionRoleBinding(projectRoot, binding.worktree_id, binding.plan_digest, t.spawn.profileDigest, binding.session_generation_id, t.spawn.role, t.spawn.toState, 'QUARANTINED', t.record, { failure_reason: 'batch-sibling-transition-failed' });
        }
        invalidError('ensure', 'INTERNAL_ERROR');
        return;
      }
    }
  }

  if (sawActionRequired) {
    // Dedup by action_id: a multi-role batch/re-report can push the SAME
    // action once per affected binding (STARTING re-report is per-binding);
    // the envelope must return one action PER action_id, never a copy per
    // binding (point A).
    const seenActionIds = new Set();
    const dedupedActions = collectedActions.filter((a) => {
      if (seenActionIds.has(a.action_id)) return false;
      seenActionIds.add(a.action_id);
      return true;
    });
    emitAndExit(makeResult('ensure', RC.OK, 'ACTION_REQUIRED', 'NONE', collectedBindings, dedupedActions));
    return;
  }
  if (sawUnavailable) {
    unavailableError('ensure', 'CAPABILITY_UNAVAILABLE');
    return;
  }
  emitAndExit(makeResult('ensure', RC.OK, 'READY', 'NONE', collectedBindings, []));
}

/**
 * Scans every canonical role for a LIVE/PENDING binding whose driver is
 * `codex-app-server` -- point A's singleton check: at most one retained
 * supervisor per (worktree, plan, session), regardless of which role
 * originally spawned it. Bounded (10 canonical roles), cheap.
 * @returns {{ok:true,found:false}|{ok:true,found:true,role:string,pendingActionId:string|null}|{ok:false,reason:string}}
 */
function findExistingSupervisorBinding(repoDescriptor, worktreeId, planDigest, generationId) {
  for (const role of CANONICAL_ROLES) {
    const profileDigest = roleProfileDigestFor(role);
    const stateResult = readRoleBindingState(repoDescriptor, worktreeId, planDigest, profileDigest, generationId, role);
    if (!stateResult.ok) return { ok: false, reason: stateResult.reason };
    const rec = stateResult.record;
    if (
      rec && rec.driver === 'codex-app-server'
      && (stateResult.state === 'STARTING' || stateResult.state === 'REHYDRATING' || stateResult.state === 'READY' || stateResult.state === 'WAITING' || stateResult.state === 'BUSY')
    ) {
      return { ok: true, found: true, role, pendingActionId: rec.pending_action_id || null };
    }
  }
  return { ok: true, found: false };
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
  if (!attachDerivedSessionGenerationId(projectRoot, binding).ok) {
    invalidError('notify', 'INTERNAL_ERROR');
    return;
  }

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
  const notifyTtlResult = computeActionTtlSeconds(pair.policy, binding.expiry);
  if (!notifyTtlResult.ok) {
    invalidError('notify', 'INTERNAL_ERROR');
    return;
  }
  const notifyExpiresAtIso = isoPlusSecondsForRegistry(nowIsoForRegistry(), notifyTtlResult.ttlSeconds);
  const mintResult = mintRoleLifecycleAction(projectRoot, actionId, 'role-notify', 'claude-native', computeRepoId(projectRoot), binding.worktree_id, binding.plan_digest, policyDigest, binding.session_generation_id, role, payload, notifyExpiresAtIso);
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
 * Point B: correlates the EXACT role set from a `supervisor-start` action's
 * own `bridge_argv` (repeated `--role` flags) and atomically terminalizes
 * every STARTING/REHYDRATING binding still pending on THIS action -- never
 * leaves one hanging just because a sibling role in the same batch already
 * resolved independently. Shared by `handleActionFailed`'s own supervisor-
 * start branch AND `session-run` itself (point B: "si el execution claim ya
 * fue consumido y owner acquisition falla, la acción termina de forma
 * recuperable/fail-closed" -- the bridge calls this directly, in-process,
 * rather than shelling back out to the `action-failed` CLI).
 * @param {object} action
 * @param {string} reason - ACTION_FAILED_REASON_ENUM member.
 * @returns {{ok:true,anyTerminalized:boolean}|{ok:false,reason:string}}
 */
/**
 * WP3 item C correction pass R2 (point 2): batch terminalization runs under
 * a SINGLE lock scoped to this exact action -- never independent per-role
 * writes with no shared state, which let one role's transient failure
 * silently strand the REMAINING roles (a mid-loop `return` never even
 * attempted them). Under the lock, EVERY role is attempted regardless of
 * an individual failure (never stop at the first one), and success for a
 * role that reached its terminal state is never rolled back merely because
 * a sibling failed -- that transition was correct and durable on its own.
 * The existing per-role idempotent skip (a role already resolved/superseded
 * for this action is left alone) makes this function naturally safe to
 * retry: a caller that sees `ok:false` can call it again and only the
 * still-outstanding roles are retried, never a role already terminalized.
 */
function terminalizeSupervisorStartAction(action, reason) {
  const repoDescriptor = { repoId: action.repo_id };
  const bridgeArgv = action.payload && action.payload.bridge_argv;
  if (!Array.isArray(bridgeArgv)) return { ok: false, reason: 'action-payload-malformed' };
  const roles = [];
  for (let i = 0; i < bridgeArgv.length - 1; i++) {
    if (bridgeArgv[i] === '--role') roles.push(bridgeArgv[i + 1]);
  }
  if (roles.length === 0) return { ok: false, reason: 'no-roles-in-payload' };

  const lockDir = path.join(registryRepoDir(repoDescriptor), 'terminalize-locks', action.action_id + '.lock');
  const result = withRegistryLock(lockDir, () => {
    let anyTerminalized = false;
    let anyFailed = false;
    for (const role of roles) {
      const profileDigest = roleProfileDigestFor(role);
      const stateResult = readRoleBindingState(repoDescriptor, action.worktree_id, action.plan_digest, profileDigest, action.session_generation_id, role);
      if (!stateResult.ok) { anyFailed = true; continue; }
      if (
        (stateResult.state !== 'STARTING' && stateResult.state !== 'REHYDRATING')
        || !stateResult.record || stateResult.record.pending_action_id !== action.action_id
      ) {
        continue; // already resolved/superseded for this role -- not fatal for the others.
      }
      const toState = stateResult.state === 'STARTING' ? 'UNAVAILABLE' : 'QUARANTINED';
      const transition = transitionRoleBinding(repoDescriptor, action.worktree_id, action.plan_digest, profileDigest, action.session_generation_id, role, stateResult.state, toState, stateResult.record, { failure_reason: reason });
      if (!transition.ok) { anyFailed = true; continue; }
      anyTerminalized = true;
    }
    if (anyFailed) return { ok: false, reason: 'ambiguous' };
    return { ok: true, anyTerminalized };
  }, { maxWaitMs: 2000 });
  if (!result.ok) return { ok: false, reason: result.reason };

  // Point B.4/2.3/2.4 (R4-hardened): terminalize the corresponding
  // coordination-root-anchored owner/intent record too -- reusing the SAME
  // cross-generation singleton scope point B.1 anchors minting to, so a
  // LATER ensure (same or a different session generation) is never
  // blocked by a batch that has already definitively failed.
  //
  // Point 2.3: this ATTEMPT is gated on `anyTerminalized` -- a pure REPLAY
  // (every role was already resolved/superseded, nothing new happened in
  // the lock above) touches the owner record NOT AT ALL, never even a
  // read-only no-op probe. A caller can only ever terminalize the owner
  // by ACTUALLY terminalizing the action's current, live role-bindings in
  // THIS SAME call.
  //
  // Point 2.4: a genuine owner-transition FAILURE now PROPAGATES as this
  // function's own `{ok:false}` -- never best-effort-swallowed. The
  // role-binding transitions above already committed durably and are
  // never rolled back merely because this LATER, separate step failed
  // (they were correct and complete on their own); but the CALLER must
  // still be told the owner side did not fully settle, rather than
  // silently reporting overall success while the coordination root
  // remains ambiguously ACTIVE.
  if (result.value.anyTerminalized) {
    let coordRootFromArgv = null;
    for (let i = 0; i < bridgeArgv.length - 1; i++) {
      if (bridgeArgv[i] === '--coordination-root') { coordRootFromArgv = bridgeArgv[i + 1]; break; }
    }
    if (typeof coordRootFromArgv === 'string' && coordRootFromArgv.length > 0) {
      const ownerResult = terminalizeSupervisorLifecycleOwnerIfCurrent(repoDescriptor, computeCoordinationRootIdFromPath(coordRootFromArgv), action.action_id, reason);
      if (!ownerResult.ok) return { ok: false, reason: 'owner-termination-failed:' + ownerResult.reason };
    }
  }

  return result.value;
}

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
  const repoDescriptor = { repoId: action.repo_id };

  // Point 1.1 (R4): every lifecycle command requires a grant. `role` is the
  // action's own embedded role (null for team-ensure/supervisor-start,
  // matching PLAN.md ~L576's closed role union for a current team/
  // supervisor action). `action-failed` is always reported by the
  // orchestrator, never a target (PLAN.md ~L165's "the executor calls
  // granted action-failed") -- binding_kind/authority are validated as
  // main-orchestrator/orchestrator inside validateAndConsumeLifecycleCommandGrant.
  const lifecycleBindingRef = parsed.values['--lifecycle-binding'];
  if (lifecycleBindingRef === undefined) {
    invalidError('action-failed', 'IDENTITY_MISMATCH');
    return;
  }
  const argvDigest = sha256String('action-failed:' + actionId + ':' + reason);
  const consumeResult = validateAndConsumeLifecycleCommandGrant(repoDescriptor, lifecycleBindingRef, argvDigest, action.role, 'action-failed', actionId);
  if (!consumeResult.ok) {
    invalidError('action-failed', 'IDENTITY_MISMATCH');
    return;
  }
  const binding = consumeResult.binding;
  const actionFailedGenResult = peekSessionGeneration(repoDescriptor, { provider: binding.runtime, runtime_session_key: binding.runtime_session_key });
  if (
    binding.worktree_id !== action.worktree_id
    || binding.plan_digest !== action.plan_digest
    || !actionFailedGenResult.ok || actionFailedGenResult.generationId !== action.session_generation_id
  ) {
    invalidError('action-failed', 'IDENTITY_MISMATCH');
    return;
  }

  if (action.role === null) {
    if (action.kind === 'team-ensure') {
      const lockDir = teamEnsureMarkerPathFor(repoDescriptor, action.session_generation_id, action.worktree_id, action.plan_digest) + '.lock';
      const locked = withRegistryLock(lockDir, () => {
        const stateResult = readTeamEnsureState(repoDescriptor, action.session_generation_id, action.worktree_id, action.plan_digest);
        if (!stateResult.ok) return { ok: false, reason: stateResult.reason };
        if (stateResult.state !== 'PENDING' || stateResult.record.pending_action_id !== actionId) {
          // Not the current live pending team-ensure -- already resolved,
          // superseded, or never was; fails closed, never guesses.
          return { ok: false, reason: 'not-current-pending' };
        }
        const record = Object.assign({}, stateResult.record, { state: 'FAILED', failure_reason: reason, updated_at: nowIsoForRegistry() });
        return writeRegistryRecordReplace(teamEnsureMarkerPathFor(repoDescriptor, action.session_generation_id, action.worktree_id, action.plan_digest), Buffer.from(canonicalJSONStringify(record), 'utf8'));
      });
      const result = locked.ok ? locked.value : { ok: false, reason: locked.reason };
      if (!result.ok) {
        invalidError('action-failed', 'ACTION_REPLAY');
        return;
      }
      // Point C: a team-ensure failure must invalidate/transition every
      // DEPENDENT role-spawn binding, never leave one hanging in STARTING
      // referencing a team-ensure that will never succeed.
      const dependentsResult = findRoleBindingsDependentOnTeamEnsure(repoDescriptor, action.worktree_id, action.plan_digest, action.session_generation_id, actionId);
      if (!dependentsResult.ok) {
        invalidError('action-failed', 'INTERNAL_ERROR');
        return;
      }
      for (const dep of dependentsResult.dependents) {
        if (dep.state !== 'STARTING' && dep.state !== 'REHYDRATING') continue;
        const toState = dep.state === 'STARTING' ? 'UNAVAILABLE' : 'QUARANTINED';
        transitionRoleBinding(repoDescriptor, action.worktree_id, action.plan_digest, dep.profileDigest, action.session_generation_id, dep.role, dep.state, toState, dep.record, { failure_reason: 'team-ensure-failed' });
      }
      unavailableError('action-failed', ACTION_FAILED_REASON_TO_DETAIL[reason]);
      return;
    }
    if (action.kind === 'supervisor-start') {
      const result = terminalizeSupervisorStartAction(action, reason);
      if (!result.ok) {
        invalidError('action-failed', result.reason === 'ambiguous' ? 'AMBIGUOUS_OWNER' : 'INTERNAL_ERROR');
        return;
      }
      if (!result.anyTerminalized) {
        invalidError('action-failed', 'ACTION_REPLAY');
        return;
      }
      unavailableError('action-failed', ACTION_FAILED_REASON_TO_DETAIL[reason]);
      return;
    }
    invalidError('action-failed', 'NONE');
    return;
  }

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
  const consumeResult = validateAndConsumeLifecycleCommandGrant(repoDescriptor, lifecycleBindingRef, argvDigest, action.role, 'ready', actionId);
  if (!consumeResult.ok) {
    invalidError('ready', 'IDENTITY_MISMATCH');
    return;
  }
  const binding = consumeResult.binding;
  // R4 round 3 (block 1a): `ready` is the only role-actor+target
  // subcommand, so `consumeResult.bindingKind` is always 'role-actor' here
  // in practice -- branched explicitly (rather than assumed) so a future
  // caller of this same code shape is never silently wrong. RoleActorBinding
  // stores session_generation_id directly (no hook-observed runtime tuple to
  // re-derive it from in this wave, unlike MainOrchestratorBinding -- see
  // the RoleActorBinding/v1 section header); the main-orchestrator branch
  // is UNCHANGED from before (PLAN.md ~L574: the binding never carries
  // session_generation_id -- re-derive fresh from its own (runtime,
  // runtime_session_key) tuple. Point A.4: lookup-only).
  let readyGenerationId;
  if (consumeResult.bindingKind === 'role-actor') {
    readyGenerationId = binding.session_generation_id;
  } else {
    const readyGenResult = peekSessionGeneration(repoDescriptor, { provider: binding.runtime, runtime_session_key: binding.runtime_session_key });
    if (!readyGenResult.ok) {
      invalidError('ready', 'IDENTITY_MISMATCH');
      return;
    }
    readyGenerationId = readyGenResult.generationId;
  }
  if (
    binding.worktree_id !== action.worktree_id
    || binding.plan_digest !== action.plan_digest
    || readyGenerationId !== action.session_generation_id
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

  // R4 NO-GO round 2 (point 1) + R4 round 3 (block 1c, corrected round 4):
  // every lifecycle command requires a grant (PLAN.md ~L150), and a
  // missing/invalid one is an AUTHORITY failure -- never disguised as an
  // ordinary WAIT_TIMEOUT/READY_TIMEOUT. Checked BEFORE the action lookup
  // below so that a grantless caller can never reach ANY
  // WAIT_TIMEOUT/READY_TIMEOUT response.
  const lifecycleBindingRef = parsed.values['--lifecycle-binding'];
  if (lifecycleBindingRef === undefined) {
    invalidError('wait-ready', 'IDENTITY_MISMATCH');
    return;
  }

  const found = findActionAcrossRepos(actionId);
  if (!found.ok) {
    invalidError('wait-ready', 'INTERNAL_ERROR');
    return;
  }
  if (found.absent) {
    // Round 4 correction: a NONEXISTENT action is never an "authorized
    // wait" at all -- there is no action_id for ANY grant to have been
    // genuinely minted against (a real `ensure` call always mints the
    // action BEFORE ever handing a caller a grant reference to it), so
    // authority can never be verified either way. Reject outright, BEFORE
    // the grants/ registry is ever even consulted -- no grant is
    // examined, and certainly none is consumed. The prior design (cross-
    // repo-scan for a grant self-referentially echoing its OWN role back as
    // the "expected" one) accepted and CONSUMED a one-use grant against a
    // phantom action_id merely because the grant happened to be internally
    // well-formed -- masking the absence rather than honestly rejecting it.
    invalidError('wait-ready', 'IDENTITY_MISMATCH');
    return;
  }
  const action = found.action;
  const repoDescriptor = { repoId: action.repo_id };

  const argvDigest = sha256String('wait-ready:' + actionId);
  const consumeResult = validateAndConsumeLifecycleCommandGrant(repoDescriptor, lifecycleBindingRef, argvDigest, action.role, 'wait-ready', actionId);
  if (!consumeResult.ok) {
    invalidError('wait-ready', 'IDENTITY_MISMATCH');
    return;
  }

  // Authority is now proven -- ONLY past this point may a null-role action
  // (team-ensure/supervisor-start, which never creates a pending-READY
  // expectation) legitimately resolve to the ordinary liveness answer. The
  // action genuinely EXISTS here (found.absent already returned above), so
  // action.repo_id/action.role are both real and a grant COULD legitimately
  // have been minted against it (e.g. ensure's own wait-ready grant for a
  // pending team-ensure, minted with role:null).
  if (action.role === null) {
    emitAndExit(makeResult('wait-ready', RC.WAIT_TIMEOUT, 'WAITING', 'READY_TIMEOUT', [], []));
    return;
  }

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
  if (!attachDerivedSessionGenerationId(projectRoot, binding).ok) {
    invalidError('rotate', 'INTERNAL_ERROR');
    return;
  }

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
  const spawnResult = spawnOrRehydrateSingleRole(projectRoot, pair, capabilityManifest, role, profileDigest, binding.worktree_id, binding.plan_digest, binding.session_generation_id, 'ROTATING', 'REHYDRATING', toRotating.record, respawnCount, binding.expiry);
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
  if (!attachDerivedSessionGenerationId(projectRoot, binding).ok) {
    invalidError('stop-owned', 'INTERNAL_ERROR');
    return;
  }

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
  const stopTtlResult = computeActionTtlSeconds(pair.policy, binding.expiry);
  if (!stopTtlResult.ok) {
    invalidError('stop-owned', 'INTERNAL_ERROR');
    return;
  }
  const stopExpiresAtIso = isoPlusSecondsForRegistry(nowIsoForRegistry(), stopTtlResult.ttlSeconds);
  const mintResult = mintRoleLifecycleAction(projectRoot, actionId, isCodex ? 'supervisor-stop-owned' : 'role-stop-owned', isCodex ? 'host-process' : 'claude-native', computeRepoId(projectRoot), binding.worktree_id, binding.plan_digest, policyDigest, binding.session_generation_id, role, payload, stopExpiresAtIso);
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
  coordinationRootPathFor,
  computeCoordinationRootId,
  computeCoordinationRootIdFromPath,
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
peekSessionGeneration,
isCanonicalIsoUtc,
  isHexActionId,
  isHexDigest64,
  sessionGenerationPathFor,
  createMainOrchestratorBinding,
  rebindMainOrchestratorBindingForNewPlan,
  mainOrchestratorBindingPathFor,
  createRoleActorBinding,
  validateRoleActorBindingFor,
  roleActorBindingPathFor,
  mintLifecycleCommandGrant,
  validateAndConsumeLifecycleCommandGrant,
  grantPathFor,
  grantConsumedMarkerPathFor,
  // WP3 state machine / capability / action generation internals.
  ROLE_BINDING_STATE_ENUM,
  ROLE_BINDING_TRANSITIONS,
  roleBindingPathFor,
  readRoleBindingState,
  transitionRoleBinding,
  transitionRoleBindingUnchecked,
  transitionRoleBindingAtomicViaWaypoint,
  validateRoleBindingRecordForScope,
  getCapabilityManifest,
  selectDriverForRole,
  ACTION_KIND_ENUM,
  generateActionId,
  mintRoleLifecycleAction,
  actionForEnvelope,
  actionPathFor,
  findActionAcrossRepos,
  mintBatchedSupervisorStartAction,
  spawnOrRehydrateSingleRole,
  teamEnsureMarkerPathFor,
  readTeamEnsureState,
  ensureTeamEnsureAction,
  buildTeamEnsurePayload,
  buildRoleSpawnPayload,
  buildRoleRebindClaudeNativePayload,
  buildRoleRebindHostProcessPayload,
  buildRoleNotifyPayload,
  buildRoleStopOwnedPayload,
  buildSupervisorStartPayload,
  buildSupervisorStopOwnedPayload,
  resolvedNodePath,
  computeActionTtlSeconds,
  fakeHostExecutorExecute,
  // WP3 item C: SupervisorExecutionClaim/v1 -- the distinct third authority
  // (see the section header above) `session-run` must validate before any
  // other registry write.
  EXECUTION_CLAIM_SCHEMA,
  EXECUTION_CLAIM_KEYS,
  executionClaimPathFor,
  mintSupervisorExecutionClaim,
  validateAndConsumeExecutionClaim,
  validateMainOrchestratorBindingFor,
  hasExactKeys,
hasOnlyAllowedKeys,
ROLE_BINDING_ALLOWED_KEYS,
  // WP3 item C correction pass: singleton supervisor enforcement, team-ensure
  // SUCCEEDED gate and dependent invalidation.
  findExistingSupervisorBinding,
  TEAM_ENSURE_STATE_ENUM,
  registerTeamEnsureSuccess,
  findRoleBindingsDependentOnTeamEnsure,
  // WP3 item C correction pass R2 (point 1), hardened R3 (points B.1/B.3/B.4):
  // SupervisorLifecycleTransaction -- coordination_root_id-anchored,
  // cross-generation singleton with an explicit recoverable owner/intent
  // state machine.
  SUPERVISOR_LIFECYCLE_OWNER_SCHEMA,
  SUPERVISOR_LIFECYCLE_OWNER_STATE_ENUM,
  SUPERVISOR_LIFECYCLE_OWNER_ALLOWED_KEYS,
  supervisorLifecycleTxLockDirFor,
  supervisorLifecycleOwnerPathFor,
  readSupervisorLifecycleOwnerState,
  transitionSupervisorLifecycleOwner,
  isSupervisorLifecycleOwnerActionStale,
  terminalizeSupervisorLifecycleOwnerIfCurrent,
  mintSupervisorBatchUnderTransaction,
  terminalizeSupervisorStartAction,
};

if (require.main === module) {
  main(process.argv.slice(2));
}
