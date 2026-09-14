'use strict';

function createLifecycleActionPayloads(deps) {
  const {
    fs, path, process, facadeDirname, CANONICAL_ROLES, canonicalJSONStringify, computeRepoId, computeWorktreeId, coordinationRootPathFor, discoverPlan, hasExactKeys, isCanonicalIsoUtc, isHexActionId,
    isHexCsprng32, isHexDigest64, isoToMsForRegistry, realpathOrSelf, renderPosixDirect, resolvePolicyPair, sha256String,
  } = deps;

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

function claudeReadyBootstrapMessageFor(actionId, role, projectRoot) {
  if (!isHexActionId(actionId)) throw new TypeError('invalid-action-id');
  if (!CANONICAL_ROLES.includes(role)) throw new TypeError('invalid-role');
  if (typeof projectRoot !== 'string' || !path.isAbsolute(projectRoot)) {
    throw new TypeError('invalid-project-root');
  }
  const nodePath = resolvedNodePath();
  const readyCommand = renderPosixDirect([
    nodePath,
    path.resolve(projectRoot, 'scripts', 'lib', 'runtime-role-lifecycle.cjs'),
    'ready',
    '--action',
    actionId,
  ]);
  // Keep the five-action init envelope below Claude Code's pinned native
  // tool-result truncation boundary.  Common immutable argv components occur
  // once; each call suffix is still closed data, not model-authored shell.
  const receiverContract = canonicalJSONStringify({
    n: 'node',
    p: projectRoot,
    r: role,
  });
  return [
    `FIRST Bash=${readyCommand};require READY else report/stop;WAIT.`,
    receiverContract,
    'Only COORDINATION_CONSULT/v1\\n+JSON keys{artifact_path,kind,request_id,role,target_role};kind=consult;target_role=r.A=artifact_path;C=p+"/scripts/lib/runtime-consultation.cjs";Q=p+"/.planning/coordination";X=[n,C];Y=["--coordination-root",Q,"--request",A].',
    'Bash=single-quote tokens;no chain.Before reads:X+["claim"]+Y+["--role",r];need SUCCESS;K=artifact_ref;Work.Heartbeat<=60s:X+["lease-heartbeat"]+Y+["--claim",K].Finish:X+["publish-result"]+Y+["--claim",K,"--content",B];B=base64url(UTF8 result);Invalid=>no tool.',
  ].join('\n');
}

function buildSupervisorStartPayload(nodePath, bridgePath, actionId, coordRoot, roles, sessionExpiry) {
  const bridgeArgv = [nodePath, bridgePath, 'session-run', '--action', actionId, '--coordination-root', coordRoot];
  for (const r of roles) bridgeArgv.push('--role', r);
  bridgeArgv.push('--session-expiry', sessionExpiry);
  return { bridge: 'codex-app-server', bridge_argv: bridgeArgv, bridge_command: renderPosixDirect(bridgeArgv) };
}

const ROLE_LIFECYCLE_ACTION_KEYS_SORTED = Object.freeze([
  'action_id', 'expires_at', 'kind', 'payload', 'plan_digest', 'policy_digest',
  'repo_id', 'role', 'runtime', 'schema', 'session_generation_id', 'worktree_id',
]);
const SUPERVISOR_START_PAYLOAD_KEYS_SORTED = Object.freeze(['bridge', 'bridge_argv', 'bridge_command']);

/**
 * Closed validation for the one supervisor-start/host-process action arm.
 * The persisted action is authority input, so checking only `kind` is never
 * sufficient: runtime, envelope, scope, payload and canonical argv must all
 * agree before a claim can be minted or consumed.
 *
 * When `projectRoot` is supplied the validation additionally binds the
 * descriptor to the current repo/worktree/PLAN/policy and to the exact
 * resolved node, bridge and coordination-root paths. With no projectRoot it
 * still validates the complete closed union and self-correlation.
 *
 * @param {object} action
 * @param {string|null} [projectRoot]
 * @returns {{ok:true,roles:string[]}|{ok:false,reason:string}}
 */
function validateSupervisorStartAction(action, projectRoot) {
  if (!hasExactKeys(action, ROLE_LIFECYCLE_ACTION_KEYS_SORTED)) return { ok: false, reason: 'supervisor-action-key-set-invalid' };
  if (action.schema !== 'coordination/role-lifecycle-action/v1') return { ok: false, reason: 'supervisor-action-schema-invalid' };
  if (!isHexActionId(action.action_id)) return { ok: false, reason: 'supervisor-action-id-invalid' };
  if (action.kind !== 'supervisor-start' || action.runtime !== 'host-process' || action.role !== null) {
    return { ok: false, reason: 'supervisor-action-union-invalid' };
  }
  if (
    !isHexDigest64(action.repo_id) || !isHexDigest64(action.worktree_id)
    || !isHexDigest64(action.plan_digest) || !isHexDigest64(action.policy_digest)
    || !isHexCsprng32(action.session_generation_id)
  ) return { ok: false, reason: 'supervisor-action-scope-shape-invalid' };
  if (!isCanonicalIsoUtc(action.expires_at)) return { ok: false, reason: 'supervisor-action-expiry-invalid' };
  if (!hasExactKeys(action.payload, SUPERVISOR_START_PAYLOAD_KEYS_SORTED)) return { ok: false, reason: 'supervisor-action-payload-key-set-invalid' };
  if (action.payload.bridge !== 'codex-app-server') return { ok: false, reason: 'supervisor-action-bridge-invalid' };
  const argv = action.payload.bridge_argv;
  if (!Array.isArray(argv) || argv.length < 11 || !argv.every((v) => typeof v === 'string' && v.length > 0)) {
    return { ok: false, reason: 'supervisor-action-argv-invalid' };
  }
  if (
    !path.isAbsolute(argv[0]) || !path.isAbsolute(argv[1])
    || argv[2] !== 'session-run' || argv[3] !== '--action' || argv[4] !== action.action_id
    || argv[5] !== '--coordination-root' || !path.isAbsolute(argv[6])
    || argv[argv.length - 2] !== '--session-expiry'
  ) return { ok: false, reason: 'supervisor-action-argv-correlation-invalid' };
  const retainedServiceExpiry = argv[argv.length - 1];
  if (
    !isCanonicalIsoUtc(retainedServiceExpiry)
    || !(isoToMsForRegistry(retainedServiceExpiry) > isoToMsForRegistry(action.expires_at))
  ) return { ok: false, reason: 'supervisor-action-retained-service-expiry-invalid' };
  const roleTokens = argv.slice(7, -2);
  if (roleTokens.length === 0 || roleTokens.length % 2 !== 0) return { ok: false, reason: 'supervisor-action-role-argv-invalid' };
  const roles = [];
  for (let i = 0; i < roleTokens.length; i += 2) {
    if (roleTokens[i] !== '--role' || !CANONICAL_ROLES.includes(roleTokens[i + 1])) {
      return { ok: false, reason: 'supervisor-action-role-argv-invalid' };
    }
    roles.push(roleTokens[i + 1]);
  }
  if (new Set(roles).size !== roles.length || roles.join('\0') !== roles.slice().sort().join('\0')) {
    return { ok: false, reason: 'supervisor-action-role-set-invalid' };
  }
  let rendered;
  try { rendered = renderPosixDirect(argv); } catch (err) { return { ok: false, reason: 'supervisor-action-render-invalid' }; }
  if (action.payload.bridge_command !== rendered) return { ok: false, reason: 'supervisor-action-command-invalid' };

  if (typeof projectRoot === 'string' && projectRoot.length > 0) {
    let worktreeId;
    let planResult;
    try {
      worktreeId = computeWorktreeId(projectRoot);
      planResult = discoverPlan(projectRoot);
    } catch (err) {
      return { ok: false, reason: 'supervisor-action-project-scope-unavailable' };
    }
    const pair = resolvePolicyPair(projectRoot);
    if (!planResult.ok || !pair.ok) return { ok: false, reason: 'supervisor-action-project-scope-unavailable' };
    // The producer above always launches the bridge adjacent to this loaded
    // lifecycle implementation. The operated project may be a separate L1/L2
    // checkout, so reconstructing this executable path from projectRoot would
    // reject the producer's own valid action in centralized-toolkit mode.
    const expectedBridgePath = path.join(facadeDirname, 'runtime-bridge-codex.cjs');
    if (action.repo_id !== computeRepoId(projectRoot)) return { ok: false, reason: 'supervisor-action-repo-mismatch' };
    if (action.worktree_id !== worktreeId) return { ok: false, reason: 'supervisor-action-worktree-mismatch' };
    if (action.plan_digest !== planResult.planDigest) return { ok: false, reason: 'supervisor-action-plan-mismatch' };
    if (action.policy_digest !== sha256String(canonicalJSONStringify(pair.routing))) return { ok: false, reason: 'supervisor-action-policy-mismatch' };
    if (argv[0] !== resolvedNodePath()) return { ok: false, reason: 'supervisor-action-node-path-mismatch' };
    if (realpathOrSelf(argv[1]) !== realpathOrSelf(expectedBridgePath)) return { ok: false, reason: 'supervisor-action-bridge-path-mismatch' };
    if (realpathOrSelf(argv[6]) !== realpathOrSelf(coordinationRootPathFor(projectRoot))) return { ok: false, reason: 'supervisor-action-coordination-root-mismatch' };
  }
  return { ok: true, roles };
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

  return Object.freeze({
    buildTeamEnsurePayload, buildRoleSpawnPayload, buildRoleRebindClaudeNativePayload, buildRoleRebindHostProcessPayload, buildRoleNotifyPayload, buildRoleStopOwnedPayload, resolvedNodePath,
    claudeReadyBootstrapMessageFor, buildSupervisorStartPayload, ROLE_LIFECYCLE_ACTION_KEYS_SORTED, SUPERVISOR_START_PAYLOAD_KEYS_SORTED, validateSupervisorStartAction,
    buildSupervisorStopOwnedPayload,
  });
}

module.exports = { createLifecycleActionPayloads };
