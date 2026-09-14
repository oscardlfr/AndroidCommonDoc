'use strict';

/** scope portion of the CLAUDE-ID-01 lifecycle authority. */
function createClaudeId01Scope(deps) {
  const {
    path,
    computeWorktreeId,
    discoverPlan,
    peekSessionGeneration,
    registryRepoDir,
    resolveSessionGeneration,
    sha256String,
  } = deps;

  const CLAUDE_ID01_TRACE_SCHEMA = 'runtime/claude-id01-trace/v1';
  const CLAUDE_ID01_ATTESTATION_SCHEMA = 'runtime/claude-id01-attestation/v1';
  const CLAUDE_ID01_CAPABILITY_SCHEMA = 'runtime/claude-id01-capability/v1';
  const CLAUDE_ID01_CAPABILITY_KEYS = Object.freeze([
    'completed_at', 'created_at', 'distinct_peer_count', 'distinct_spawn_actions_observed',
    'expiry', 'plan_digest', 'primary_pretooluse_after_count',
    'primary_pretooluse_before_count', 'primary_sequence_complete', 'proof_complete',
    'same_role_peer_observed', 'schema', 'session_generation_digest', 'worktree_id',
  ]);
  const CLAUDE_ID01_TRACE_TTL_SECONDS = 3600;
  const CLAUDE_ID01_MAX_TOOL_USE_IDS = 8;
  const CLAUDE_ID01_MAX_SUBAGENT_START_COUNT = 1000;
  const CLAUDE_ID01_EVENT_SCHEMA = 'runtime/claude-id01-event/v1';
  const CLAUDE_ID01_EVENTS_SCAN_CAP = 1024;
  function claudeId01CapabilityLookupKey(sessionGenerationId, worktreeId, planDigest) {
    return sha256String('claude-id01-capability-v1:' + sessionGenerationId + ':' + worktreeId + ':' + planDigest);
  }
  function claudeId01CapabilityPathFor(projectRootOrRepoDescriptor, sessionGenerationId, worktreeId, planDigest) {
    return path.join(
      registryRepoDir(projectRootOrRepoDescriptor), 'claude-id01-capabilities',
      claudeId01CapabilityLookupKey(sessionGenerationId, worktreeId, planDigest) + '.json',
    );
  }
  function claudeId01CapabilityLockDirFor(projectRootOrRepoDescriptor, sessionGenerationId, worktreeId, planDigest) {
    return claudeId01CapabilityPathFor(projectRootOrRepoDescriptor, sessionGenerationId, worktreeId, planDigest) + '.lock';
  }
  function claudeId01LookupKey(sessionGenerationId, worktreeId, planDigest, role, agentDigest, actionId) {
    const base = 'claude-id01-trace-v1:' + sessionGenerationId + ':' + worktreeId + ':' + planDigest + ':' + role + ':' + agentDigest;
    return sha256String(actionId ? base + ':' + actionId : base);
  }
  function claudeId01RecordPathFor(projectRootOrRepoDescriptor, sessionGenerationId, worktreeId, planDigest, role, agentDigest, actionId) {
    return path.join(
      registryRepoDir(projectRootOrRepoDescriptor), 'claude-id01-traces',
      claudeId01LookupKey(sessionGenerationId, worktreeId, planDigest, role, agentDigest, actionId) + '.json',
    );
  }
  function claudeId01LockDirFor(projectRootOrRepoDescriptor, sessionGenerationId, worktreeId, planDigest, role, agentDigest, actionId) {
    return path.join(
      registryRepoDir(projectRootOrRepoDescriptor), 'claude-id01-trace-locks',
      claudeId01LookupKey(sessionGenerationId, worktreeId, planDigest, role, agentDigest, actionId) + '.lock',
    );
  }
  function claudeId01EventsDirFor(projectRootOrRepoDescriptor, sessionGenerationId, worktreeId, planDigest, role, agentDigest, actionId) {
    return path.join(
      registryRepoDir(projectRootOrRepoDescriptor), 'claude-id01-trace-events',
      claudeId01LookupKey(sessionGenerationId, worktreeId, planDigest, role, agentDigest, actionId),
    );
  }
  function resolveClaudeId01Scope(projectRoot, sessionId) {
    let worktreeId;
    let planResult;
    try {
      worktreeId = computeWorktreeId(projectRoot);
      planResult = discoverPlan(projectRoot);
    } catch {
      return null;
    }
    if (typeof worktreeId !== 'string' || worktreeId.length === 0 || !planResult.ok) return null;
    let genResult;
    try {
      genResult = resolveSessionGeneration(projectRoot, { provider: 'claude-hook', runtime_session_key: sessionId });
    } catch {
      return null;
    }
    if (!genResult.ok) return null;
    return { worktreeId, planDigest: planResult.planDigest, sessionGenerationId: genResult.generationId };
  }
  function resolveClaudeId01ScopeReadOnly(projectRoot, sessionId) {
    let worktreeId;
    let planResult;
    try {
      worktreeId = computeWorktreeId(projectRoot);
      planResult = discoverPlan(projectRoot);
    } catch {
      return null;
    }
    if (typeof worktreeId !== 'string' || worktreeId.length === 0 || !planResult.ok) return null;
    let genResult;
    try {
      genResult = peekSessionGeneration(projectRoot, { provider: 'claude-hook', runtime_session_key: sessionId });
    } catch {
      return null;
    }
    if (!genResult.ok) return null;
    return { worktreeId, planDigest: planResult.planDigest, sessionGenerationId: genResult.generationId };
  }

  return Object.freeze({
    CLAUDE_ID01_TRACE_SCHEMA,
    CLAUDE_ID01_ATTESTATION_SCHEMA,
    CLAUDE_ID01_CAPABILITY_SCHEMA,
    CLAUDE_ID01_CAPABILITY_KEYS,
    CLAUDE_ID01_TRACE_TTL_SECONDS,
    CLAUDE_ID01_MAX_TOOL_USE_IDS,
    CLAUDE_ID01_MAX_SUBAGENT_START_COUNT,
    CLAUDE_ID01_EVENT_SCHEMA,
    CLAUDE_ID01_EVENTS_SCAN_CAP,
    claudeId01CapabilityLookupKey,
    claudeId01CapabilityPathFor,
    claudeId01CapabilityLockDirFor,
    claudeId01LookupKey,
    claudeId01RecordPathFor,
    claudeId01LockDirFor,
    claudeId01EventsDirFor,
    resolveClaudeId01Scope,
    resolveClaudeId01ScopeReadOnly,
  });
}

module.exports = { createClaudeId01Scope };

