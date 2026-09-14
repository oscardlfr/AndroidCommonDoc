'use strict';

function createClaudeOneShotRecord(deps) {
  const {
    CANONICAL_ROLES,
    CLAUDE_AUTHORITY_IDENTITY_SCHEMA,
    admitClaudeAuthorityOperation,
    canonicalJSONStringify,
    checkClaudeAuthorityClassificationAgainstExpected,
    checkOneShotTransactionTerminalAbsent,
    classifyClaudeAuthorityForIdentity,
    computeClaudeAuthorityIdentityId,
    consumeClaudeAgentSpawnReservationMarker,
    crypto,
    currentClockMsForRegistry,
    hasExactKeys,
    isCanonicalIsoUtc,
    isHexActionId,
    isHexCsprng32,
    isHexDigest64,
    isIntInRangeNum,
    isoPlusSecondsForRegistry,
    isoToMsForRegistry,
    nowIsoForRegistry,
    path,
    peekSessionGeneration,
    peekValidateClaudeAgentSpawnReservation,
    readClaudeAuthorityFence,
    readRegistryRecord,
    registryRepoDir,
    resolveM7RepoId,
    testM7Rendezvous,
    writeGuardedByClaudeAuthorityAdmission,
    writeRegistryRecordReplace,
  } = deps;

const CLAUDE_ONE_SHOT_BINDING_SCHEMA = 'runtime/claude-one-shot-binding/v1';
const CLAUDE_ONE_SHOT_BINDING_KEYS = Object.freeze([
  'actor_instance_id', 'agent_id', 'agent_type', 'attempt_id', 'binding_id',
  'created_at', 'expiry', 'lease_epoch', 'native_spawn_action_id', 'plan_digest',
  'request_id', 'role', 'runtime_session_key', 'schema', 'worktree_id',
]);
// M7 section 4.3: exact v1 key-set plus session_generation_id, nothing else.
const CLAUDE_ONE_SHOT_BINDING_SCHEMA_V2 = 'runtime/claude-one-shot-binding/v2';
const CLAUDE_ONE_SHOT_BINDING_KEYS_V2 = Object.freeze(
  CLAUDE_ONE_SHOT_BINDING_KEYS.concat(['session_generation_id']).sort()
);
// No pre-existing ceiling constant fits this binding's own scope
// (ACTION_TTL_CEILING_SECONDS bounds DiskConsumerRegistration and startup
// actions; ROLE_ACTOR_BINDING_TTL_CEILING_SECONDS bounds the genuinely
// PERSISTENT RoleActorBinding concept -- neither is this binding's own
// single dispatched one-shot consultation attempt) -- mirrors
// SESSION_GENERATION_TTL_SECONDS's own 3600s (one hour) bound instead:
// generous enough for a live in-flight Agent() turn, still a hard ceiling,
// never unbounded.
const CLAUDE_ONE_SHOT_BINDING_TTL_CEILING_SECONDS = 3600;

function claudeOneShotBindingPathFor(projectRootOrRepoDescriptor, bindingId) {
  return path.join(registryRepoDir(projectRootOrRepoDescriptor), 'claude-one-shot-bindings', bindingId + '.json');
}

/**
 * Mints one ClaudeOneShotBinding/v1 (PLAN.md §15d, ~L614, verbatim closed
 * key-set). Every correlated field is independently shape-validated before
 * anything is written -- exactly like createRoleActorBinding's own "no
 * hook-observed identity to lean on" discipline. The caller,
 * subagent-start-context-bundle.js's SubagentStart handler
 * (tryConsumeClaudeAgentOneShotReservation), is responsible for proving each
 * field against a real, committed ActivationAction/observed SubagentStart
 * BEFORE calling this -- this function only proves internal well-formedness,
 * never re-derives or independently re-verifies correlation against any
 * other record itself (it has no `action`/spawn-gate record to check
 * against at this layer).
 * @param {string} projectRoot
 * @param {string} runtimeSessionKey - PLAN.md ~L590's Claude tuple `session_id`.
 * @param {string} sessionGenerationId - M7 GREEN section 4.1: the ALREADY-
 *   consumed reservation's own session_generation_id (the caller's
 *   `consumeResult.reservation.session_generation_id`), never re-resolved or
 *   re-derived here -- this constructor performs a pure peek-and-compare
 *   against the identity's current live generation, never a mint-or-reuse.
 * @param {string} agentId - the SPAWNED sub-agent's own observed `agent_id`
 *   (SubagentStart) -- never empty (unlike RequesterBinding's `agent_key`,
 *   which legitimately IS empty for the main orchestrator; a one-shot
 *   claude-agent spawn is never the main orchestrator).
 * @param {string} agentType - the host-derived canonical agent_type the
 *   Agent() call was invoked with.
 * @param {string} nativeSpawnActionId - core-generated during `dispatch`
 *   (PLAN.md ~L612: "Dispatch first commits ... activation (including
 *   core-generated native_spawn_action_id)").
 * @param {string} requestId
 * @param {string} attemptId
 * @param {number} leaseEpoch
 * @param {string} role - the target role of the underlying consultation.
 * @param {string} worktreeId
 * @param {string} planDigest
 * @param {number} ttlSeconds
 * @returns {{ok:true,binding:object}|{ok:false,reason:string}}
 */
/**
 * M7 GREEN correction round 2, R1: `preWriteHook` (private, never part of
 * the public 13-argument ABI below) runs INSIDE the guarded write, under
 * the SAME one-use admission capability, immediately before the binding
 * record itself is written -- never before admission, never as an
 * independent, already-committed operation. This is how
 * consumeClaudeAgentSpawnReservationAndCreateOneShotBinding consumes the
 * B1 reservation only after the full authority predicate (fence/terminal/
 * generation, via admitClaudeAuthorityOperation below) has already been
 * proven live for THIS exact identity: a durable cut observed by admission
 * denies here, before preWriteHook ever runs, leaving the reservation
 * genuinely ISSUED. A preWriteHook failure aborts before the binding write
 * ever runs, exactly like any other writeFn failure.
 */
function createClaudeOneShotBindingInternal(
  projectRoot, runtimeSessionKey, sessionGenerationId, agentId, agentType, nativeSpawnActionId,
  requestId, attemptId, leaseEpoch, role, worktreeId, planDigest, ttlSeconds, preWriteHook,
) {
  if (typeof runtimeSessionKey !== 'string' || runtimeSessionKey.length === 0) return { ok: false, reason: 'invalid-runtime-session-key' };
  if (!isHexCsprng32(sessionGenerationId)) return { ok: false, reason: 'invalid-session-generation-id' };
  if (typeof agentId !== 'string' || agentId.length === 0) return { ok: false, reason: 'invalid-agent-id' };
  if (!CANONICAL_ROLES.includes(agentType)) return { ok: false, reason: 'invalid-agent-type' };
  if (!isHexActionId(nativeSpawnActionId)) return { ok: false, reason: 'invalid-native-spawn-action-id' };
  if (!isHexDigest64(requestId)) return { ok: false, reason: 'invalid-request-id' };
  if (!isHexDigest64(attemptId)) return { ok: false, reason: 'invalid-attempt-id' };
  if (!isIntInRangeNum(leaseEpoch, 0, Number.MAX_SAFE_INTEGER)) return { ok: false, reason: 'invalid-lease-epoch' };
  if (!CANONICAL_ROLES.includes(role)) return { ok: false, reason: 'invalid-role' };
  // M7 defect 3 (checklist item 7, section 4.3): a one-shot binding's own
  // persisted agent_type must equal its own persisted role -- both are
  // independently canonical, but the spawn's own CLAIM (agentType) diverging
  // from the actually-granted authority (role) is never permitted.
  if (agentType !== role) return { ok: false, reason: 'claude-one-shot-agent-type-role-mismatch' };
  if (!isHexDigest64(worktreeId)) return { ok: false, reason: 'invalid-worktree-id' };
  if (!isHexDigest64(planDigest)) return { ok: false, reason: 'invalid-plan-digest' };
  if (!isIntInRangeNum(ttlSeconds, 1, CLAUDE_ONE_SHOT_BINDING_TTL_CEILING_SECONDS)) return { ok: false, reason: 'invalid-ttl' };

  // M7 GREEN section 4.1: session_generation_id comes from the CONSUMED
  // reservation the caller already resolved -- a pure peek against the
  // identity's current live generation (never resolveSessionGeneration,
  // which would mint-or-reuse and could silently diverge from the supplied
  // id). A mismatch means the supplied id is stale relative to whatever
  // generation is live right now.
  const genResult = peekSessionGeneration(projectRoot, { provider: 'claude-hook', runtime_session_key: runtimeSessionKey });
  if (!genResult.ok) return { ok: false, reason: genResult.reason };
  if (genResult.generationId !== sessionGenerationId) return { ok: false, reason: 'binding-generation-mismatch' };

  const authorityIdentity = {
    schema: CLAUDE_AUTHORITY_IDENTITY_SCHEMA, provider: 'claude-hook',
    repo_id: resolveM7RepoId(projectRoot), runtime_session_key: runtimeSessionKey, agent_id: agentId,
  };

  // M7 defect 2 (section 6: "exactly one candidate may be reused only by its
  // same family and exact current scope/role"): classify BEFORE admission --
  // an identical repeat of this exact logical spawn reuses the SAME binding,
  // never mints a genuinely independent second one. A different family or a
  // same-family-but-different-scope candidate is left to admission's own
  // expected:ABSENT pass below, which already denies both (defect 1).
  const preClassification = classifyClaudeAuthorityForIdentity(projectRoot, authorityIdentity);
  if (!preClassification.ok) return preClassification;
  if (preClassification.state === 'ONE' && preClassification.family === 'one-shot') {
    const existing = preClassification.binding;
    if (
      existing.native_spawn_action_id === nativeSpawnActionId && existing.request_id === requestId
      && existing.attempt_id === attemptId && existing.lease_epoch === leaseEpoch
      && existing.agent_type === agentType && existing.role === role
      && existing.worktree_id === worktreeId && existing.plan_digest === planDigest
    ) {
      // M7 CORRECTION C4 (Codex final ruling): before returning an existing
      // reused binding, rerun the complete predicate INCLUDING the
      // applicable transaction terminal -- a terminal-existing retry must
      // never return the old (now-stale) binding as if reuse were still
      // safe.
      const reuseTerminalCheck = checkOneShotTransactionTerminalAbsent(projectRoot, existing);
      if (!reuseTerminalCheck.ok) return reuseTerminalCheck;
      return { ok: true, binding: existing };
    }
  }

  // M7 section 7 / section 8.1 steps 2-4: obtain create-binding admission
  // through the canonical classifier's full final predicate pass -- a
  // durably-fenced identity, or any other live candidate, is rejected here,
  // cut-first.
  const bindingId = crypto.randomBytes(16).toString('hex');
  const nowStr = nowIsoForRegistry();
  let expiryIso = isoPlusSecondsForRegistry(nowStr, ttlSeconds);
  // M7 defect 3 (checklist item 6): cap expiry to the backing session
  // generation's own remaining lifetime, exactly like createRequesterBinding
  // already does -- a one-shot binding must never legitimately outlive the
  // session identity that justified minting it.
  if (isoToMsForRegistry(genResult.expiresAt) < isoToMsForRegistry(expiryIso)) {
    expiryIso = genResult.expiresAt;
  }
  // M7 CORRECTION C4 (Codex final ruling): a genuinely NEW create has no
  // existing backing for admission's own step-5 terminal check to examine
  // (create-binding always expects ABSENT, so that check is skipped
  // entirely for this operationKind) -- the PROPOSED request/attempt scope
  // is validated directly here, before the write, using the same
  // family-proof primitive mintRoleCommandGrant's own Phase-A already uses.
  const proposedTerminalCheck = checkOneShotTransactionTerminalAbsent(projectRoot, { plan_digest: planDigest, request_id: requestId, attempt_id: attemptId });
  if (!proposedTerminalCheck.ok) return proposedTerminalCheck;

  testM7Rendezvous('create-one-shot-after-phase-a-before-admission', projectRoot);
  // M7 FINAL REMEDIATION Part A, Stage B (Codex architecture_ruling,
  // one_shot): the proposed transaction scope is independently supplied to
  // admission itself, so a terminal that becomes durable during the pause
  // above is still observed -- inside admission, after the fence/deadline
  // predicate and before the one-use capability is minted -- never only by
  // the early, non-authoritative precheck above.
  const admission = admitClaudeAuthorityOperation(projectRoot, authorityIdentity, 'create-binding', expiryIso, undefined, { plan_digest: planDigest, request_id: requestId, attempt_id: attemptId });
  if (!admission.ok) return { ok: false, reason: admission.reason };

  const binding = {
    schema: CLAUDE_ONE_SHOT_BINDING_SCHEMA_V2,
    binding_id: bindingId,
    actor_instance_id: crypto.randomBytes(16).toString('hex'),
    runtime_session_key: runtimeSessionKey,
    agent_id: agentId,
    agent_type: agentType,
    native_spawn_action_id: nativeSpawnActionId,
    request_id: requestId,
    attempt_id: attemptId,
    lease_epoch: leaseEpoch,
    role,
    worktree_id: worktreeId,
    plan_digest: planDigest,
    session_generation_id: sessionGenerationId,
    created_at: nowStr,
    expiry: expiryIso,
  };
  const bindingPath = claudeOneShotBindingPathFor(projectRoot, bindingId);
  testM7Rendezvous('create-after-admission-before-write', projectRoot);
  const writeResult = writeGuardedByClaudeAuthorityAdmission(admission.capability, 'create-binding', () => {
    if (preWriteHook) {
      const hookResult = preWriteHook();
      if (!hookResult.ok) return hookResult;
    }
    return writeRegistryRecordReplace(bindingPath, Buffer.from(canonicalJSONStringify(binding), 'utf8'));
  });
  if (!writeResult.ok) return { ok: false, reason: writeResult.reason };
  // M7 section 7 / defect 4: rerun the full predicate -- the cross-family
  // classifier, not just the fence -- after the write and before returning
  // success. A fence OR a concurrent conflicting/ambiguous write that lands
  // during the admission-to-write window must still deny the operation,
  // leaving only the already-written record as an inert artifact.
  const postClassification = classifyClaudeAuthorityForIdentity(projectRoot, authorityIdentity);
  if (!postClassification.ok) return postClassification;
  const postCheck = checkClaudeAuthorityClassificationAgainstExpected(postClassification, { state: 'ONE', family: 'one-shot', bindingId });
  if (!postCheck.ok) return postCheck;
  // M7 CORRECTION C4 (Codex final ruling): classification/fence alone is not
  // the complete predicate for a transaction-scoped family -- the post-write
  // full predicate must ALSO catch a terminal that lands in the
  // admission-to-write race window.
  const postWriteTerminalCheck = checkOneShotTransactionTerminalAbsent(projectRoot, binding);
  if (!postWriteTerminalCheck.ok) return postWriteTerminalCheck;
  return { ok: true, binding };
}

/**
 * Public, unchanged 13-argument ABI (M7 GREEN correction round 2, R1:
 * "conserva la firma pública de 13 argumentos de createClaudeOneShotBinding;
 * no añadas un nuevo ABI serializado"). Delegates to
 * createClaudeOneShotBindingInternal with no preWriteHook -- byte-identical
 * behavior to before this round's refactor for every existing caller.
 */
function createClaudeOneShotBinding(
  projectRoot, runtimeSessionKey, sessionGenerationId, agentId, agentType, nativeSpawnActionId,
  requestId, attemptId, leaseEpoch, role, worktreeId, planDigest, ttlSeconds,
) {
  return createClaudeOneShotBindingInternal(
    projectRoot, runtimeSessionKey, sessionGenerationId, agentId, agentType, nativeSpawnActionId,
    requestId, attemptId, leaseEpoch, role, worktreeId, planDigest, ttlSeconds,
  );
}

/**
 * M7 GREEN correction round 2, R1 (fixes the admit-before-consume defect):
 * the ONE entry point a SubagentStart's claude-agent one-shot mint should
 * now use instead of separately calling
 * validateAndConsumeClaudeAgentSpawnReservation then createClaudeOneShotBinding
 * as two independent, already-complete operations. Peek-validates the
 * reservation (read-only, reservation stays ISSUED), then runs
 * createClaudeOneShotBindingInternal's OWN full authority admission pass
 * (fence/terminal/generation, via admitClaudeAuthorityOperation) BEFORE the
 * reservation is ever consumed -- consumption happens as the preWriteHook,
 * immediately before the binding write, under the SAME one-use capability.
 * A cut (fence, transaction terminal, or an expired admission deadline)
 * observed by admission denies here with the reservation still genuinely
 * ISSUED and zero binding; a deadline that expires before the guarded write
 * itself runs denies with `binding-expired`, same as any other consumer of
 * writeGuardedByClaudeAuthorityAdmission.
 * `sessionGenerationId` is never supplied by the caller: it is read from
 * the peeked (not-yet-consumed) reservation's own already-observed value --
 * this function never mints or guesses a generation, only correlates the
 * one the reservation already carries.
 * @returns {{ok:true,binding:object}|{ok:false,reason:string}}
 */
function consumeClaudeAgentSpawnReservationAndCreateOneShotBinding(
  repoDescriptor, activation, expectedRequestId, expectedRole, expectedWorktreeId, expectedPlanDigest, expectedToolInputDigest, projectRoot,
  runtimeSessionKey, agentId, ttlSeconds,
) {
  const peek = peekValidateClaudeAgentSpawnReservation(
    repoDescriptor, activation, expectedRequestId, expectedRole, expectedWorktreeId, expectedPlanDigest, expectedToolInputDigest, projectRoot,
  );
  if (!peek.ok) return peek;
  const reservation = peek.reservation;
  return createClaudeOneShotBindingInternal(
    projectRoot, runtimeSessionKey, reservation.session_generation_id, agentId, expectedRole,
    activation.native_spawn_action_id, expectedRequestId, activation.attempt_id, activation.lease_epoch,
    expectedRole, expectedWorktreeId, expectedPlanDigest, ttlSeconds,
    () => consumeClaudeAgentSpawnReservationMarker(repoDescriptor, activation.native_spawn_action_id),
  );
}

/**
 * Closed validator for ClaudeOneShotBinding/v1, structurally parallel to
 * validateRoleActorBindingFor but scoped against an `expected`-fields object
 * (mirroring validateMainOrchestratorBindingFor's own `action`-object
 * pattern) rather than positional params, given this schema's larger
 * correlated-field count: exact key-set closure, exact schema literal,
 * path<->field id correlation, hex-shaped id fields, canonical-ISO-UTC
 * timestamps with created_at<=expiry and never in the future, not expired,
 * and full scope correlation against the caller's expected
 * request/attempt/lease/role/worktree/plan tuple -- the exact fields a
 * future target-gate caller needs to confirm this binding resolves to the
 * SAME current transaction/activation it is granting for (PLAN.md §15d,
 * user 7-point spec point 4: "solo puede mintar ... grants cuando resuelvan
 * al mismo claude-one-shot-binding vigente").
 * @param {string|{repoId:string}} repoDescriptor
 * @param {string} bindingId
 * @param {{requestId:string,attemptId:string,leaseEpoch:number,role:string,worktreeId:string,planDigest:string}} expected
 * @returns {{ok:true,binding:object}|{ok:false,reason:string}}
 */
function validateClaudeOneShotBindingFor(repoDescriptor, bindingId, expected) {
  if (!isHexActionId(bindingId)) return { ok: false, reason: 'claude-one-shot-binding-id-invalid' };
  const bindingRead = readRegistryRecord(claudeOneShotBindingPathFor(repoDescriptor, bindingId));
  if (!bindingRead.ok) return { ok: false, reason: 'claude-one-shot-binding-read-failed:' + bindingRead.reason };
  if (bindingRead.absent) return { ok: false, reason: 'claude-one-shot-binding-absent' };
  const binding = bindingRead.obj;
  // M7 section 4.4: exact well-formed v1 is LEGACY_STALE, never a backing or
  // candidate.
  if (binding && hasExactKeys(binding, CLAUDE_ONE_SHOT_BINDING_KEYS) && binding.schema === CLAUDE_ONE_SHOT_BINDING_SCHEMA) {
    return { ok: false, reason: 'claude-one-shot-binding-legacy-v1' };
  }
  if (!binding || !hasExactKeys(binding, CLAUDE_ONE_SHOT_BINDING_KEYS_V2)) return { ok: false, reason: 'claude-one-shot-binding-shape-invalid' };
  if (binding.schema !== CLAUDE_ONE_SHOT_BINDING_SCHEMA_V2) return { ok: false, reason: 'claude-one-shot-binding-schema-invalid' };
  if (binding.binding_id !== bindingId) return { ok: false, reason: 'claude-one-shot-binding-id-path-mismatch' };
  if (!isHexActionId(binding.actor_instance_id)) return { ok: false, reason: 'claude-one-shot-binding-shape-invalid' };
  if (typeof binding.runtime_session_key !== 'string' || binding.runtime_session_key.length === 0) return { ok: false, reason: 'claude-one-shot-binding-shape-invalid' };
  if (typeof binding.agent_id !== 'string' || binding.agent_id.length === 0) return { ok: false, reason: 'claude-one-shot-binding-shape-invalid' };
  if (!CANONICAL_ROLES.includes(binding.agent_type)) return { ok: false, reason: 'claude-one-shot-binding-shape-invalid' };
  if (!isHexActionId(binding.native_spawn_action_id)) return { ok: false, reason: 'claude-one-shot-binding-shape-invalid' };
  if (!isHexDigest64(binding.request_id) || !isHexDigest64(binding.attempt_id)) return { ok: false, reason: 'claude-one-shot-binding-shape-invalid' };
  if (!Number.isInteger(binding.lease_epoch) || binding.lease_epoch < 0) return { ok: false, reason: 'claude-one-shot-binding-shape-invalid' };
  if (!CANONICAL_ROLES.includes(binding.role)) return { ok: false, reason: 'claude-one-shot-binding-shape-invalid' };
  // M7 GREEN section 4.5 (R4): both agent_type and role are independently
  // canonical above, but a persisted record where they DIVERGE is still
  // shape-invalid -- createClaudeOneShotBinding's own agentType!==role check
  // (M7 defect 3) proves this invariant only at mint time; a forged or
  // corrupted on-disk record must be rejected the same way on every read.
  if (binding.agent_type !== binding.role) return { ok: false, reason: 'claude-one-shot-binding-shape-invalid' };
  if (!isHexDigest64(binding.worktree_id) || !isHexDigest64(binding.plan_digest)) return { ok: false, reason: 'claude-one-shot-binding-shape-invalid' };
  if (!isHexCsprng32(binding.session_generation_id)) return { ok: false, reason: 'claude-one-shot-binding-shape-invalid' };
  if (!isCanonicalIsoUtc(binding.created_at) || !isCanonicalIsoUtc(binding.expiry)) return { ok: false, reason: 'claude-one-shot-binding-timestamp-shape-invalid' };
  const createdAtMs = isoToMsForRegistry(binding.created_at);
  const expiryMs = isoToMsForRegistry(binding.expiry);
  if (!Number.isFinite(createdAtMs) || !Number.isFinite(expiryMs) || createdAtMs > expiryMs) {
    return { ok: false, reason: 'claude-one-shot-binding-timestamp-invalid' };
  }
  const nowMs = currentClockMsForRegistry();
  if (createdAtMs > nowMs) return { ok: false, reason: 'claude-one-shot-binding-created-in-future' };
  if (nowMs >= expiryMs) return { ok: false, reason: 'claude-one-shot-binding-expired' };
  // M7 section 4.4/section 6 (defect 7): authority liveness never consults
  // the legacy schema-less `.retired` sidecar marker -- it is diagnostics
  // only and must never hide a v2 record's liveness. Liveness is cut
  // exclusively via the fence/generation/expiry monotonic cuts below; the
  // transaction terminal (the authoritative result / cancel.json) is a
  // SEPARATE, transaction-scoped check applied by mintRoleCommandGrant.
  // M7 section 5 point 2: exact current live SessionGeneration.
  // peekSessionGeneration is a pure lookup: validation must never create or
  // rotate state as a side effect.
  const generation = peekSessionGeneration(repoDescriptor, { provider: 'claude-hook', runtime_session_key: binding.runtime_session_key });
  if (!generation.ok || generation.generationId !== binding.session_generation_id) {
    return { ok: false, reason: 'claude-one-shot-binding-generation-mismatch' };
  }
  // M7 section 5 point 4: the actor fence is durably absent.
  const authorityIdentityId = computeClaudeAuthorityIdentityId(repoDescriptor, 'claude-hook', binding.runtime_session_key, binding.agent_id);
  const fenceRead = readClaudeAuthorityFence(repoDescriptor, authorityIdentityId);
  if (!fenceRead.ok) return { ok: false, reason: 'authority-fence-invalid' };
  if (!fenceRead.absent) return { ok: false, reason: 'authority-fenced' };
  if (
    binding.request_id !== expected.requestId || binding.attempt_id !== expected.attemptId
    || binding.lease_epoch !== expected.leaseEpoch || binding.role !== expected.role
    || binding.worktree_id !== expected.worktreeId || binding.plan_digest !== expected.planDigest
  ) {
    return { ok: false, reason: 'claude-one-shot-binding-scope-mismatch' };
  }
  return { ok: true, binding };
}

  return Object.freeze({
    CLAUDE_ONE_SHOT_BINDING_SCHEMA,
    CLAUDE_ONE_SHOT_BINDING_KEYS,
    CLAUDE_ONE_SHOT_BINDING_SCHEMA_V2,
    CLAUDE_ONE_SHOT_BINDING_KEYS_V2,
    CLAUDE_ONE_SHOT_BINDING_TTL_CEILING_SECONDS,
    claudeOneShotBindingPathFor,
    createClaudeOneShotBindingInternal,
    createClaudeOneShotBinding,
    consumeClaudeAgentSpawnReservationAndCreateOneShotBinding,
    validateClaudeOneShotBindingFor,
  });
}

module.exports = Object.freeze({ createClaudeOneShotRecord });

