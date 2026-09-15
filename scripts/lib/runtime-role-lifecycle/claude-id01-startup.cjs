'use strict';

/** startup portion of the CLAUDE-ID-01 lifecycle authority. */
function createClaudeId01Startup(deps) {
  const {
    CLAUDE_ID01_EVENTS_SCAN_CAP,
    fs,
    path,
    CANONICAL_ROLES,
    GRANT_KEYS,
    LIFECYCLE_GRANT_SCHEMA,
    ROLE_SPAWN_EXECUTION_CLAIM_KEYS,
    ROLE_SPAWN_EXECUTION_CLAIM_SCHEMA,
    actionPathFor,
    canonicalJSONStringify,
    computeClaudeAuthorityIdentityId,
    currentClockMsForRegistry,
    grantConsumedMarkerPathFor,
    grantPathFor,
    hasExactKeys,
    isCanonicalIsoUtc,
    isHexActionId,
    isHexDigest64,
    isoToMsForRegistry,
    nowIsoForRegistry,
    peekSessionGeneration,
    publishNoClobber,
    readClaudeAuthorityFence,
    readRegistryRecord,
    readRoleBindingState,
    registryRepoDir,
    loadClaudeHost,
    roleProfileDigestFor,
    roleSpawnExecutionClaimConsumedMarkerPathFor,
    sha256String,
    validateRoleActorBindingFor,
  } = deps;

  const CLAUDE_STARTUP_ACTOR_SCHEMA = 'runtime/claude-startup-actor/v1';
  const CLAUDE_STARTUP_READY_PRE_SCHEMA = 'runtime/claude-startup-ready-pre/v1';
  const CLAUDE_STARTUP_READY_OUTCOME_SCHEMA = 'runtime/claude-startup-ready-outcome/v1';
  const CLAUDE_ID01_CAPABILITY_V2_SCHEMA = 'runtime/claude-id01-capability/v2';
  const CLAUDE_STARTUP_ACTOR_KEYS = Object.freeze([
    'action_digest', 'action_id', 'actor_binding_id', 'agent_digest', 'claim_digest',
    'created_at', 'expiry', 'host_contract_digest', 'plan_digest', 'role', 'schema',
    'session_digest', 'session_generation_digest', 'worktree_id',
  ].sort());
  const CLAUDE_STARTUP_READY_PRE_KEYS = Object.freeze([
    'action_digest', 'action_id', 'actor_binding_id', 'agent_digest', 'claim_digest',
    'created_at', 'expiry', 'grant_digest', 'grant_id', 'plan_digest', 'role', 'schema',
    'session_digest', 'session_generation_digest', 'tool_use_digest', 'worktree_id',
  ].sort());
  const CLAUDE_STARTUP_READY_OUTCOME_KEYS = Object.freeze([
    'action_digest', 'action_id', 'actor_binding_id', 'agent_digest', 'claim_digest',
    'completed_at', 'grant_digest', 'grant_id', 'outcome', 'pre_digest', 'role',
    'schema', 'session_digest', 'session_generation_digest', 'tool_use_digest',
  ].sort());
  const CLAUDE_ID01_CAPABILITY_V2_KEYS = Object.freeze([
    'completed_at', 'created_at', 'expiry', 'host_contract_digest', 'plan_digest',
    'schema', 'session_generation_digest', 'startup_actor_observed',
    'startup_trace_digest', 'worktree_id',
  ].sort());
  function isNonEmptyBoundedString(value, maxLength) {
    return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
  }
  function claudeStartupLookupKeyByDigest(sessionGenerationId, agentDigest) {
    return sha256String('claude-startup-v2:' + sessionGenerationId + ':' + agentDigest);
  }
  function claudeStartupActorPathFor(projectRootOrRepoDescriptor, sessionGenerationId, agentId) {
    return path.join(registryRepoDir(projectRootOrRepoDescriptor), 'claude-id01-traces',
      'startup-v2-' + claudeStartupLookupKeyByDigest(sessionGenerationId, sha256String(agentId)) + '.json');
  }
  function claudeStartupReadyPrePathFor(projectRootOrRepoDescriptor, sessionId, toolUseId) {
    return path.join(registryRepoDir(projectRootOrRepoDescriptor), 'claude-id01-trace-events',
      'startup-ready-pre-' + sha256String(sessionId + '\0' + toolUseId) + '.json');
  }
  function claudeStartupReadyOutcomePathFor(projectRootOrRepoDescriptor, sessionId, toolUseId) {
    return path.join(registryRepoDir(projectRootOrRepoDescriptor), 'claude-id01-trace-events',
      'startup-ready-outcome-' + sha256String(sessionId + '\0' + toolUseId) + '.json');
  }
  function claudeId01CapabilityV2PathFor(projectRootOrRepoDescriptor, sessionGenerationId, agentId) {
    return path.join(registryRepoDir(projectRootOrRepoDescriptor), 'claude-id01-capabilities',
      'v2-' + claudeStartupLookupKeyByDigest(sessionGenerationId, sha256String(agentId)) + '.json');
  }
  function claudeId01CapabilityV2PathForDigest(projectRootOrRepoDescriptor, sessionGenerationId, agentDigest) {
    return path.join(registryRepoDir(projectRootOrRepoDescriptor), 'claude-id01-capabilities',
      'v2-' + claudeStartupLookupKeyByDigest(sessionGenerationId, agentDigest) + '.json');
  }
  function isConsumedRoleSpawnClaim(repoDescriptor, action, claim) {
    if (!claim || !hasExactKeys(claim, ROLE_SPAWN_EXECUTION_CLAIM_KEYS) ||
        claim.schema !== ROLE_SPAWN_EXECUTION_CLAIM_SCHEMA || claim.action_id !== action.action_id ||
        claim.action_digest !== sha256String(canonicalJSONStringify(action)) ||
        claim.session_generation_id !== action.session_generation_id || claim.plan_digest !== action.plan_digest ||
        claim.worktree_id !== action.worktree_id || claim.role !== action.role) return false;
    return fs.existsSync(roleSpawnExecutionClaimConsumedMarkerPathFor(repoDescriptor, action.action_id));
  }
  function readCurrentClaudeSessionEvidence(projectRoot, sessionId) {
    try {
      return loadClaudeHost().getProductionSessionIdentity(projectRoot, sessionId);
    } catch {
      return { ok: false };
    }
  }
  function recordClaudeStartupActorObservation(projectRoot, observed) {
    try {
      const { sessionId, agentId, agentType, action, claim, actorBinding } = observed || {};
      if (!isNonEmptyBoundedString(sessionId, 4096) || !isNonEmptyBoundedString(agentId, 4096) || !CANONICAL_ROLES.includes(agentType) ||
          !action || action.kind !== 'role-spawn' || action.runtime !== 'claude-native' || action.role !== agentType ||
          !actorBinding || actorBinding.role !== agentType || actorBinding.session_generation_id !== action.session_generation_id ||
          actorBinding.worktree_id !== action.worktree_id || actorBinding.plan_digest !== action.plan_digest ||
          claim.runtime_session_digest !== sha256String(sessionId) ||
          !isConsumedRoleSpawnClaim({ repoId: action.repo_id }, action, claim)) return { ok: false, reason: 'startup-actor-correlation-invalid' };
      const binding = validateRoleActorBindingFor({ repoId: action.repo_id }, actorBinding.binding_id,
        action.role, action.worktree_id, action.plan_digest);
      if (!binding.ok || binding.binding.session_generation_id !== action.session_generation_id) {
        return { ok: false, reason: 'startup-actor-binding-invalid' };
      }
      const session = readCurrentClaudeSessionEvidence(projectRoot, sessionId);
      if (!session.ok || session.record.worktree_id !== action.worktree_id || session.record.plan_digest !== action.plan_digest) {
        return { ok: false, reason: 'startup-actor-session-unproven' };
      }
      const generation = peekSessionGeneration(projectRoot, { provider: 'claude-hook', runtime_session_key: sessionId });
      if (!generation.ok || generation.generationId !== action.session_generation_id) {
        return { ok: false, reason: 'startup-actor-generation-invalid' };
      }
      const expiryMs = Math.min(isoToMsForRegistry(binding.binding.expiry), Date.parse(session.record.expires_at),
        Date.parse(generation.expiresAt));
      if (!(expiryMs > currentClockMsForRegistry())) return { ok: false, reason: 'startup-actor-expired' };
      const record = {
        schema: CLAUDE_STARTUP_ACTOR_SCHEMA,
        session_digest: sha256String(sessionId),
        agent_digest: sha256String(agentId),
        role: agentType,
        action_id: action.action_id,
        action_digest: sha256String(canonicalJSONStringify(action)),
        claim_digest: sha256String(canonicalJSONStringify(claim)),
        actor_binding_id: actorBinding.binding_id,
        worktree_id: action.worktree_id,
        plan_digest: action.plan_digest,
        session_generation_digest: sha256String(action.session_generation_id),
        host_contract_digest: session.record.host_contract_digest,
        created_at: nowIsoForRegistry(),
        expiry: new Date(expiryMs).toISOString().replace(/\.\d{3}Z$/, 'Z'),
      };
      if (!hasExactKeys(record, CLAUDE_STARTUP_ACTOR_KEYS)) return { ok: false, reason: 'startup-actor-shape-invalid' };
      const destination = claudeStartupActorPathFor(projectRoot, action.session_generation_id, agentId);
      try { publishNoClobber(destination, Buffer.from(canonicalJSONStringify(record), 'utf8'), {}); }
      catch {
        const existing = readRegistryRecord(destination);
        if (!existing.ok || existing.absent || canonicalJSONStringify(existing.obj) !== canonicalJSONStringify(record)) {
          return { ok: false, reason: 'startup-actor-conflict' };
        }
        return { ok: true, record: existing.obj, idempotent: true };
      }
      return { ok: true, record, idempotent: false };
    } catch {
      return { ok: false, reason: 'startup-actor-record-failed' };
    }
  }
  function recordClaudeStartupReadyPreObservation(projectRoot, observed) {
    try {
      const { sessionId, agentId, agentType, toolUseId, action, actorBinding, grantId } = observed || {};
      if (!isNonEmptyBoundedString(sessionId, 4096) || !isNonEmptyBoundedString(agentId, 4096) || !isNonEmptyBoundedString(toolUseId, 4096) ||
          !CANONICAL_ROLES.includes(agentType) || !action || action.role !== agentType || !actorBinding ||
          !isHexActionId(actorBinding.binding_id) || !isHexActionId(grantId)) {
        return { ok: false, reason: 'startup-ready-pre-input-invalid' };
      }
      const traceRead = readRegistryRecord(claudeStartupActorPathFor(projectRoot, action.session_generation_id, agentId));
      if (!traceRead.ok || traceRead.absent || !hasExactKeys(traceRead.obj, CLAUDE_STARTUP_ACTOR_KEYS)) {
        return { ok: false, reason: 'startup-ready-actor-trace-absent' };
      }
      const trace = traceRead.obj;
      if (trace.schema !== CLAUDE_STARTUP_ACTOR_SCHEMA || trace.session_digest !== sha256String(sessionId) ||
          trace.agent_digest !== sha256String(agentId) || trace.role !== agentType || trace.action_id !== action.action_id ||
          trace.actor_binding_id !== actorBinding.binding_id || currentClockMsForRegistry() >= isoToMsForRegistry(trace.expiry)) {
        return { ok: false, reason: 'startup-ready-actor-trace-mismatch' };
      }
      const binding = validateRoleActorBindingFor({ repoId: action.repo_id }, actorBinding.binding_id,
        action.role, action.worktree_id, action.plan_digest);
      const grantRead = readRegistryRecord(grantPathFor({ repoId: action.repo_id }, grantId));
      if (!binding.ok || binding.binding.session_generation_id !== action.session_generation_id ||
          !grantRead.ok || grantRead.absent || !hasExactKeys(grantRead.obj, GRANT_KEYS) ||
          grantRead.obj.schema !== LIFECYCLE_GRANT_SCHEMA || grantRead.obj.grant_id !== grantId ||
          grantRead.obj.binding_id !== actorBinding.binding_id || grantRead.obj.action_id !== action.action_id ||
          grantRead.obj.subcommand !== 'ready' || grantRead.obj.authority !== 'target' || grantRead.obj.profile !== 'target') {
        return { ok: false, reason: 'startup-ready-grant-invalid' };
      }
      const expiryMs = Math.min(isoToMsForRegistry(trace.expiry), isoToMsForRegistry(grantRead.obj.expiry));
      if (!(expiryMs > currentClockMsForRegistry())) return { ok: false, reason: 'startup-ready-pre-expired' };
      const record = {
        schema: CLAUDE_STARTUP_READY_PRE_SCHEMA,
        session_digest: sha256String(sessionId), tool_use_digest: sha256String(toolUseId),
        agent_digest: sha256String(agentId), role: agentType,
        action_id: action.action_id, action_digest: trace.action_digest, claim_digest: trace.claim_digest,
        actor_binding_id: actorBinding.binding_id, grant_id: grantId,
        grant_digest: sha256String(canonicalJSONStringify(grantRead.obj)),
        worktree_id: action.worktree_id, plan_digest: action.plan_digest,
        session_generation_digest: sha256String(action.session_generation_id),
        created_at: nowIsoForRegistry(), expiry: new Date(expiryMs).toISOString().replace(/\.\d{3}Z$/, 'Z'),
      };
      const destination = claudeStartupReadyPrePathFor(projectRoot, sessionId, toolUseId);
      try { publishNoClobber(destination, Buffer.from(canonicalJSONStringify(record), 'utf8'), {}); }
      catch { return { ok: false, reason: 'startup-ready-pre-replay' }; }
      return { ok: true, record };
    } catch {
      return { ok: false, reason: 'startup-ready-pre-record-failed' };
    }
  }
  function isClaudeId01CapabilityV2WellFormed(record, trace, generationId, nowMs) {
    if (!record || !hasExactKeys(record, CLAUDE_ID01_CAPABILITY_V2_KEYS) ||
        record.schema !== CLAUDE_ID01_CAPABILITY_V2_SCHEMA || record.startup_actor_observed !== true ||
        record.session_generation_digest !== sha256String(generationId) || record.worktree_id !== trace.worktree_id ||
        record.plan_digest !== trace.plan_digest || record.host_contract_digest !== trace.host_contract_digest ||
        record.startup_trace_digest !== sha256String(canonicalJSONStringify(trace)) ||
        !isCanonicalIsoUtc(record.created_at) || !isCanonicalIsoUtc(record.completed_at) || !isCanonicalIsoUtc(record.expiry)) return false;
    const created = isoToMsForRegistry(record.created_at);
    const completed = isoToMsForRegistry(record.completed_at);
    const expiry = isoToMsForRegistry(record.expiry);
    return created <= completed && completed <= expiry && completed <= nowMs && nowMs < expiry;
  }
  function recordClaudeStartupReadyOutcome(projectRoot, event) {
    try {
      if (!event || event.hook_event_name !== 'PostToolUse' || event.tool_name !== 'Bash' ||
          !isNonEmptyBoundedString(event.session_id, 4096) || !isNonEmptyBoundedString(event.tool_use_id, 4096)) {
        return { ok: false, reason: 'startup-ready-outcome-input-invalid' };
      }
      const prePath = claudeStartupReadyPrePathFor(projectRoot, event.session_id, event.tool_use_id);
      const preRead = readRegistryRecord(prePath);
      if (!preRead.ok || preRead.absent || !hasExactKeys(preRead.obj, CLAUDE_STARTUP_READY_PRE_KEYS) ||
          preRead.obj.schema !== CLAUDE_STARTUP_READY_PRE_SCHEMA ||
          preRead.obj.session_digest !== sha256String(event.session_id) ||
          preRead.obj.tool_use_digest !== sha256String(event.tool_use_id) ||
          currentClockMsForRegistry() >= isoToMsForRegistry(preRead.obj.expiry)) {
        return { ok: false, reason: 'startup-ready-pre-invalid' };
      }
      const pre = preRead.obj;
      if ((event.agent_id !== undefined && sha256String(event.agent_id) !== pre.agent_digest) ||
          (event.agent_type !== undefined && event.agent_type !== pre.role)) {
        return { ok: false, reason: 'startup-ready-outcome-actor-mismatch' };
      }
      const actionRead = readRegistryRecord(actionPathFor(projectRoot, pre.action_id));
      const grantRead = readRegistryRecord(grantPathFor(projectRoot, pre.grant_id));
      if (!actionRead.ok || actionRead.absent || pre.action_digest !== sha256String(canonicalJSONStringify(actionRead.obj)) ||
          !grantRead.ok || grantRead.absent || pre.grant_digest !== sha256String(canonicalJSONStringify(grantRead.obj)) ||
          !fs.existsSync(grantConsumedMarkerPathFor(projectRoot, pre.grant_id))) {
        return { ok: false, reason: 'startup-ready-outcome-correlation-invalid' };
      }
      const action = actionRead.obj;
      const binding = validateRoleActorBindingFor(projectRoot, pre.actor_binding_id, pre.role, pre.worktree_id, pre.plan_digest);
      if (!binding.ok || sha256String(binding.binding.session_generation_id) !== pre.session_generation_digest) {
        return { ok: false, reason: 'startup-ready-outcome-binding-invalid' };
      }
      const profileDigest = roleProfileDigestFor(pre.role);
      const state = readRoleBindingState(projectRoot, pre.worktree_id, pre.plan_digest, profileDigest,
        action.session_generation_id, pre.role);
      if (!state.ok || state.state !== 'READY' || Object.prototype.hasOwnProperty.call(state.record, 'pending_action_id')) {
        return { ok: false, reason: 'startup-ready-outcome-not-ready' };
      }
      const tracePath = claudeStartupActorPathFor(projectRoot, action.session_generation_id,
        typeof event.agent_id === 'string' ? event.agent_id : null);
      let traceRead = typeof event.agent_id === 'string' ? readRegistryRecord(tracePath) : { ok: false, absent: true };
      if (!traceRead.ok || traceRead.absent) {
        const tracesDir = path.join(registryRepoDir(projectRoot), 'claude-id01-traces');
        let entries;
        try { entries = fs.readdirSync(tracesDir, { withFileTypes: true }); } catch { entries = []; }
        const candidates = [];
        if (entries.length <= CLAUDE_ID01_EVENTS_SCAN_CAP) {
          for (const entry of entries) {
            if (!entry.isFile() || !entry.name.startsWith('startup-v2-') || !entry.name.endsWith('.json')) continue;
            const read = readRegistryRecord(path.join(tracesDir, entry.name));
            if (read.ok && !read.absent && read.obj && read.obj.agent_digest === pre.agent_digest &&
                read.obj.action_id === pre.action_id) candidates.push(read);
          }
        }
        if (candidates.length !== 1) return { ok: false, reason: 'startup-ready-outcome-trace-ambiguous' };
        traceRead = candidates[0];
      }
      const trace = traceRead.obj;
      if (!hasExactKeys(trace, CLAUDE_STARTUP_ACTOR_KEYS) || trace.schema !== CLAUDE_STARTUP_ACTOR_SCHEMA ||
          trace.agent_digest !== pre.agent_digest || trace.action_id !== pre.action_id ||
          trace.actor_binding_id !== pre.actor_binding_id || trace.claim_digest !== pre.claim_digest) {
        return { ok: false, reason: 'startup-ready-outcome-trace-invalid' };
      }
      const outcome = {
        schema: CLAUDE_STARTUP_READY_OUTCOME_SCHEMA,
        session_digest: pre.session_digest, tool_use_digest: pre.tool_use_digest,
        agent_digest: pre.agent_digest, role: pre.role, action_id: pre.action_id,
        action_digest: pre.action_digest, claim_digest: pre.claim_digest,
        actor_binding_id: pre.actor_binding_id, grant_id: pre.grant_id, grant_digest: pre.grant_digest,
        pre_digest: sha256String(canonicalJSONStringify(pre)), outcome: 'SUCCEEDED',
        session_generation_digest: pre.session_generation_digest, completed_at: nowIsoForRegistry(),
      };
      if (!hasExactKeys(outcome, CLAUDE_STARTUP_READY_OUTCOME_KEYS)) return { ok: false, reason: 'startup-ready-outcome-shape-invalid' };
      const outcomePath = claudeStartupReadyOutcomePathFor(projectRoot, event.session_id, event.tool_use_id);
      try { publishNoClobber(outcomePath, Buffer.from(canonicalJSONStringify(outcome), 'utf8'), {}); }
      catch {
        const existing = readRegistryRecord(outcomePath);
        if (!existing.ok || existing.absent || canonicalJSONStringify(existing.obj) !== canonicalJSONStringify(outcome)) {
          return { ok: false, reason: 'startup-ready-outcome-conflict' };
        }
      }
      const expiryMs = Math.min(isoToMsForRegistry(trace.expiry), isoToMsForRegistry(binding.binding.expiry));
      if (!(expiryMs > currentClockMsForRegistry())) return { ok: false, reason: 'startup-ready-capability-expired' };
      const nowStr = nowIsoForRegistry();
      const capability = {
        schema: CLAUDE_ID01_CAPABILITY_V2_SCHEMA,
        session_generation_digest: pre.session_generation_digest,
        worktree_id: pre.worktree_id, plan_digest: pre.plan_digest,
        host_contract_digest: trace.host_contract_digest,
        startup_trace_digest: sha256String(canonicalJSONStringify(trace)),
        startup_actor_observed: true, created_at: trace.created_at, completed_at: nowStr,
        expiry: new Date(expiryMs).toISOString().replace(/\.\d{3}Z$/, 'Z'),
      };
      const capabilityPath = claudeId01CapabilityV2PathForDigest(projectRoot, action.session_generation_id, pre.agent_digest);
      try { publishNoClobber(capabilityPath, Buffer.from(canonicalJSONStringify(capability), 'utf8'), {}); }
      catch { return { ok: false, reason: 'startup-ready-capability-conflict' }; }
      return { ok: true, outcome, capability };
    } catch {
      return { ok: false, reason: 'startup-ready-outcome-record-failed' };
    }
  }
  function checkClaudeId01ActorStartupProof(projectRootOrRepoDescriptor, sessionId, worktreeId, planDigest, role, agentId) {
    if (!isNonEmptyBoundedString(sessionId, 4096) || !isNonEmptyBoundedString(agentId, 4096) || !CANONICAL_ROLES.includes(role) ||
        !isHexDigest64(worktreeId) || !isHexDigest64(planDigest)) return { ok: false, reason: 'claude-id01-missing-scope' };
    const generation = peekSessionGeneration(projectRootOrRepoDescriptor, { provider: 'claude-hook', runtime_session_key: sessionId });
    if (!generation.ok) return { ok: false, reason: 'claude-id01-generation-unresolvable' };
    const traceRead = readRegistryRecord(claudeStartupActorPathFor(projectRootOrRepoDescriptor, generation.generationId, agentId));
    if (!traceRead.ok || traceRead.absent || !hasExactKeys(traceRead.obj, CLAUDE_STARTUP_ACTOR_KEYS)) {
      return { ok: false, reason: 'claude-id01-startup-trace-absent' };
    }
    const trace = traceRead.obj;
    if (trace.schema !== CLAUDE_STARTUP_ACTOR_SCHEMA || trace.session_digest !== sha256String(sessionId) ||
        trace.agent_digest !== sha256String(agentId) || trace.role !== role || trace.worktree_id !== worktreeId ||
        trace.plan_digest !== planDigest || trace.session_generation_digest !== sha256String(generation.generationId) ||
        currentClockMsForRegistry() >= isoToMsForRegistry(trace.expiry)) {
      return { ok: false, reason: 'claude-id01-startup-trace-invalid' };
    }
    const binding = validateRoleActorBindingFor(projectRootOrRepoDescriptor, trace.actor_binding_id, role, worktreeId, planDigest);
    if (!binding.ok || binding.binding.session_generation_id !== generation.generationId) {
      return { ok: false, reason: 'claude-id01-actor-binding-invalid' };
    }
    const fence = readClaudeAuthorityFence(projectRootOrRepoDescriptor,
      computeClaudeAuthorityIdentityId(projectRootOrRepoDescriptor, 'claude-hook', sessionId, agentId));
    if (!fence.ok || !fence.absent) return { ok: false, reason: 'claude-id01-actor-fenced' };
    const capabilityRead = readRegistryRecord(claudeId01CapabilityV2PathFor(
      projectRootOrRepoDescriptor, generation.generationId, agentId,
    ));
    if (!capabilityRead.ok || capabilityRead.absent ||
        !isClaudeId01CapabilityV2WellFormed(capabilityRead.obj, trace, generation.generationId, currentClockMsForRegistry())) {
      return { ok: false, reason: 'claude-id01-capability-invalid' };
    }
    const session = readCurrentClaudeSessionEvidence(projectRootOrRepoDescriptor, sessionId);
    if (!session.ok || session.record.host_contract_digest !== trace.host_contract_digest) {
      return { ok: false, reason: 'claude-id01-host-contract-invalid' };
    }
    return { ok: true, trace, capability: capabilityRead.obj, binding: binding.binding };
  }
  function checkClaudeId01RuntimeCapability(projectRootOrRepoDescriptor, sessionId, worktreeId, planDigest, role, agentId) {
    if (role === undefined || agentId === undefined) {
      return { ok: false, reason: 'claude-id01-actor-scope-required' };
    }
    return checkClaudeId01ActorStartupProof(
      projectRootOrRepoDescriptor, sessionId, worktreeId, planDigest, role, agentId,
    );
  }
  function checkClaudeId01ProofComplete(projectRootOrRepoDescriptor, sessionId, worktreeId, planDigest, role, agentId) {
    if (
      typeof sessionId !== 'string' || sessionId.length === 0
      || typeof worktreeId !== 'string' || worktreeId.length === 0
      || typeof planDigest !== 'string' || planDigest.length === 0
      || typeof role !== 'string' || role.length === 0
      || typeof agentId !== 'string' || agentId.length === 0
    ) {
      return { ok: false, reason: 'claude-id01-missing-scope' };
    }
    return checkClaudeId01RuntimeCapability(
      projectRootOrRepoDescriptor, sessionId, worktreeId, planDigest, role, agentId,
    );
  }

  return Object.freeze({
    CLAUDE_STARTUP_ACTOR_SCHEMA,
    CLAUDE_STARTUP_READY_PRE_SCHEMA,
    CLAUDE_STARTUP_READY_OUTCOME_SCHEMA,
    CLAUDE_ID01_CAPABILITY_V2_SCHEMA,
    CLAUDE_STARTUP_ACTOR_KEYS,
    CLAUDE_STARTUP_READY_PRE_KEYS,
    CLAUDE_STARTUP_READY_OUTCOME_KEYS,
    CLAUDE_ID01_CAPABILITY_V2_KEYS,
    isNonEmptyBoundedString,
    claudeStartupLookupKeyByDigest,
    claudeStartupActorPathFor,
    claudeStartupReadyPrePathFor,
    claudeStartupReadyOutcomePathFor,
    claudeId01CapabilityV2PathFor,
    claudeId01CapabilityV2PathForDigest,
    isConsumedRoleSpawnClaim,
    readCurrentClaudeSessionEvidence,
    recordClaudeStartupActorObservation,
    recordClaudeStartupReadyPreObservation,
    isClaudeId01CapabilityV2WellFormed,
    recordClaudeStartupReadyOutcome,
    checkClaudeId01ActorStartupProof,
    checkClaudeId01RuntimeCapability,
    checkClaudeId01ProofComplete,
  });
}

module.exports = { createClaudeId01Startup };
