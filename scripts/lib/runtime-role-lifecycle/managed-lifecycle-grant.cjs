'use strict';

// Extracted behaviorally from runtime-role-lifecycle.cjs: resolve-or-mint the
// one-use lifecycle authority a managed host conductor uses after its session
// identity has already been proven by runtime-host-claude -- the non-hook
// twin of the existing context-provider PreToolUse path. Composed after
// cli-dispatch.cjs (needs its HANDLERS table to validate `subcommand`).
// Never requires the facade or a sibling module.

function createManagedLifecycleGrant({
  path, Buffer, HANDLERS, isWellFormedGrantRole, discoverPlan, computeWorktreeId, sha256String,
  registryRepoDir, readRegistryRecord, grantPathFor, grantConsumedMarkerPathFor,
  getOrCreateMainOrchestratorBindingForSession, mintLifecycleCommandGrant, writeRegistryRecordReplace,
  canonicalJSONStringify,
}) {
/**
 * Resolve or mint the one-use lifecycle authority used by a managed host
 * conductor after its session identity has already been proven by
 * runtime-host-claude.  This is the non-hook twin of the existing
 * context-provider PreToolUse path: both use the same binding and grant
 * primitives, while this function owns the cache so a conductor never has to
 * fabricate a Bash hook event merely to enter the protocol.
 */
function resolveOrMintManagedLifecycleGrant(options) {
  const projectRootDescriptor = options && options.projectRootDescriptor;
  const sessionId = options && options.sessionId;
  const subcommand = options && options.subcommand;
  const argvDigest = options && options.argvDigest;
  const role = options && options.role;
  const actionId = options && options.actionId === undefined ? null : options.actionId;
  if (!projectRootDescriptor || typeof sessionId !== 'string' || sessionId.length === 0 ||
      Buffer.byteLength(sessionId, 'utf8') > 512 || typeof subcommand !== 'string' ||
      !HANDLERS[subcommand] || !/^[0-9a-f]{64}$/.test(argvDigest || '') ||
      !isWellFormedGrantRole(role)) {
    return { ok: false, reason: 'MANAGED_LIFECYCLE_INPUT_INVALID' };
  }

  let worktreeId;
  let planDigest;
  if (typeof projectRootDescriptor === 'object' && projectRootDescriptor !== null &&
      typeof projectRootDescriptor.repoId === 'string') {
    worktreeId = options.worktreeId;
    planDigest = options.planDigest;
    if (typeof worktreeId !== 'string' || typeof planDigest !== 'string') {
      return { ok: false, reason: 'MANAGED_LIFECYCLE_SCOPE_MISMATCH' };
    }
  } else {
    const plan = discoverPlan(projectRootDescriptor);
    if (!plan.ok) return { ok: false, reason: 'MANAGED_LIFECYCLE_PLAN_INVALID' };
    try { worktreeId = computeWorktreeId(projectRootDescriptor); } catch {
      return { ok: false, reason: 'MANAGED_LIFECYCLE_WORKTREE_INVALID' };
    }
    planDigest = plan.planDigest;
    if ((options.worktreeId && options.worktreeId !== worktreeId) ||
        (options.planDigest && options.planDigest !== planDigest)) {
      return { ok: false, reason: 'MANAGED_LIFECYCLE_SCOPE_MISMATCH' };
    }
  }

  const cacheKey = sha256String([
    'managed-conductor-lifecycle-grant-cache-v1', worktreeId, planDigest,
    subcommand, argvDigest, sessionId,
  ].join(':'));
  const cachePath = path.join(registryRepoDir(projectRootDescriptor),
    'managed-conductor-lifecycle-grant-cache', cacheKey + '.json');
  const cached = readRegistryRecord(cachePath);
  if (cached.ok && !cached.absent && cached.obj && typeof cached.obj.grant_id === 'string') {
    const grant = readRegistryRecord(grantPathFor(projectRootDescriptor, cached.obj.grant_id));
    const consumed = readRegistryRecord(grantConsumedMarkerPathFor(projectRootDescriptor, cached.obj.grant_id));
    const expiryMs = grant.ok && !grant.absent && grant.obj ? Date.parse(grant.obj.expiry) : NaN;
    if (Number.isFinite(expiryMs) && Date.now() < expiryMs && consumed.ok && consumed.absent) {
      return { ok: true, grantId: cached.obj.grant_id, reused: true, worktreeId, planDigest };
    }
  }

  const bindingResult = getOrCreateMainOrchestratorBindingForSession(
    projectRootDescriptor, sessionId, worktreeId, planDigest, 3600,
  );
  if (!bindingResult.ok) return { ok: false, reason: bindingResult.reason || 'MANAGED_LIFECYCLE_BINDING_FAILED' };
  const bootstrapCommands = new Set(['probe', 'ensure', 'action-failed', 'wait-ready', 'status']);
  const mintResult = mintLifecycleCommandGrant(
    projectRootDescriptor, bindingResult.binding, argvDigest, role, subcommand,
    'main-orchestrator', 'orchestrator', bootstrapCommands.has(subcommand) ? 'bootstrap' : 'normal', actionId,
  );
  if (!mintResult.ok) return { ok: false, reason: mintResult.reason || 'MANAGED_LIFECYCLE_GRANT_FAILED' };
  writeRegistryRecordReplace(cachePath, Buffer.from(canonicalJSONStringify({
    grant_id: mintResult.grantId, cached_at: new Date().toISOString(),
  }), 'utf8'));
  return { ok: true, grantId: mintResult.grantId, reused: false, worktreeId, planDigest };
}

  return Object.freeze({
    resolveOrMintManagedLifecycleGrant,
  });
}

module.exports = { createManagedLifecycleGrant };
