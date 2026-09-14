'use strict';

/** trace portion of the CLAUDE-ID-01 lifecycle authority. */
function createClaudeId01Trace(deps) {
  const {
    CLAUDE_ID01_ATTESTATION_SCHEMA,
    CLAUDE_ID01_CAPABILITY_KEYS,
    CLAUDE_ID01_CAPABILITY_SCHEMA,
    CLAUDE_ID01_EVENTS_SCAN_CAP,
    CLAUDE_ID01_EVENT_SCHEMA,
    CLAUDE_ID01_MAX_SUBAGENT_START_COUNT,
    CLAUDE_ID01_MAX_TOOL_USE_IDS,
    CLAUDE_ID01_TRACE_SCHEMA,
    CLAUDE_ID01_TRACE_TTL_SECONDS,
    claudeId01CapabilityLockDirFor,
    claudeId01CapabilityPathFor,
    claudeId01EventsDirFor,
    claudeId01RecordPathFor,
    fs,
    path,
    crypto,
    CANONICAL_ROLES,
    SESSION_GENERATION_KEYS,
    canonicalJSONStringify,
    currentClockMsForRegistry,
    hasExactKeys,
    hasUniqueValues,
    isCanonicalIsoUtc,
    isHexDigest64,
    isoPlusSecondsForRegistry,
    isoToMsForRegistry,
    nowIsoForRegistry,
    publishNoClobber,
    readRegistryRecord,
    registryRepoDir,
    sessionGenerationPathFor,
    sha256String,
    withRegistryLock,
    writeRegistryRecordReplace,
  } = deps;

  const CLAUDE_ID01_LIVE_ACTION_SCAN_CAP = 1024;
  function findLiveClaudeNativeRoleSpawnActionIds(projectRoot, worktreeId, planDigest, role, sessionGenerationId) {
    const dir = path.join(registryRepoDir(projectRoot), 'actions');
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    if (entries.length > CLAUDE_ID01_LIVE_ACTION_SCAN_CAP) return [];
    const nowMs = currentClockMsForRegistry();
    const found = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const read = readRegistryRecord(path.join(dir, entry.name));
      if (!read.ok || read.absent || !read.obj) continue;
      const action = read.obj;
      if (
        action.schema !== 'coordination/role-lifecycle-action/v1'
        || action.kind !== 'role-spawn' || action.runtime !== 'claude-native'
        || action.worktree_id !== worktreeId || action.plan_digest !== planDigest || action.role !== role
        || (sessionGenerationId !== undefined && action.session_generation_id !== sessionGenerationId)
        || typeof action.action_id !== 'string'
      ) continue;
      if (entry.name !== action.action_id + '.json') continue;
      const expiresAtMs = isoToMsForRegistry(action.expires_at);
      if (!Number.isFinite(expiresAtMs) || nowMs >= expiresAtMs) continue;
      found.push(action.action_id);
    }
    found.sort();
    return found;
  }
  function resolveClaudeId01ActionIdForSubagentStart(projectRoot, sessionGenerationId, worktreeId, planDigest, role, agentDigest, liveActionIds) {
    if (liveActionIds.length === 0) return undefined;
    const inProgress = [];
    for (const actionId of liveActionIds) {
      const recordPath = claudeId01RecordPathFor(projectRoot, sessionGenerationId, worktreeId, planDigest, role, agentDigest, actionId);
      const read = readRegistryRecord(recordPath);
      if (read.ok && !read.absent && read.obj && !isClaudeId01ProofCompleteRecord(read.obj)) inProgress.push(actionId);
    }
    return inProgress.length === 1 ? inProgress[0] : undefined;
  }
  function resolveClaudeId01ActionIdForPreToolUse(projectRoot, sessionGenerationId, worktreeId, planDigest, role, agentDigest, liveActionIds) {
    if (liveActionIds.length === 0) return { ok: true, actionId: undefined };
    for (const actionId of liveActionIds) {
      const recordPath = claudeId01RecordPathFor(projectRoot, sessionGenerationId, worktreeId, planDigest, role, agentDigest, actionId);
      const read = readRegistryRecord(recordPath);
      if (read.ok && !read.absent && read.obj && !isClaudeId01ProofCompleteRecord(read.obj)) {
        return { ok: true, actionId };
      }
    }
    return { ok: false }; // no in-progress action-scoped slot for this identity -- nothing to continue.
  }
  function resolveClaudeId01RecordPathForCheck(projectRootOrRepoDescriptor, sessionGenerationId, worktreeId, planDigest, role, agentDigest) {
    const liveActionIds = findLiveClaudeNativeRoleSpawnActionIds(projectRootOrRepoDescriptor, worktreeId, planDigest, role, sessionGenerationId);
    if (liveActionIds.length === 0) {
      return claudeId01RecordPathFor(projectRootOrRepoDescriptor, sessionGenerationId, worktreeId, planDigest, role, agentDigest);
    }
    let bestPath = null;
    let bestCreatedMs = -Infinity;
    for (const actionId of liveActionIds) {
      const recordPath = claudeId01RecordPathFor(projectRootOrRepoDescriptor, sessionGenerationId, worktreeId, planDigest, role, agentDigest, actionId);
      const read = readRegistryRecord(recordPath);
      if (!read.ok || read.absent || !read.obj) continue;
      const rec = read.obj;
      if (typeof rec.created_at !== 'string' || !isCanonicalIsoUtc(rec.created_at)) continue;
      const createdMs = isoToMsForRegistry(rec.created_at);
      if (createdMs > bestCreatedMs) {
        bestCreatedMs = createdMs;
        bestPath = recordPath;
      }
    }
    return bestPath;
  }
  function isClaudeId01ProofCompleteRecord(rec) {
    return !!rec && rec.schema === CLAUDE_ID01_ATTESTATION_SCHEMA && rec.proof_complete === true;
  }
  const CLAUDE_ID01_ATTESTATION_KEYS = Object.freeze([
    'agent_digest', 'completed_at', 'created_at', 'distinct_pretooluse_after_resume_count',
    'distinct_pretooluse_before_resume_count', 'expiry', 'plan_digest', 'proof_complete',
    'role', 'schema', 'session_generation_digest', 'subagent_start_count', 'worktree_id',
  ]);
  function isClaudeId01AttestationWellFormed(rec) {
    if (!rec || !hasExactKeys(rec, CLAUDE_ID01_ATTESTATION_KEYS)) return false;
    if (rec.schema !== CLAUDE_ID01_ATTESTATION_SCHEMA || rec.proof_complete !== true) return false;
    if (!isHexDigest64(rec.worktree_id) || !isHexDigest64(rec.plan_digest)) return false;
    if (!CANONICAL_ROLES.includes(rec.role)) return false;
    if (!isHexDigest64(rec.agent_digest) || !isHexDigest64(rec.session_generation_digest)) return false;
    if (
      !Number.isInteger(rec.subagent_start_count) || rec.subagent_start_count < 2
      || rec.subagent_start_count > CLAUDE_ID01_MAX_SUBAGENT_START_COUNT
      || !Number.isInteger(rec.distinct_pretooluse_before_resume_count) || rec.distinct_pretooluse_before_resume_count < 2
      || rec.distinct_pretooluse_before_resume_count > CLAUDE_ID01_MAX_TOOL_USE_IDS
      || !Number.isInteger(rec.distinct_pretooluse_after_resume_count) || rec.distinct_pretooluse_after_resume_count < 1
      || rec.distinct_pretooluse_after_resume_count > CLAUDE_ID01_MAX_TOOL_USE_IDS
    ) {
      return false;
    }
    if (!isCanonicalIsoUtc(rec.created_at) || !isCanonicalIsoUtc(rec.completed_at) || !isCanonicalIsoUtc(rec.expiry)) {
      return false;
    }
    const createdMs = isoToMsForRegistry(rec.created_at);
    const completedMs = isoToMsForRegistry(rec.completed_at);
    const expiryMs = isoToMsForRegistry(rec.expiry);
    if (createdMs > completedMs) return false;
    const nowMs = currentClockMsForRegistry();
    if (createdMs > nowMs || completedMs > nowMs) return false;
    if (completedMs > expiryMs) return false;
    return true;
  }
  function buildFreshClaudeId01Trace(sessionId, agentId, agentType, worktreeId, planDigest) {
    const nowStr = nowIsoForRegistry();
    return {
      schema: CLAUDE_ID01_TRACE_SCHEMA,
      session_id: sessionId,
      agent_id: agentId,
      agent_type: agentType,
      worktree_id: worktreeId,
      plan_digest: planDigest,
      subagent_start_count: 1,
      resumed: false,
      tool_use_ids_before_resume: [],
      tool_use_ids_after_resume: [],
      created_at: nowStr,
      expiry: isoPlusSecondsForRegistry(nowStr, CLAUDE_ID01_TRACE_TTL_SECONDS),
    };
  }
  const CLAUDE_ID01_TRACE_KEYS = Object.freeze([
    'agent_id', 'agent_type', 'created_at', 'expiry', 'plan_digest', 'resumed',
    'schema', 'session_id', 'subagent_start_count', 'tool_use_ids_after_resume',
    'tool_use_ids_before_resume', 'worktree_id',
  ]);
  function isWellFormedClaudeId01ToolUseIdBucket(arr) {
    if (!Array.isArray(arr) || arr.length > CLAUDE_ID01_MAX_TOOL_USE_IDS) return false;
    return arr.every((id) => typeof id === 'string' && id.length > 0);
  }
  function isClaudeId01RawTraceWellFormed(rec) {
    if (!rec || !hasExactKeys(rec, CLAUDE_ID01_TRACE_KEYS)) return false;
    if (rec.schema !== CLAUDE_ID01_TRACE_SCHEMA) return false;
    if (typeof rec.session_id !== 'string' || rec.session_id.length === 0) return false;
    if (typeof rec.agent_id !== 'string' || rec.agent_id.length === 0) return false;
    if (typeof rec.agent_type !== 'string' || !CANONICAL_ROLES.includes(rec.agent_type)) return false;
    if (!isHexDigest64(rec.worktree_id) || !isHexDigest64(rec.plan_digest)) return false;
    if (typeof rec.resumed !== 'boolean') return false;
    if (
      !Number.isInteger(rec.subagent_start_count) || rec.subagent_start_count < 1
      || rec.subagent_start_count > CLAUDE_ID01_MAX_SUBAGENT_START_COUNT
    ) {
      return false;
    }
    if (
      !isWellFormedClaudeId01ToolUseIdBucket(rec.tool_use_ids_before_resume)
      || !isWellFormedClaudeId01ToolUseIdBucket(rec.tool_use_ids_after_resume)
    ) {
      return false;
    }
    if (!hasUniqueValues(rec.tool_use_ids_before_resume.concat(rec.tool_use_ids_after_resume))) return false;
    if (!isCanonicalIsoUtc(rec.created_at) || !isCanonicalIsoUtc(rec.expiry)) return false;
    const createdMs = isoToMsForRegistry(rec.created_at);
    const expiryMs = isoToMsForRegistry(rec.expiry);
    if (createdMs > expiryMs) return false;
    if (createdMs > currentClockMsForRegistry()) return false;
    return true;
  }
  function recordClaudeId01Event(eventsDir, kind, fileNameSuffix) {
    const fileName = (kind === 'pretooluse' ? 'tooluse-' + fileNameSuffix : 'start-' + crypto.randomBytes(8).toString('hex')) + '.json';
    try {
      publishNoClobber(
        path.join(eventsDir, fileName),
        Buffer.from(canonicalJSONStringify({ schema: CLAUDE_ID01_EVENT_SCHEMA, kind, observed_at: nowIsoForRegistry(), observed_at_ms: Date.now() }), 'utf8'),
      );
    } catch { /* best-effort -- an EEXIST replay or a genuine write failure both leave the caller to re-derive from whatever facts already exist */ }
  }
  function clearClaudeId01Events(eventsDir) {
    try {
      fs.rmSync(eventsDir, { recursive: true, force: true });
    } catch { /* best-effort */ }
  }
  function deriveClaudeId01StateFromEvents(eventsDir) {
    let entries;
    try {
      entries = fs.readdirSync(eventsDir, { withFileTypes: true });
    } catch {
      return { subagentStartCount: 0, beforeCount: 0, afterCount: 0 };
    }
    if (entries.length > CLAUDE_ID01_EVENTS_SCAN_CAP) {
      return { subagentStartCount: 0, beforeCount: 0, afterCount: 0 };
    }
    const startMs = [];
    const preToolUseMs = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const read = readRegistryRecord(path.join(eventsDir, entry.name));
      if (!read.ok || read.absent || !read.obj) continue;
      const rec = read.obj;
      if (
        rec.schema !== CLAUDE_ID01_EVENT_SCHEMA
        || !isCanonicalIsoUtc(rec.observed_at)
        || typeof rec.observed_at_ms !== 'number'
        || !Number.isFinite(rec.observed_at_ms)
        || rec.observed_at_ms <= 0
      ) continue;
      const ms = rec.observed_at_ms;
      if (rec.kind === 'subagent-start') {
        startMs.push(ms);
      } else if (rec.kind === 'pretooluse') {
        preToolUseMs.push(ms);
      }
    }
    startMs.sort((a, b) => a - b);
    const subagentStartCount = Math.min(startMs.length, CLAUDE_ID01_MAX_SUBAGENT_START_COUNT);
    const resumeBoundaryMs = startMs.length >= 2 ? startMs[1] : null;
    let beforeCount = 0;
    let afterCount = 0;
    for (const ms of preToolUseMs) {
      if (resumeBoundaryMs === null || ms < resumeBoundaryMs) {
        if (beforeCount < CLAUDE_ID01_MAX_TOOL_USE_IDS) beforeCount += 1;
      } else if (afterCount < CLAUDE_ID01_MAX_TOOL_USE_IDS) {
        afterCount += 1;
      }
    }
    return { subagentStartCount, beforeCount, afterCount };
  }
  function isClaudeId01CapabilityWellFormed(rec, sessionGenerationId, worktreeId, planDigest) {
    if (!rec || !hasExactKeys(rec, CLAUDE_ID01_CAPABILITY_KEYS)) return false;
    if (
      rec.schema !== CLAUDE_ID01_CAPABILITY_SCHEMA
      || rec.proof_complete !== true
      || rec.primary_sequence_complete !== true
      || rec.same_role_peer_observed !== true
      || rec.distinct_spawn_actions_observed !== true
      || rec.distinct_peer_count !== 2
      || rec.worktree_id !== worktreeId
      || rec.plan_digest !== planDigest
      || rec.session_generation_digest !== sha256String(sessionGenerationId)
      || !Number.isInteger(rec.primary_pretooluse_before_count)
      || rec.primary_pretooluse_before_count < 2
      || rec.primary_pretooluse_before_count > CLAUDE_ID01_MAX_TOOL_USE_IDS
      || !Number.isInteger(rec.primary_pretooluse_after_count)
      || rec.primary_pretooluse_after_count < 1
      || rec.primary_pretooluse_after_count > CLAUDE_ID01_MAX_TOOL_USE_IDS
      || !isCanonicalIsoUtc(rec.created_at)
      || !isCanonicalIsoUtc(rec.completed_at)
      || !isCanonicalIsoUtc(rec.expiry)
    ) return false;
    const createdMs = isoToMsForRegistry(rec.created_at);
    const completedMs = isoToMsForRegistry(rec.completed_at);
    const expiryMs = isoToMsForRegistry(rec.expiry);
    const nowMs = currentClockMsForRegistry();
    return createdMs <= completedMs && completedMs <= expiryMs && completedMs <= nowMs && nowMs < expiryMs;
  }
  function checkClaudeId01CapabilityCompleteByGeneration(projectRootOrRepoDescriptor, sessionGenerationId, worktreeId, planDigest) {
    const read = readRegistryRecord(claudeId01CapabilityPathFor(
      projectRootOrRepoDescriptor, sessionGenerationId, worktreeId, planDigest,
    ));
    if (!read.ok || read.absent || !read.obj) return { ok: false, reason: 'claude-id01-capability-absent' };
    if (!isClaudeId01CapabilityWellFormed(read.obj, sessionGenerationId, worktreeId, planDigest)) {
      return { ok: false, reason: 'claude-id01-capability-invalid' };
    }
    return { ok: true };
  }
  function maybePromoteClaudeId01Capability(projectRoot, sessionId, worktreeId, planDigest, sessionGenerationId, role) {
    const liveActionIds = findLiveClaudeNativeRoleSpawnActionIds(
      projectRoot, worktreeId, planDigest, role, sessionGenerationId,
    );
    if (liveActionIds.length < 2) return { ok: false, reason: 'claude-id01-distinct-actions-absent' };
    const tracesDir = path.join(registryRepoDir(projectRoot), 'claude-id01-traces');
    let entries;
    try {
      entries = fs.readdirSync(tracesDir, { withFileTypes: true });
    } catch {
      return { ok: false, reason: 'claude-id01-traces-absent' };
    }
    if (entries.length > CLAUDE_ID01_LIVE_ACTION_SCAN_CAP) {
      return { ok: false, reason: 'claude-id01-traces-overflow' };
    }
    const byAction = new Map();
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const read = readRegistryRecord(path.join(tracesDir, entry.name));
      if (!read.ok || read.absent || !read.obj) continue;
      const rec = read.obj;
      let agentDigest;
      let complete = false;
      let expiry;
      let beforeCount = 0;
      let afterCount = 0;
      if (isClaudeId01AttestationWellFormed(rec)) {
        if (
          rec.worktree_id !== worktreeId || rec.plan_digest !== planDigest || rec.role !== role
          || rec.session_generation_digest !== sha256String(sessionGenerationId)
          || currentClockMsForRegistry() >= isoToMsForRegistry(rec.expiry)
        ) continue;
        agentDigest = rec.agent_digest;
        complete = true;
        expiry = rec.expiry;
        beforeCount = rec.distinct_pretooluse_before_resume_count;
        afterCount = rec.distinct_pretooluse_after_resume_count;
      } else if (isClaudeId01RawTraceWellFormed(rec)) {
        if (
          rec.session_id !== sessionId || rec.worktree_id !== worktreeId
          || rec.plan_digest !== planDigest || rec.agent_type !== role
          || currentClockMsForRegistry() >= isoToMsForRegistry(rec.expiry)
        ) continue;
        agentDigest = sha256String(rec.agent_id);
        expiry = rec.expiry;
      } else {
        continue;
      }
      const matchingActions = liveActionIds.filter((actionId) => (
        path.basename(claudeId01RecordPathFor(
          projectRoot, sessionGenerationId, worktreeId, planDigest, role, agentDigest, actionId,
        )) === entry.name
      ));
      if (matchingActions.length !== 1) continue;
      const actionId = matchingActions[0];
      if (byAction.has(actionId)) return { ok: false, reason: 'claude-id01-action-ambiguous' };
      if (!complete) {
        const derived = deriveClaudeId01StateFromEvents(claudeId01EventsDirFor(
          projectRoot, sessionGenerationId, worktreeId, planDigest, role, agentDigest, actionId,
        ));
        if (derived.subagentStartCount < 1) continue;
      }
      byAction.set(actionId, { actionId, agentDigest, complete, expiry, beforeCount, afterCount });
    }
    const candidates = Array.from(byAction.values());
    let pair = null;
    for (const primary of candidates.filter((candidate) => candidate.complete)) {
      const peer = candidates.find((candidate) => (
        candidate.actionId !== primary.actionId && candidate.agentDigest !== primary.agentDigest
      ));
      if (peer) { pair = { primary, peer }; break; }
    }
    if (!pair) return { ok: false, reason: 'claude-id01-distinct-peer-absent' };
    const generationRead = readRegistryRecord(sessionGenerationPathFor(projectRoot, {
      provider: 'claude-hook', runtime_session_key: sessionId,
    }));
    if (
      !generationRead.ok || generationRead.absent || !generationRead.obj
      || !hasExactKeys(generationRead.obj, SESSION_GENERATION_KEYS)
      || generationRead.obj.generation_id !== sessionGenerationId
      || !isCanonicalIsoUtc(generationRead.obj.expires_at)
    ) return { ok: false, reason: 'claude-id01-generation-unresolvable' };
    const expiryMs = Math.min(
      isoToMsForRegistry(pair.primary.expiry),
      isoToMsForRegistry(pair.peer.expiry),
      isoToMsForRegistry(generationRead.obj.expires_at),
    );
    if (!(expiryMs > currentClockMsForRegistry())) return { ok: false, reason: 'claude-id01-capability-expired' };
    const capabilityPath = claudeId01CapabilityPathFor(projectRoot, sessionGenerationId, worktreeId, planDigest);
    const lockResult = withRegistryLock(
      claudeId01CapabilityLockDirFor(projectRoot, sessionGenerationId, worktreeId, planDigest),
      () => {
        const existing = readRegistryRecord(capabilityPath);
        if (
          existing.ok && !existing.absent
          && isClaudeId01CapabilityWellFormed(existing.obj, sessionGenerationId, worktreeId, planDigest)
        ) return { ok: true };
        const nowStr = nowIsoForRegistry();
        const record = {
          schema: CLAUDE_ID01_CAPABILITY_SCHEMA,
          session_generation_digest: sha256String(sessionGenerationId),
          worktree_id: worktreeId,
          plan_digest: planDigest,
          proof_complete: true,
          primary_sequence_complete: true,
          same_role_peer_observed: true,
          distinct_spawn_actions_observed: true,
          distinct_peer_count: 2,
          primary_pretooluse_before_count: pair.primary.beforeCount,
          primary_pretooluse_after_count: pair.primary.afterCount,
          created_at: nowStr,
          completed_at: nowStr,
          expiry: new Date(expiryMs).toISOString().replace(/\.\d{3}Z$/, 'Z'),
        };
        const write = writeRegistryRecordReplace(capabilityPath, Buffer.from(canonicalJSONStringify(record), 'utf8'));
        return write.ok ? { ok: true } : { ok: false, reason: write.reason };
      },
    );
    if (!lockResult.ok) return { ok: false, reason: lockResult.reason };
    return lockResult.value;
  }
  function writeClaudeId01SummaryFromEvents(recordPath, eventsDir, existingTraceFields, role, agentDigest, sessionGenerationId) {
    const derived = deriveClaudeId01StateFromEvents(eventsDir);
    const proofComplete = derived.subagentStartCount >= 2 && derived.beforeCount >= 2 && derived.afterCount >= 1;
    if (proofComplete) {
      const attestation = {
        schema: CLAUDE_ID01_ATTESTATION_SCHEMA,
        worktree_id: existingTraceFields.worktreeId,
        plan_digest: existingTraceFields.planDigest,
        role,
        agent_digest: agentDigest,
        session_generation_digest: sha256String(sessionGenerationId),
        proof_complete: true,
        subagent_start_count: derived.subagentStartCount,
        distinct_pretooluse_before_resume_count: derived.beforeCount,
        distinct_pretooluse_after_resume_count: derived.afterCount,
        created_at: existingTraceFields.createdAt,
        completed_at: nowIsoForRegistry(),
        expiry: existingTraceFields.expiry,
      };
      writeRegistryRecordReplace(recordPath, Buffer.from(canonicalJSONStringify(attestation), 'utf8'));
      return;
    }
    const trace = {
      schema: CLAUDE_ID01_TRACE_SCHEMA,
      session_id: existingTraceFields.sessionId,
      agent_id: existingTraceFields.agentId,
      agent_type: role,
      worktree_id: existingTraceFields.worktreeId,
      plan_digest: existingTraceFields.planDigest,
      subagent_start_count: derived.subagentStartCount,
      resumed: derived.subagentStartCount >= 2,
      tool_use_ids_before_resume: existingTraceFields.toolUseIdsBeforeResume,
      tool_use_ids_after_resume: existingTraceFields.toolUseIdsAfterResume,
      created_at: existingTraceFields.createdAt,
      expiry: existingTraceFields.expiry,
    };
    writeRegistryRecordReplace(recordPath, Buffer.from(canonicalJSONStringify(trace), 'utf8'));
  }

  return Object.freeze({
    CLAUDE_ID01_LIVE_ACTION_SCAN_CAP,
    findLiveClaudeNativeRoleSpawnActionIds,
    resolveClaudeId01ActionIdForSubagentStart,
    resolveClaudeId01ActionIdForPreToolUse,
    resolveClaudeId01RecordPathForCheck,
    isClaudeId01ProofCompleteRecord,
    CLAUDE_ID01_ATTESTATION_KEYS,
    isClaudeId01AttestationWellFormed,
    buildFreshClaudeId01Trace,
    CLAUDE_ID01_TRACE_KEYS,
    isWellFormedClaudeId01ToolUseIdBucket,
    isClaudeId01RawTraceWellFormed,
    recordClaudeId01Event,
    clearClaudeId01Events,
    deriveClaudeId01StateFromEvents,
    isClaudeId01CapabilityWellFormed,
    checkClaudeId01CapabilityCompleteByGeneration,
    maybePromoteClaudeId01Capability,
    writeClaudeId01SummaryFromEvents,
  });
}

module.exports = { createClaudeId01Trace };
