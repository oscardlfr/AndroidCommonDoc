'use strict';

// Extracted behaviorally from runtime-role-lifecycle.cjs: closed
// runtime-collaboration-policy (v1/v2) and runtime-routing/v1 schema
// validation (PLAN.md ~L88-119, ~L1090-1112), plus the pair-atomic
// policy/routing resolver (PLAN.md ~L108-110) that ties them together.
// Never requires the facade or a sibling module.

function createPolicySchema({
  fs, path, facadeDirname, CANONICAL_ROLES,
}) {
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
 * @param {unknown} value
 * @param {number} min
 * @param {number} max
 * @returns {boolean} true when `value` is an integer Number within [min,max].
 */
function isIntInRangeNum(value, min, max) {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
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
 * Validates the closed policy successor used by the shared collaboration
 * entrypoints. The v1 validator above deliberately remains unchanged.
 * @param {unknown} obj
 * @returns {boolean}
 */
function isValidPolicyV2(obj) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return false;
  const expectedKeys = [...POLICY_REQUIRED_KEYS, 'selection'];
  const hasNativeStartupBudget = Object.prototype.hasOwnProperty.call(obj, 'claude_native_startup_timeout_seconds');
  // The supervisor's own startup budget, admitted on exactly the same terms as the native one
  // directly above: optional, bounded to the same 1..600 range, and absent from the shipped policy
  // so the default applies unless an operator deliberately sets it. A startup action needs a
  // budget separate from ready_timeout_seconds because that value governs a correlation window,
  // not the time a real host takes to bring a worker up.
  const hasSupervisorStartupBudget = Object.prototype.hasOwnProperty.call(obj, 'codex_supervisor_startup_timeout_seconds');
  const optionalKeyCount = (hasNativeStartupBudget ? 1 : 0) + (hasSupervisorStartupBudget ? 1 : 0);
  if (Object.keys(obj).length !== expectedKeys.length + optionalKeyCount) return false;
  if (!expectedKeys.every((key) => Object.prototype.hasOwnProperty.call(obj, key))) return false;
  if (hasNativeStartupBudget && !isIntInRangeNum(obj.claude_native_startup_timeout_seconds, 1, 600)) return false;
  if (hasSupervisorStartupBudget && !isIntInRangeNum(obj.codex_supervisor_startup_timeout_seconds, 1, 600)) return false;

  const projected = {};
  for (const key of POLICY_REQUIRED_KEYS) projected[key] = obj[key];
  projected.schema = 'runtime-collaboration-policy/v1';
  projected.version = 1;
  if (!isValidPolicy(projected)) return false;

  const selection = obj.selection;
  if (selection === null || typeof selection !== 'object' || Array.isArray(selection)) return false;
  const selectionKeys = [
    'requested_host',
    'requested_role_engine',
    'required_continuity',
    'model_profile_ref',
    'fallback',
  ];
  const hasOptInKey = Object.prototype.hasOwnProperty.call(selection, 'codex_worker_opt_in_roles');
  const selectionKeyCount = Object.keys(selection).length;
  if (selectionKeyCount !== selectionKeys.length && selectionKeyCount !== selectionKeys.length + 1) return false;
  if (selectionKeyCount === selectionKeys.length + 1 && !hasOptInKey) return false;
  if (!selectionKeys.every((key) => Object.prototype.hasOwnProperty.call(selection, key))) return false;
  if (selection.requested_host !== 'claude') return false;
  if (selection.requested_role_engine !== 'claude') return false;
  if (selection.required_continuity !== 'session-persistent') return false;
  if (selection.model_profile_ref !== '.claude/model-profiles.json#current') return false;
  if (hasOptInKey) {
    const optInRoles = selection.codex_worker_opt_in_roles;
    if (!Array.isArray(optInRoles)) return false;
    if (!optInRoles.every((r) => typeof r === 'string' && CANONICAL_ROLES.includes(r))) return false;
    if (new Set(optInRoles).size !== optInRoles.length) return false;
  }

  const fallback = selection.fallback;
  if (fallback === null || typeof fallback !== 'object' || Array.isArray(fallback)) return false;
  if (Object.keys(fallback).length !== 2
      || !Object.prototype.hasOwnProperty.call(fallback, 'mode')
      || !Object.prototype.hasOwnProperty.call(fallback, 'allowed')
      || !Array.isArray(fallback.allowed)) return false;
  return fallback.mode === 'deny' && fallback.allowed.length === 0;
}

/**
 * Projects a validated v2 policy to the exact v1 closed shape.
 * @param {unknown} policy
 * @returns {object}
 */
function projectPolicyV2ToV1(policy) {
  if (!isValidPolicyV2(policy)) throw new TypeError('invalid-policy-v2');
  const projected = {};
  for (const key of POLICY_REQUIRED_KEYS) projected[key] = policy[key];
  projected.schema = 'runtime-collaboration-policy/v1';
  projected.version = 1;
  return projected;
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
 * toolkit-owned policy and toolkit-owned routing file (siblings of the facade, i.e.
 * `facadeDirname`); a present project policy requires its fixed sibling
 * `<project-root>/scripts/lib/runtime-routing.json` to also be present and valid, and
 * this never mixes a project policy with toolkit routing or silently falls back.
 * @param {string} projectRoot - absolute project root.
 * @returns {{ok:true,policy:object,routing:object}|{ok:false}}
 */
function resolvePolicyPair(projectRoot) {
  const projectPolicyPath = path.join(projectRoot, 'scripts', 'lib', 'runtime-collaboration-policy.json');
  const projectRoutingPath = path.join(projectRoot, 'scripts', 'lib', 'runtime-routing.json');
  const toolkitPolicyPath = path.join(facadeDirname, 'runtime-collaboration-policy.json');
  const toolkitRoutingPath = path.join(facadeDirname, 'runtime-routing.json');

  const useProjectPair = fs.existsSync(projectPolicyPath);
  const policyPath = useProjectPair ? projectPolicyPath : toolkitPolicyPath;
  const routingPath = useProjectPair ? projectRoutingPath : toolkitRoutingPath;

  const policy = loadJSON(policyPath);
  const policyIsV1 = isValidPolicy(policy);
  const policyIsV2 = isValidPolicyV2(policy);
  if (!policyIsV1 && !policyIsV2) return { ok: false };

  const routing = loadJSON(routingPath);
  if (!isValidRouting(routing)) return { ok: false };

  if (policyIsV2) {
    return { ok: true, policy, policyV1: projectPolicyV2ToV1(policy), routing };
  }
  return { ok: true, policy, routing };
}

  return Object.freeze({
    POLICY_MODE_ENUM, ROUTING_DRIVER_ENUM, ROUTING_ROLE_ENUM, POLICY_REQUIRED_KEYS,
    hasUniqueValues, isNonEmptyCanonicalRoleArray, isIntInRangeNum, isValidPolicy, isValidPolicyV2,
    projectPolicyV2ToV1, isValidRouting, resolvePolicyPair, loadJSON,
  });
}

module.exports = { createPolicySchema };
