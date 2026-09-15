'use strict';

/** observations portion of the CLAUDE-ID-01 lifecycle authority. */
function createClaudeId01Observations(deps) {
  const {
    CLAUDE_ID01_MAX_TOOL_USE_IDS,
    CLAUDE_ID01_TRACE_TTL_SECONDS,
    claudeId01CapabilityV2PathFor,
    claudeId01EventsDirFor,
    claudeId01LockDirFor,
    claudeId01RecordPathFor,
    claudeStartupActorPathFor,
    clearClaudeId01Events,
    findLiveClaudeNativeRoleSpawnActionIds,
    isClaudeId01ProofCompleteRecord,
    isClaudeId01RawTraceWellFormed,
    maybePromoteClaudeId01Capability,
    recordClaudeId01Event,
    resolveClaudeId01ActionIdForPreToolUse,
    resolveClaudeId01ActionIdForSubagentStart,
    resolveClaudeId01Scope,
    resolveClaudeId01ScopeReadOnly,
    writeClaudeId01SummaryFromEvents,
    fs,
    path,
    CANONICAL_ROLES,
    REQUESTER_BINDING_KEYS,
    REQUESTER_BINDING_KEYS_V2,
    REQUESTER_BINDING_SCAN_CAP,
    currentClockMsForRegistry,
    hasExactKeys,
    isoPlusSecondsForRegistry,
    isoToMsForRegistry,
    nowIsoForRegistry,
    readRegistryRecord,
    registryRepoDir,
    sha256String,
    withRegistryLock,
  } = deps;

  function recordClaudeId01SubagentStartObservation(projectRoot, observed) {
    try {
      const sessionId = observed && observed.sessionId;
      const agentId = observed && observed.agentId;
      const agentType = observed && observed.agentType;
      if (
        typeof sessionId !== 'string' || sessionId.length === 0
        || typeof agentId !== 'string' || agentId.length === 0
        || typeof agentType !== 'string' || agentType.length === 0
        || !CANONICAL_ROLES.includes(agentType)
      ) {
        return;
      }
      const scope = resolveClaudeId01Scope(projectRoot, sessionId);
      if (!scope) return;
      const { worktreeId, planDigest, sessionGenerationId } = scope;
      const agentDigest = sha256String(agentId);
      const liveActionIds = findLiveClaudeNativeRoleSpawnActionIds(
        projectRoot, worktreeId, planDigest, agentType, sessionGenerationId,
      );
      let resolvedActionId;
      if (observed && observed.actionId !== undefined) {
        if (typeof observed.actionId !== 'string' || !liveActionIds.includes(observed.actionId)) return;
        resolvedActionId = observed.actionId;
      } else {
        resolvedActionId = resolveClaudeId01ActionIdForSubagentStart(
          projectRoot, sessionGenerationId, worktreeId, planDigest, agentType, agentDigest, liveActionIds,
        );
        if (!resolvedActionId) return;
      }
      const recordPath = claudeId01RecordPathFor(projectRoot, sessionGenerationId, worktreeId, planDigest, agentType, agentDigest, resolvedActionId);
      const eventsDir = claudeId01EventsDirFor(projectRoot, sessionGenerationId, worktreeId, planDigest, agentType, agentDigest, resolvedActionId);
      const lockDir = claudeId01LockDirFor(projectRoot, sessionGenerationId, worktreeId, planDigest, agentType, agentDigest, resolvedActionId);
      withRegistryLock(lockDir, () => {
        const existing = readRegistryRecord(recordPath);
        if (!existing.ok) return;
        if (existing.absent) {
          clearClaudeId01Events(eventsDir);
          recordClaudeId01Event(eventsDir, 'subagent-start');
          const nowStr = nowIsoForRegistry();
          writeClaudeId01SummaryFromEvents(recordPath, eventsDir, {
            sessionId, agentId, worktreeId, planDigest,
            createdAt: nowStr, expiry: isoPlusSecondsForRegistry(nowStr, CLAUDE_ID01_TRACE_TTL_SECONDS),
            toolUseIdsBeforeResume: [], toolUseIdsAfterResume: [],
          }, agentType, agentDigest, sessionGenerationId);
          return;
        }
        const rec = existing.obj;
        if (isClaudeId01ProofCompleteRecord(rec)) {
          const sameAgent = rec.agent_digest === agentDigest;
          const expired = currentClockMsForRegistry() >= isoToMsForRegistry(rec.expiry);
          if (sameAgent && !expired) return; // still valid -- nothing further to record.
          clearClaudeId01Events(eventsDir);
          recordClaudeId01Event(eventsDir, 'subagent-start');
          const nowStr = nowIsoForRegistry();
          writeClaudeId01SummaryFromEvents(recordPath, eventsDir, {
            sessionId, agentId, worktreeId, planDigest,
            createdAt: nowStr, expiry: isoPlusSecondsForRegistry(nowStr, CLAUDE_ID01_TRACE_TTL_SECONDS),
            toolUseIdsBeforeResume: [], toolUseIdsAfterResume: [],
          }, agentType, agentDigest, sessionGenerationId);
          return;
        }
        if (!isClaudeId01RawTraceWellFormed(rec)) return;
        if (rec.agent_id !== agentId || currentClockMsForRegistry() >= isoToMsForRegistry(rec.expiry)) {
          try { fs.unlinkSync(recordPath); } catch { /* best effort */ }
          clearClaudeId01Events(eventsDir);
          return;
        }
        recordClaudeId01Event(eventsDir, 'subagent-start');
        writeClaudeId01SummaryFromEvents(recordPath, eventsDir, {
          sessionId: rec.session_id, agentId: rec.agent_id, worktreeId: rec.worktree_id, planDigest: rec.plan_digest,
          createdAt: rec.created_at, expiry: rec.expiry,
          toolUseIdsBeforeResume: Array.isArray(rec.tool_use_ids_before_resume) ? rec.tool_use_ids_before_resume : [],
          toolUseIdsAfterResume: Array.isArray(rec.tool_use_ids_after_resume) ? rec.tool_use_ids_after_resume : [],
        }, agentType, agentDigest, sessionGenerationId);
      });
      maybePromoteClaudeId01Capability(
        projectRoot, sessionId, worktreeId, planDigest, sessionGenerationId, agentType,
      );
    } catch { /* best-effort -- never fatal to the spawn */ }
  }
  function recordClaudeId01PreToolUseObservation(projectRoot, observed) {
    try {
      const sessionId = observed && observed.sessionId;
      const agentId = observed && observed.agentId;
      const agentType = observed && observed.agentType;
      const toolUseId = observed && observed.toolUseId;
      if (
        typeof sessionId !== 'string' || sessionId.length === 0
        || typeof agentId !== 'string' || agentId.length === 0
        || typeof agentType !== 'string' || agentType.length === 0
        || typeof toolUseId !== 'string' || toolUseId.length === 0
        || !CANONICAL_ROLES.includes(agentType)
      ) {
        return;
      }
      const scope = resolveClaudeId01Scope(projectRoot, sessionId);
      if (!scope) return;
      const { worktreeId, planDigest, sessionGenerationId } = scope;
      const agentDigest = sha256String(agentId);
      const liveActionIds = findLiveClaudeNativeRoleSpawnActionIds(
        projectRoot, worktreeId, planDigest, agentType, sessionGenerationId,
      );
      const resolved = resolveClaudeId01ActionIdForPreToolUse(projectRoot, sessionGenerationId, worktreeId, planDigest, agentType, agentDigest, liveActionIds);
      if (!resolved.ok) return;
      const recordPath = claudeId01RecordPathFor(projectRoot, sessionGenerationId, worktreeId, planDigest, agentType, agentDigest, resolved.actionId);
      const eventsDir = claudeId01EventsDirFor(projectRoot, sessionGenerationId, worktreeId, planDigest, agentType, agentDigest, resolved.actionId);
      const lockDir = claudeId01LockDirFor(projectRoot, sessionGenerationId, worktreeId, planDigest, agentType, agentDigest, resolved.actionId);
      withRegistryLock(lockDir, () => {
        const existing = readRegistryRecord(recordPath);
        if (!existing.ok || existing.absent) return;
        const rec = existing.obj;
        if (isClaudeId01ProofCompleteRecord(rec)) return; // already complete.
        if (!isClaudeId01RawTraceWellFormed(rec)) return;
        if (rec.agent_id !== agentId || currentClockMsForRegistry() >= isoToMsForRegistry(rec.expiry)) {
          try { fs.unlinkSync(recordPath); } catch { /* best effort */ }
          clearClaudeId01Events(eventsDir);
          return;
        }
        const beforeIds = Array.isArray(rec.tool_use_ids_before_resume) ? rec.tool_use_ids_before_resume : [];
        const afterIds = Array.isArray(rec.tool_use_ids_after_resume) ? rec.tool_use_ids_after_resume : [];
        const bucketKey = rec.resumed ? 'tool_use_ids_after_resume' : 'tool_use_ids_before_resume';
        const currentBucketIds = rec.resumed ? afterIds : beforeIds;
        const globallySeen = beforeIds.includes(toolUseId) || afterIds.includes(toolUseId);
        let nextBucketIds = currentBucketIds;
        if (!globallySeen && currentBucketIds.length < CLAUDE_ID01_MAX_TOOL_USE_IDS) {
          nextBucketIds = currentBucketIds.concat([toolUseId]);
        }
        const updatedBeforeIds = bucketKey === 'tool_use_ids_before_resume' ? nextBucketIds : beforeIds;
        const updatedAfterIds = bucketKey === 'tool_use_ids_after_resume' ? nextBucketIds : afterIds;
        recordClaudeId01Event(eventsDir, 'pretooluse', sha256String(toolUseId));
        writeClaudeId01SummaryFromEvents(recordPath, eventsDir, {
          sessionId: rec.session_id, agentId: rec.agent_id, worktreeId: rec.worktree_id, planDigest: rec.plan_digest,
          createdAt: rec.created_at, expiry: rec.expiry,
          toolUseIdsBeforeResume: updatedBeforeIds, toolUseIdsAfterResume: updatedAfterIds,
        }, agentType, agentDigest, sessionGenerationId);
      });
      maybePromoteClaudeId01Capability(
        projectRoot, sessionId, worktreeId, planDigest, sessionGenerationId, agentType,
      );
    } catch { /* best-effort -- never fatal to the gate */ }
  }
  function preflightClaudeId01TraceForSession(projectRoot, observed) {
    try {
      const sessionId = observed && observed.sessionId;
      const agentId = observed && observed.agentId;
      const agentType = observed && observed.agentType;
      if (
        typeof sessionId !== 'string' || sessionId.length === 0
        || typeof agentId !== 'string' || agentId.length === 0
        || typeof agentType !== 'string' || agentType.length === 0
      ) {
        return { ok: true };
      }
      const scope = resolveClaudeId01ScopeReadOnly(projectRoot, sessionId);
      if (!scope) return { ok: true };
      const { worktreeId, planDigest, sessionGenerationId } = scope;
      const agentDigest = sha256String(agentId);
      const actionIds = findLiveClaudeNativeRoleSpawnActionIds(
        projectRoot, worktreeId, planDigest, agentType, sessionGenerationId,
      );
      const slots = [undefined].concat(actionIds);
      for (const actionId of slots) {
        const recordPath = claudeId01RecordPathFor(
          projectRoot, sessionGenerationId, worktreeId, planDigest, agentType, agentDigest, actionId,
        );
        const eventsDir = claudeId01EventsDirFor(
          projectRoot, sessionGenerationId, worktreeId, planDigest, agentType, agentDigest, actionId,
        );
        try { fs.statSync(recordPath); } catch (err) {
          if (!err || err.code !== 'ENOENT') return { ok: false, reason: 'claude-id01-trace-preflight-unreadable' };
        }
        try { fs.statSync(eventsDir); } catch (err) {
          if (!err || err.code !== 'ENOENT') return { ok: false, reason: 'claude-id01-events-preflight-unreadable' };
        }
      }
      for (const v2Path of [
        claudeStartupActorPathFor(projectRoot, sessionGenerationId, agentId),
        claudeId01CapabilityV2PathFor(projectRoot, sessionGenerationId, agentId),
      ]) {
        try { fs.statSync(v2Path); } catch (err) {
          if (!err || err.code !== 'ENOENT') return { ok: false, reason: 'claude-id01-v2-preflight-unreadable' };
        }
      }
      const bindingsDir = path.join(registryRepoDir(projectRoot), 'requester-bindings');
      let entries;
      try {
        entries = fs.readdirSync(bindingsDir, { withFileTypes: true });
      } catch (err) {
        if (!err || err.code !== 'ENOENT') return { ok: false, reason: 'requester-binding-preflight-scan-failed' };
        entries = [];
      }
      if (entries.length > REQUESTER_BINDING_SCAN_CAP) return { ok: false, reason: 'requester-binding-registry-overflow' };
      for (const entry of entries) {
        if (!entry.isFile() || entry.name.startsWith('.') || !entry.name.endsWith('.json')) continue;
        const read = readRegistryRecord(path.join(bindingsDir, entry.name));
        if (
          !read.ok || read.absent || !read.obj
          || !(hasExactKeys(read.obj, REQUESTER_BINDING_KEYS) || hasExactKeys(read.obj, REQUESTER_BINDING_KEYS_V2))
        ) {
          return { ok: false, reason: 'requester-binding-preflight-malformed' };
        }
      }
      return { ok: true };
    } catch {
      return { ok: false, reason: 'claude-id01-preflight-threw' };
    }
  }
  function deleteClaudeId01TraceForSession(projectRoot, observed) {
    try {
      const sessionId = observed && observed.sessionId;
      const agentId = observed && observed.agentId;
      const agentType = observed && observed.agentType;
      if (
        typeof sessionId !== 'string' || sessionId.length === 0
        || typeof agentId !== 'string' || agentId.length === 0
        || typeof agentType !== 'string' || agentType.length === 0
      ) {
        return { ok: true };
      }
      const scope = resolveClaudeId01ScopeReadOnly(projectRoot, sessionId);
      if (!scope) return { ok: true };
      const { worktreeId, planDigest, sessionGenerationId } = scope;
      const agentDigest = sha256String(agentId);
      const actionIds = findLiveClaudeNativeRoleSpawnActionIds(
        projectRoot, worktreeId, planDigest, agentType, sessionGenerationId,
      );
      const slots = [undefined].concat(actionIds);
      for (const actionId of slots) {
        const recordPath = claudeId01RecordPathFor(
          projectRoot, sessionGenerationId, worktreeId, planDigest, agentType, agentDigest, actionId,
        );
        const eventsDir = claudeId01EventsDirFor(
          projectRoot, sessionGenerationId, worktreeId, planDigest, agentType, agentDigest, actionId,
        );
        const lockResult = withRegistryLock(
          claudeId01LockDirFor(projectRoot, sessionGenerationId, worktreeId, planDigest, agentType, agentDigest, actionId),
          () => {
            try { fs.unlinkSync(recordPath); } catch (err) {
              if (!err || err.code !== 'ENOENT') return { ok: false, reason: (err && err.code) || 'claude-id01-delete-failed' };
            }
            try { fs.rmSync(eventsDir, { recursive: true, force: true }); } catch {
              return { ok: false, reason: 'claude-id01-event-delete-failed' };
            }
            return { ok: true };
          },
        );
        if (!lockResult.ok) return { ok: false, reason: lockResult.reason };
        if (!lockResult.value.ok) return lockResult.value;
      }
      for (const v2Path of [
        claudeStartupActorPathFor(projectRoot, sessionGenerationId, agentId),
        claudeId01CapabilityV2PathFor(projectRoot, sessionGenerationId, agentId),
      ]) {
        try { fs.unlinkSync(v2Path); } catch (err) {
          if (!err || err.code !== 'ENOENT') return { ok: false, reason: (err && err.code) || 'claude-id01-v2-delete-failed' };
        }
      }
      return { ok: true };
    } catch {
      return { ok: false, reason: 'claude-id01-delete-threw' };
    }
  }

  return Object.freeze({
    recordClaudeId01SubagentStartObservation,
    recordClaudeId01PreToolUseObservation,
    preflightClaudeId01TraceForSession,
    deleteClaudeId01TraceForSession,
  });
}

module.exports = { createClaudeId01Observations };
