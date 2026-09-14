'use strict';

function createClaudeResumeRecord(deps) {
  const {
    CANONICAL_ROLES,
    computeClaudeAuthorityIdentityId,
    computeWorktreeId,
    currentClockMsForRegistry,
    discoverPlan,
    findUniqueClaudePeerRoleActorBinding,
    fs,
    hasExactKeys,
    isCanonicalIsoUtc,
    isHexActionId,
    isHexCsprng32,
    isHexDigest64,
    isoToMsForRegistry,
    path,
    peekSessionGeneration,
    readClaudeAuthorityFence,
    readRegistryRecord,
    registryRepoDir,
  } = deps;

const CLAUDE_RESUME_HANDLE_SCHEMA = 'runtime/claude-resume-handle/v1';
const CLAUDE_RESUME_HANDLE_KEYS = Object.freeze([
  'actor_binding_id', 'agent_id', 'binding_id', 'created_at', 'expiry',
  'plan_digest', 'role', 'schema', 'session', 'session_generation_id',
  'teammate_name', 'worktree_id',
]);
const CLAUDE_RESUME_HANDLE_SCAN_CAP = 1024;

function claudeResumeHandlePathFor(projectRootOrRepoDescriptor, handleId) {
  return path.join(registryRepoDir(projectRootOrRepoDescriptor), 'claude-resume-handles', handleId + '.json');
}

function claudeResumeHandleConsumedMarkerPathFor(projectRootOrRepoDescriptor, handleId) {
  return claudeResumeHandlePathFor(projectRootOrRepoDescriptor, handleId) + '.consumed';
}

function validateClaudeResumeHandleRecordShape(record, handleId) {
  if (!isHexActionId(handleId)) return { ok: false, reason: 'INVALID' };
  if (!record || !hasExactKeys(record, CLAUDE_RESUME_HANDLE_KEYS)) return { ok: false, reason: 'INVALID' };
  if (record.schema !== CLAUDE_RESUME_HANDLE_SCHEMA) return { ok: false, reason: 'INVALID' };
  if (!isHexActionId(record.binding_id) || record.binding_id !== handleId) return { ok: false, reason: 'INVALID' };
  if (!isHexActionId(record.actor_binding_id)) return { ok: false, reason: 'INVALID' };
  if (typeof record.session !== 'string' || record.session.length === 0) return { ok: false, reason: 'INVALID' };
  if (typeof record.agent_id !== 'string' || record.agent_id.length === 0) return { ok: false, reason: 'INVALID' };
  if (!isHexCsprng32(record.session_generation_id)) return { ok: false, reason: 'INVALID' };
  if (typeof record.role !== 'string' || !CANONICAL_ROLES.includes(record.role)) return { ok: false, reason: 'INVALID' };
  if (record.teammate_name !== record.role) return { ok: false, reason: 'INVALID' };
  if (!isHexDigest64(record.worktree_id) || !isHexDigest64(record.plan_digest)) return { ok: false, reason: 'INVALID' };
  if (!isCanonicalIsoUtc(record.created_at) || !isCanonicalIsoUtc(record.expiry)) return { ok: false, reason: 'INVALID' };
  const createdAtMs = isoToMsForRegistry(record.created_at);
  const expiryMs = isoToMsForRegistry(record.expiry);
  if (!Number.isFinite(createdAtMs) || !Number.isFinite(expiryMs) || createdAtMs > expiryMs) {
    return { ok: false, reason: 'INVALID' };
  }
  return { ok: true, record };
}

function validateClaudeResumeHandleRecord(record, handleId) {
  const shaped = validateClaudeResumeHandleRecordShape(record, handleId);
  if (!shaped.ok) return shaped;
  const createdAtMs = isoToMsForRegistry(record.created_at);
  const expiryMs = isoToMsForRegistry(record.expiry);
  const nowMs = currentClockMsForRegistry();
  if (createdAtMs > nowMs) return { ok: false, reason: 'INVALID' };
  if (nowMs >= expiryMs) return { ok: false, reason: 'INVALID' };
  return { ok: true, record };
}

function readClaudeResumeHandle(projectRootOrRepoDescriptor, handleId) {
  if (!isHexActionId(handleId)) return { ok: false, reason: 'INVALID' };
  let read;
  try {
    read = readRegistryRecord(claudeResumeHandlePathFor(projectRootOrRepoDescriptor, handleId));
  } catch {
    return { ok: false, reason: 'INVALID' };
  }
  if (!read.ok) return { ok: false, reason: 'INVALID' };
  if (read.absent) return { ok: false, reason: 'UNAVAILABLE' };
  return validateClaudeResumeHandleRecord(read.obj, handleId);
}

/** Best-effort, fail-closed: any unreadable state is treated as consumed/unusable, never as "free to reuse". */
function isClaudeResumeHandleConsumed(projectRootOrRepoDescriptor, handleId) {
  try {
    return fs.existsSync(claudeResumeHandleConsumedMarkerPathFor(projectRootOrRepoDescriptor, handleId));
  } catch {
    return true;
  }
}

/**
 * Bounded scan for every LIVE (schema/shape/expiry-valid) resume handle
 * matching the exact {worktreeId,planDigest,role,session,agentId,
 * actorBindingId} tuple, regardless of consumed status (callers filter by
 * `isClaudeResumeHandleConsumed` themselves -- consumption is a separate
 * marker file, never a scan-time exclusion here, so both park's no-clobber
 * check and consume's own lookup share ONE scan implementation).
 */
function findClaudeResumeHandlesForActor(projectRoot, expected) {
  const dir = path.join(registryRepoDir(projectRoot), 'claude-resume-handles');
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    if (err && err.code === 'ENOENT') return { ok: true, records: [] };
    return { ok: false, reason: 'INVALID' };
  }
  if (entries.length > CLAUDE_RESUME_HANDLE_SCAN_CAP) return { ok: false, reason: 'INVALID' };
  const records = [];
  for (const entry of entries.slice().sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    if (entry.name.startsWith('.')) continue;
    // Consumption markers (<handleId>.json.consumed) live in this SAME
    // directory, deliberately never their own registry -- skip them here
    // exactly like readClaudeResumeHandle's own callers already skip
    // absence; anything else non-conforming still fails closed.
    if (entry.name.endsWith('.consumed')) continue;
    if (!entry.isFile() || !/^[0-9a-f]{32}\.json$/.test(entry.name)) return { ok: false, reason: 'INVALID' };
    const handleId = entry.name.slice(0, -5);
    const read = readRegistryRecord(claudeResumeHandlePathFor(projectRoot, handleId));
    if (!read.ok || read.absent || !read.obj) return { ok: false, reason: 'INVALID' };
    const shaped = validateClaudeResumeHandleRecordShape(read.obj, handleId);
    if (!shaped.ok) return { ok: false, reason: 'INVALID' };
    const record = shaped.record;
    if (
      record.worktree_id === expected.worktreeId && record.plan_digest === expected.planDigest
      && record.role === expected.role && record.session === expected.session
      && record.agent_id === expected.agentId && record.actor_binding_id === expected.actorBindingId
    ) {
      const live = validateClaudeResumeHandleRecord(record, handleId);
      if (!live.ok) return { ok: false, reason: 'INVALID' };
      records.push(live.record);
    }
  }
  return { ok: true, records };
}

/**
 * Resolves the exact role-actor SCOPE a park/consume call operates on --
 * mirrors resolveClaudePeerObservedActorAuthority closely (same event shape,
 * same fence-absent gate, same unique-live-RoleActorBinding correlation) but
 * deliberately never requires complete CLAUDE-ID-01 proof: parking happens
 * at the FIRST SubagentStop, before the resumed actor's first post-resume
 * PreToolUse can ever complete that chain -- requiring it here would make
 * the bootstrap this correction exists for impossible.
 */
function resolveClaudeResumeRoleActorScope(projectRoot, event) {
  try {
    const eventKeys = ['agentId', 'agentType', 'sessionId'];
    if (!event || typeof event !== 'object' || Array.isArray(event) || !hasExactKeys(event, eventKeys)) {
      return { ok: false, reason: 'INVALID' };
    }
    if (
      typeof event.sessionId !== 'string' || event.sessionId.length === 0
      || typeof event.agentId !== 'string' || event.agentId.length === 0
      || typeof event.agentType !== 'string' || event.agentType.length === 0
      || !CANONICAL_ROLES.includes(event.agentType)
    ) {
      return { ok: false, reason: 'INVALID' };
    }

    const worktreeId = computeWorktreeId(projectRoot);
    const planResult = discoverPlan(projectRoot);
    if (!planResult.ok) return { ok: false, reason: 'INVALID' };
    const planDigest = planResult.planDigest;

    const generation = peekSessionGeneration(projectRoot, { provider: 'claude-hook', runtime_session_key: event.sessionId });
    if (!generation.ok) {
      if (generation.reason === 'session-generation-absent' || generation.reason === 'session-generation-expired') {
        return { ok: false, reason: 'UNAVAILABLE' };
      }
      return { ok: false, reason: 'INVALID' };
    }
    const generationId = generation.generationId;

    const fenceRead = readClaudeAuthorityFence(
      projectRoot, computeClaudeAuthorityIdentityId(projectRoot, 'claude-hook', event.sessionId, event.agentId),
    );
    if (!fenceRead.ok || !fenceRead.absent) return { ok: false, reason: 'INVALID' };

    const found = findUniqueClaudePeerRoleActorBinding(projectRoot, {
      role: event.agentType, worktreeId, planDigest, generationId,
    });
    if (!found.ok) return found;

    return {
      ok: true,
      scope: {
        sessionId: event.sessionId, agentId: event.agentId, role: event.agentType,
        worktreeId, planDigest, generationId, generationExpiresAt: generation.expiresAt,
        actorBinding: found.binding,
      },
    };
  } catch (err) {
    return { ok: false, reason: 'INVALID' };
  }
}


  return Object.freeze({
    CLAUDE_RESUME_HANDLE_SCHEMA,
    CLAUDE_RESUME_HANDLE_KEYS,
    CLAUDE_RESUME_HANDLE_SCAN_CAP,
    claudeResumeHandlePathFor,
    claudeResumeHandleConsumedMarkerPathFor,
    validateClaudeResumeHandleRecordShape,
    validateClaudeResumeHandleRecord,
    readClaudeResumeHandle,
    isClaudeResumeHandleConsumed,
    findClaudeResumeHandlesForActor,
    resolveClaudeResumeRoleActorScope,
  });
}

module.exports = Object.freeze({ createClaudeResumeRecord });

