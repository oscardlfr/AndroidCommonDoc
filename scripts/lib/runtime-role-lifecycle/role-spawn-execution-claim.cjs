'use strict';

// Extracted behaviorally from runtime-role-lifecycle.cjs: RoleSpawnExecutionClaim/v2
// -- proof that the PreToolUse(Agent) gate atomically reserved a role-spawn/
// claude-native action for one exact Agent-tool call's own tool_input.
// Depends one-way on the orchestrator-role-bindings module (injected).
// Never requires the facade or a sibling module.

function createRoleSpawnExecutionClaim({
  path, crypto, registryRepoDir, readRegistryRecord, ensureSecureRegistryDir, publishNoClobber,
  canonicalJSONStringify, sha256String, isHexDigest64, isoToMsForRegistry, currentClockMsForRegistry,
  nowIsoForRegistry, hasExactKeys, resolvePolicyPair, actionTtlPolicyLimitSeconds,
  validateMainOrchestratorBindingFor,
}) {
// ─────────────────────────────────────────────────────────────────────────────
// Third HOLD, Part B: RoleSpawnExecutionClaim/v1 -- a THIRD, DISTINCT claim
// type from SupervisorExecutionClaim/v1 above (never reused/extended -- a
// role-spawn Agent-tool reservation is a structurally different authority
// than a supervisor-start host-process execution claim). Mirrors
// SupervisorExecutionClaim's shape (no-clobber record, scoped to action_id,
// triple-bound expiry, atomic one-use `.consumed` marker) but is keyed for
// `role-spawn`/`claude-native` actions specifically, carries a freshly
// CSPRNG-minted `reservation_id` (the per-attempt "receipt" identity a later
// confirming SubagentStart correlates against) and the action's own `role`
// field (never null for a role-spawn action), and digests the ACTUAL
// tool_input the Agent-tool call carried rather than a bridge_argv.
//
// CRITICAL: unlike mintSupervisorExecutionClaim, this mint function is
// NEVER gated behind isFakeExecutorCapability() (or any test-only flag) --
// the whole point of this HOLD is making Agent-tool spawning genuinely,
// unconditionally reserve/commit-gated in real production. The no-clobber
// publish itself is what makes "only one invocation may win the reservation
// for a given action_id" atomic (a second/replayed mint attempt collides
// EEXIST).
// ─────────────────────────────────────────────────────────────────────────────

function canonicalNativeAgentInputForAction(action) {
  if (!action || action.runtime !== 'claude-native' ||
      !['role-spawn', 'root-source-spawn'].includes(action.kind) || !action.payload) return null;
  const agentType = action.payload.agent_type;
  const name = action.kind === 'role-spawn' ? action.payload.teammate_name : action.payload.name;
  const prompt = action.payload.bootstrap_message;
  if (typeof agentType !== 'string' || agentType.length === 0 ||
      typeof name !== 'string' || name.length === 0 || typeof prompt !== 'string' || prompt.length === 0) return null;
  return {
    description: `${agentType} runtime bootstrap`,
    subagent_type: agentType,
    name,
    prompt,
    // Persistent support-plane roles are started concurrently so an atomic
    // five-action ensure cannot consume later actions' immutable startup TTL
    // while earlier foreground Agent calls block. Root-source is bounded work,
    // not a parked support actor, and therefore remains foreground.
    run_in_background: action.kind === 'role-spawn',
  };
}

function renderCanonicalNativeAgentInput(action, proposedInput, requestedModel) {
  const canonicalInput = canonicalNativeAgentInputForAction(action);
  if (!canonicalInput || !proposedInput || typeof proposedInput !== 'object' || Array.isArray(proposedInput)) {
    return { ok: false, reason: 'native-agent-input-invalid' };
  }
  const allowed = new Set(['description', 'subagent_type', 'name', 'prompt', 'run_in_background', 'model']);
  const unknown = Object.keys(proposedInput).filter((key) => !allowed.has(key));
  if (unknown.length > 0) return { ok: false, reason: 'native-agent-input-unknown-field' };
  if (proposedInput.subagent_type !== canonicalInput.subagent_type) {
    return { ok: false, reason: 'native-agent-input-subtype-mismatch' };
  }
  if (Object.prototype.hasOwnProperty.call(proposedInput, 'run_in_background')
      && proposedInput.run_in_background !== canonicalInput.run_in_background) {
    return { ok: false, reason: 'native-agent-input-background-mismatch' };
  }
  if (Object.prototype.hasOwnProperty.call(proposedInput, 'model') &&
      (typeof requestedModel !== 'string' || proposedInput.model !== requestedModel)) {
    return { ok: false, reason: 'native-agent-input-model-mismatch' };
  }
  const canonicalInputDigest = sha256String(canonicalJSONStringify(canonicalInput));
  const proposedInputDigest = sha256String(canonicalJSONStringify(proposedInput));
  return {
    ok: true,
    canonicalInput,
    canonicalInputDigest,
    proposedInputDigest,
    modelDeviation: canonicalInputDigest !== proposedInputDigest,
  };
}

const ROLE_SPAWN_EXECUTION_CLAIM_SCHEMA = 'runtime/role-spawn-execution-claim/v2';
const ROLE_SPAWN_EXECUTION_CLAIM_KEYS = Object.freeze([
  'action_digest', 'action_id', 'canonical_input_digest', 'created_at',
  'execution_state', 'expiry', 'main_binding_id', 'model_deviation',
  'plan_digest', 'proposed_input_digest', 'reservation_id', 'role',
  'runtime_session_digest', 'schema', 'session_generation_id',
  'source_tool_use_id_digest', 'worktree_id',
]);

function roleSpawnExecutionClaimPathFor(projectRootOrRepoId, actionId) {
  return path.join(registryRepoDir(projectRootOrRepoId), 'role-spawn-execution-claims', actionId + '.json');
}

function roleSpawnExecutionClaimConsumedMarkerPathFor(projectRootOrRepoId, actionId) {
  return path.join(registryRepoDir(projectRootOrRepoId), 'role-spawn-execution-claims', actionId + '.consumed');
}

/**
 * Mints one no-clobber RoleSpawnExecutionClaim/v2 for a `role-spawn`/
 * `claude-native` action -- proof that the PreToolUse(Agent) gate atomically
 * reserved this exact action for THIS exact Agent-tool call's own
 * tool_input. Resolves+validates the referenced MainOrchestratorBinding end
 * to end (existence, exact schema, binding_id/repo/worktree/plan/session
 * correlation, not expired -- validateMainOrchestratorBindingFor) and bounds
 * the claim's own expiry by `min(action.expires_at, binding.expiry,
 * now+readyTimeoutSeconds)` -- never a fixed constant, mirroring
 * mintSupervisorExecutionClaim's own discipline. An action whose OWN
 * expires_at has already passed therefore always fails here too (the min()
 * bound collapses to a past instant), with no separate expiry check needed.
 * @param {{repoId:string}} repoDescriptor
 * @param {object} action - a `role-spawn`/`claude-native` role-lifecycle-action.
 * @param {string} mainBindingId
 * @param {object} correlation - native session/tool-use identity plus canonical/proposed input audit digests.
 * @param {number} readyTimeoutSeconds - the resolved policy's own bound.
 * @returns {{ok:true,claimPath:string,record:object}|{ok:false,reason:string}}
 */
function mintRoleSpawnExecutionClaim(repoDescriptor, action, mainBindingId, correlation, readyTimeoutSeconds) {
  if (!action || action.kind !== 'role-spawn' || action.runtime !== 'claude-native' || typeof action.role !== 'string') {
    return { ok: false, reason: 'wrong-action-kind' };
  }
  if (!correlation || typeof correlation !== 'object' ||
      typeof correlation.runtimeSessionId !== 'string' || correlation.runtimeSessionId.length === 0 ||
      typeof correlation.sourceToolUseId !== 'string' || correlation.sourceToolUseId.length === 0 ||
      !isHexDigest64(correlation.canonicalInputDigest) || !isHexDigest64(correlation.proposedInputDigest) ||
      typeof correlation.modelDeviation !== 'boolean') return { ok: false, reason: 'claim-correlation-invalid' };
  if (!Number.isInteger(readyTimeoutSeconds) || readyTimeoutSeconds < 1) return { ok: false, reason: 'ready-timeout-seconds-invalid' };

  const bindingResult = validateMainOrchestratorBindingFor(repoDescriptor, mainBindingId, action);
  if (!bindingResult.ok) return { ok: false, reason: bindingResult.reason };

  const nowMs = currentClockMsForRegistry();
  const actionExpiryMs = isoToMsForRegistry(action.expires_at);
  const bindingExpiryMs = isoToMsForRegistry(bindingResult.binding.expiry);
  const policyBoundMs = nowMs + readyTimeoutSeconds * 1000;
  const expiryMs = Math.min(actionExpiryMs, bindingExpiryMs, policyBoundMs);
  if (!(expiryMs > nowMs)) return { ok: false, reason: 'no-positive-ttl-remaining' };

  const claimPath = roleSpawnExecutionClaimPathFor(repoDescriptor, action.action_id);
  const dirResult = ensureSecureRegistryDir(path.dirname(claimPath));
  if (!dirResult.ok) return { ok: false, reason: dirResult.reason };
  const record = {
    schema: ROLE_SPAWN_EXECUTION_CLAIM_SCHEMA,
    action_id: action.action_id,
    main_binding_id: mainBindingId,
    session_generation_id: action.session_generation_id,
    plan_digest: action.plan_digest,
    worktree_id: action.worktree_id,
    role: action.role,
    action_digest: sha256String(canonicalJSONStringify(action)),
    runtime_session_digest: sha256String(correlation.runtimeSessionId),
    source_tool_use_id_digest: sha256String(correlation.sourceToolUseId),
    canonical_input_digest: correlation.canonicalInputDigest,
    proposed_input_digest: correlation.proposedInputDigest,
    model_deviation: correlation.modelDeviation,
    reservation_id: crypto.randomBytes(16).toString('hex'),
    created_at: nowIsoForRegistry(),
    expiry: new Date(expiryMs).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    execution_state: 'ISSUED',
  };
  if (!hasExactKeys(record, ROLE_SPAWN_EXECUTION_CLAIM_KEYS)) return { ok: false, reason: 'internal-key-set-mismatch' };
  try {
    publishNoClobber(claimPath, Buffer.from(canonicalJSONStringify(record), 'utf8'), {});
  } catch (err) {
    return { ok: false, reason: 'role-spawn-execution-claim-already-issued' };
  }
  return { ok: true, claimPath, record };
}

/**
 * Validates+atomically-consumes the role-spawn execution claim for
 * `action.action_id` against the exact expected scope. Every field is
 * checked independently and fails closed: exact key-set closure, schema,
 * `execution_state==='ISSUED'`, action/session/plan/worktree/role/
 * tool-input correlation, finite ISO timestamps with `created_at<=expiry`,
 * a triple-bound expiry re-validation (action.expires_at, policy,
 * binding.expiry -- never merely the claim's own cached values), and a FULL
 * independent re-resolution of the referenced MainOrchestratorBinding
 * (never merely trusting the claim's own recorded fields). Consumption uses
 * the same no-clobber `.consumed`-marker idiom as `SupervisorExecutionClaim`
 * so a replayed confirmation for the same action collides EEXIST.
 * @param {{repoId:string}|string} repoDescriptor
 * @param {object} action
 * @param {string} expectedToolInputDigest
 * @param {string} projectRoot
 * @returns {{ok:true,claim:object}|{ok:false,reason:string}}
 */
function validateAndConsumeRoleSpawnExecutionClaim(repoDescriptor, action, observation, projectRoot) {
  const claimRead = readRegistryRecord(roleSpawnExecutionClaimPathFor(repoDescriptor, action.action_id));
  if (!claimRead.ok) return { ok: false, reason: claimRead.reason };
  if (claimRead.absent) return { ok: false, reason: 'role-spawn-execution-claim-absent' };
  const claim = claimRead.obj;

  if (!hasExactKeys(claim, ROLE_SPAWN_EXECUTION_CLAIM_KEYS)) return { ok: false, reason: 'role-spawn-execution-claim-key-set-invalid' };
  if (claim.schema !== ROLE_SPAWN_EXECUTION_CLAIM_SCHEMA) return { ok: false, reason: 'role-spawn-execution-claim-schema-invalid' };
  if (claim.execution_state !== 'ISSUED') return { ok: false, reason: 'role-spawn-execution-claim-not-issued' };
  if (typeof claim.action_id !== 'string' || claim.action_id !== action.action_id) return { ok: false, reason: 'role-spawn-execution-claim-action-id-mismatch' };
  if (claim.session_generation_id !== action.session_generation_id) return { ok: false, reason: 'role-spawn-execution-claim-session-mismatch' };
  if (claim.plan_digest !== action.plan_digest) return { ok: false, reason: 'role-spawn-execution-claim-plan-mismatch' };
  if (claim.worktree_id !== action.worktree_id) return { ok: false, reason: 'role-spawn-execution-claim-worktree-mismatch' };
  if (claim.role !== action.role) return { ok: false, reason: 'role-spawn-execution-claim-role-mismatch' };
  if (!observation || typeof observation.sessionId !== 'string' || observation.sessionId.length === 0 ||
      typeof observation.agentId !== 'string' || observation.agentId.length === 0 ||
      typeof observation.agentType !== 'string' || observation.agentType.length === 0) {
    return { ok: false, reason: 'role-spawn-execution-claim-observation-invalid' };
  }
  if (claim.action_digest !== sha256String(canonicalJSONStringify(action))) return { ok: false, reason: 'role-spawn-execution-claim-action-digest-mismatch' };
  if (claim.runtime_session_digest !== sha256String(observation.sessionId)) return { ok: false, reason: 'role-spawn-execution-claim-runtime-session-mismatch' };
  if (!isHexDigest64(claim.source_tool_use_id_digest)) return { ok: false, reason: 'role-spawn-execution-claim-tool-use-invalid' };
  const canonicalInput = canonicalNativeAgentInputForAction(action);
  if (!canonicalInput || claim.canonical_input_digest !== sha256String(canonicalJSONStringify(canonicalInput))) {
    return { ok: false, reason: 'role-spawn-execution-claim-canonical-input-mismatch' };
  }
  if (!isHexDigest64(claim.proposed_input_digest) || typeof claim.model_deviation !== 'boolean') {
    return { ok: false, reason: 'role-spawn-execution-claim-proposal-audit-invalid' };
  }
  if (observation.agentType !== canonicalInput.subagent_type) return { ok: false, reason: 'role-spawn-execution-claim-agent-type-mismatch' };

  const createdAtMs = isoToMsForRegistry(claim.created_at);
  const expiryMs = isoToMsForRegistry(claim.expiry);
  if (!Number.isFinite(createdAtMs) || !Number.isFinite(expiryMs)) return { ok: false, reason: 'role-spawn-execution-claim-timestamp-invalid' };
  if (!(createdAtMs <= expiryMs)) return { ok: false, reason: 'role-spawn-execution-claim-timestamp-order-invalid' };
  const nowMsForClaim = currentClockMsForRegistry();
  if (createdAtMs > nowMsForClaim) return { ok: false, reason: 'role-spawn-execution-claim-created-in-future' };
  if (nowMsForClaim >= expiryMs) return { ok: false, reason: 'role-spawn-execution-claim-expired' };

  // Re-validate expiry against the CURRENT action and policy, not merely the
  // claim's own stored expiry -- mirrors validateAndConsumeExecutionClaim's
  // own triple-bound re-validation discipline exactly.
  const actionExpiryMsForClaim = isoToMsForRegistry(action.expires_at);
  if (Number.isFinite(actionExpiryMsForClaim) && expiryMs > actionExpiryMsForClaim) {
    return { ok: false, reason: 'role-spawn-execution-claim-expiry-exceeds-action' };
  }
  const policyPairForClaim = resolvePolicyPair(projectRoot);
  if (!policyPairForClaim.ok) return { ok: false, reason: 'role-spawn-execution-claim-policy-invalid' };
  const policyLimitForClaim = actionTtlPolicyLimitSeconds(policyPairForClaim.policy, {
    kind: action.kind, runtime: action.runtime,
  });
  const policyBoundMsForClaim = createdAtMs + policyLimitForClaim * 1000;
  if (expiryMs > policyBoundMsForClaim) return { ok: false, reason: 'role-spawn-execution-claim-expiry-exceeds-policy' };

  const bindingResult = validateMainOrchestratorBindingFor(repoDescriptor, claim.main_binding_id, action);
  if (!bindingResult.ok) return { ok: false, reason: 'role-spawn-execution-claim-' + bindingResult.reason };
  const bindingExpiryMsForClaim = isoToMsForRegistry(bindingResult.binding.expiry);
  if (!Number.isFinite(bindingExpiryMsForClaim) || expiryMs > bindingExpiryMsForClaim) {
    return { ok: false, reason: 'role-spawn-execution-claim-expiry-exceeds-binding' };
  }

  // Atomic one-use consumption -- LAST, only after every other check passes.
  const dir = path.dirname(roleSpawnExecutionClaimConsumedMarkerPathFor(repoDescriptor, action.action_id));
  const dirResult = ensureSecureRegistryDir(dir);
  if (!dirResult.ok) return { ok: false, reason: dirResult.reason };
  try {
    publishNoClobber(roleSpawnExecutionClaimConsumedMarkerPathFor(repoDescriptor, action.action_id), Buffer.from(canonicalJSONStringify({ consumed_at: nowIsoForRegistry() }), 'utf8'), {});
  } catch (err) {
    return { ok: false, reason: 'role-spawn-execution-claim-replay' };
  }
  return { ok: true, claim };
}

  return Object.freeze({
    canonicalNativeAgentInputForAction, renderCanonicalNativeAgentInput,
    ROLE_SPAWN_EXECUTION_CLAIM_SCHEMA, ROLE_SPAWN_EXECUTION_CLAIM_KEYS,
    roleSpawnExecutionClaimPathFor, roleSpawnExecutionClaimConsumedMarkerPathFor,
    mintRoleSpawnExecutionClaim, validateAndConsumeRoleSpawnExecutionClaim,
  });
}

module.exports = { createRoleSpawnExecutionClaim };
