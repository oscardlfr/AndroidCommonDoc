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
const FORBIDDEN_FLAGS = Object.freeze([
  '--lifecycle-binding',
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
    },
  },
  notify: {
    flags: {
      '--project-root': { required: true, repeatable: false },
      '--role': { required: true, repeatable: false },
      '--artifact': { required: true, repeatable: false },
      '--kind': { required: true, repeatable: false },
    },
  },
  'action-failed': {
    flags: {
      '--action': { required: true, repeatable: false },
      '--reason': { required: true, repeatable: false },
    },
  },
  ready: { flags: { '--action': { required: true, repeatable: false } } },
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
    },
  },
  'stop-owned': {
    flags: {
      '--project-root': { required: true, repeatable: false },
      '--role': { required: true, repeatable: false },
      '--reason': { required: true, repeatable: false },
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

/**
 * `ensure --project-root <absolute> --role <role> [--role <role>...]` --
 * idempotently return healthy bindings or an ordered set of host-native actions;
 * repeated roles/unknown roles rejected (no partial ensure). This WP1 skeleton never
 * proves a live connector, so it always resolves to the policy-mode-driven
 * fail-closed/graceful outcome documented in the module header rather than
 * fabricating a binding.
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
  if (mode === 'persistent' || mode === 'disk-only') {
    unavailableError('ensure', 'CAPABILITY_UNAVAILABLE');
    return;
  }
  // auto|ephemeral: no live persistent connector is ever proven in this bare WP1
  // skeleton, so both modes gracefully degrade to the same ephemeral one-shot
  // availability claim (PLAN.md ~L152: "EPHEMERAL_AVAILABLE is legal only for
  // `ensure` under `auto|ephemeral`"; ~L112: "`auto` ... falls back without changing
  // artifact semantics"). Empty bindings/actions: no pre-spawn claim.
  emitAndExit(makeResult('ensure', RC.OK, 'EPHEMERAL_AVAILABLE', 'NONE', [], []));
}

// ── notify (Frozen CLI ABI, PLAN.md ~L142) ──────────────────────────────────────

const NOTIFY_KIND_ENUM = Object.freeze(['ingestion-request', 'session-control']);

/**
 * `notify --project-root <absolute> --role <role> --artifact <canonical-coordination-artifact>
 * --kind <ingestion-request|session-control>` -- validate the already-durable
 * artifact and return one lifecycle wake action. Consultation uses the separate
 * `ActivationAction/v1`, never this command.
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

  emitAndExit(makeResult('notify', RC.OK, 'ACTION_REQUIRED', 'NONE', [], []));
}

// ── action-failed / ready / wait-ready (Frozen CLI ABI, PLAN.md ~L143-145) ──────

const ACTION_FAILED_REASON_ENUM = Object.freeze(['capability-unavailable', 'native-tool-error', 'deadline']);

/**
 * `action-failed --action <32+-hex> --reason <capability-unavailable|native-tool-error|deadline>`
 * -- consume one pending action as failed and make the connector eligible for policy
 * fallback. This WP1 skeleton has no persistent action registry, so every action id
 * is necessarily a zero-roster-match (PLAN.md ~L169 "zero/multiple roster matches").
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

  invalidError('action-failed', 'NONE');
}

/**
 * `ready --action <32+-hex>` -- target-side first bootstrap call; gated identity
 * correlation may transition the pending role to READY. Zero registry match in this
 * WP1 skeleton (PLAN.md ~L169).
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

  invalidError('ready', 'NONE');
}

/**
 * `wait-ready --action <32+-hex> --timeout <1..120>` -- bounded read-only wait for
 * observed start plus gated READY; tool success/message text alone never satisfies
 * it. A never-minted action can structurally never become READY in this WP1
 * skeleton (no registry at all), so this resolves immediately -- it never sleeps for
 * the requested timeout window -- to the deterministic non-match outcome.
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

  emitAndExit(makeResult('wait-ready', RC.WAIT_TIMEOUT, 'WAITING', 'READY_TIMEOUT', [], []));
}

// ── rotate (Frozen CLI ABI, PLAN.md ~L147) ──────────────────────────────────────

/**
 * `rotate --project-root <absolute> --role <role>` -- invalidate one owned unhealthy
 * binding and return the next policy-permitted action. No binding registry exists in
 * this WP1 skeleton, so every role is necessarily unowned; fails closed rather than
 * fabricating a respawn.
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

  unavailableError('rotate', 'CAPABILITY_UNAVAILABLE');
}

// ── stop-owned (Frozen CLI ABI, PLAN.md ~L148) ──────────────────────────────────

const STOP_OWNED_REASON_ENUM = Object.freeze(['rotation', 'session-close', 'operator']);

/**
 * `stop-owned --project-root <absolute> --role <role> --reason <rotation|session-close|operator>`
 * -- return a stop action only for a binding created/owned by the current session
 * generation. No binding registry exists in this WP1 skeleton, so no role is ever
 * owned; fails closed rather than addressing an unowned/ambiguous peer.
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

  unavailableError('stop-owned', 'CAPABILITY_UNAVAILABLE');
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
};

if (require.main === module) {
  main(process.argv.slice(2));
}
