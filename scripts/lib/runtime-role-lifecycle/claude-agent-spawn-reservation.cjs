'use strict';

// Extracted behaviorally from runtime-role-lifecycle.cjs: ClaudeAgentSpawnReservation/v1
// -- reserves a single, exact consultation-dispatch-originated claude-agent
// Agent() spawn. Depends one-way on the execution-claim module's
// validateMainOrchestratorBindingFor (injected). Never requires the facade
// or a sibling module.

function createClaudeAgentSpawnReservation({
  path, crypto, registryRepoDir, readRegistryRecord, ensureSecureRegistryDir, publishNoClobber,
  canonicalJSONStringify, isHexActionId, isHexDigest64, isoToMsForRegistry, currentClockMsForRegistry,
  nowIsoForRegistry, hasExactKeys, CANONICAL_ROLES, resolvePolicyPair, validateMainOrchestratorBindingFor,
}) {
// ─────────────────────────────────────────────────────────────────────────────
// M7 completeness Part C follow-up (2026-08-09, PLAN.md §15d, user Block 3
// authorization point 2): ClaudeAgentSpawnReservation/v1 -- a FOURTH,
// DISTINCT claim type from SupervisorExecutionClaim/v1 and
// RoleSpawnExecutionClaim/v1 above (mirrors their shape -- no-clobber
// record, scoped to a single action identity, triple-bound expiry, atomic
// one-use `.consumed` marker -- but never reused/extended, per this file's
// own established one-claim-type-per-authority-kind discipline). Reserves a
// SINGLE, exact consultation-dispatch-originated `claude-agent` Agent()
// spawn, bound to session, action (native_spawn_action_id), request,
// attempt, epoch, role, PLAN, and worktree, per the user's own point-2
// wording.
//
// PRODUCTION REALITY (disclosed, not hidden -- reported to team-lead before
// this section was written): `cmdDispatch` (runtime-consultation.cjs) is
// WP2-scoped today -- its driver selection is unconditionally `noop`,
// `native_spawn_action_id` is always null, and no `activation/v1` record
// with `selected_driver:'claude-agent'` is ever produced. The mint path
// below can therefore never find a real activation to reserve in
// production today -- it is genuinely unreachable until a future WP3 pass
// adds real claude-agent driver selection to dispatch. This is NOT
// approximated around: the mechanism is built completely and correctly
// against the REAL, already-frozen `activation/v1` schema fields
// (`native_spawn_action_id`, `attempt_id`, `lease_epoch`, `request_id`),
// ready for that future producer, rather than inventing a parallel/
// fabricated activation concept. This satisfies user point 6 (claude-agent
// stays UNAVAILABLE before activation) BY CONSTRUCTION -- the same way
// runtime-consultation-target-gate.js's exclusively-RoleActorBinding
// resolution already satisfied "never substitute RoleActorBinding" before
// any of this pass's own work began.
//
// `bootstrap_message` has no existing dispatch-side authority to reuse
// (activation/v1 carries no such field, and nothing mints the PLAN §15d
// "transient ActivationAction/v1" that would). Computed by
// `claudeAgentBootstrapMessageFor` below, deterministically, from
// already-validated fields only (role/request_id/attempt_id) -- never from
// prompt/prose/model output (user point 2's own explicit requirement) --
// and stored on this reservation at MINT time, mirroring exactly how the
// role-lifecycle path's own `action.payload.bootstrap_message` is computed
// once by its minter and compared verbatim later by
// agent-spawn-execution-gate.js's existing role-lifecycle branch.
// ─────────────────────────────────────────────────────────────────────────────

const CLAUDE_AGENT_SPAWN_RESERVATION_SCHEMA = 'runtime/claude-agent-spawn-reservation/v1';
const CLAUDE_AGENT_SPAWN_RESERVATION_KEYS = Object.freeze([
  'attempt_id', 'bootstrap_message', 'created_at', 'execution_state', 'expiry',
  'lease_epoch', 'main_binding_id', 'native_spawn_action_id', 'plan_digest',
  'request_id', 'reservation_id', 'role', 'schema', 'session_generation_id',
  'tool_input_digest', 'worktree_id',
]);

function claudeAgentSpawnReservationPathFor(projectRootOrRepoId, nativeSpawnActionId) {
  return path.join(registryRepoDir(projectRootOrRepoId), 'claude-agent-spawn-reservations', nativeSpawnActionId + '.json');
}

function claudeAgentSpawnReservationConsumedMarkerPathFor(projectRootOrRepoId, nativeSpawnActionId) {
  return path.join(registryRepoDir(projectRootOrRepoId), 'claude-agent-spawn-reservations', nativeSpawnActionId + '.consumed');
}

/**
 * Deterministically composes the fixed, bounded bootstrap message for a
 * consultation-dispatch-originated one-shot claude-agent spawn -- built
 * ONLY from already-validated, host-derived fields, never prompt/prose/
 * model output (user point 2). The single source of truth both the minting
 * hook (agent-spawn-execution-gate.js, at reservation time) and this file's
 * own tests use, so a future caller needing to independently recompute the
 * expected value never risks drifting from it.
 * @param {string} role
 * @param {string} requestId
 * @param {string} attemptId
 * @returns {string}
 */
function claudeAgentBootstrapMessageFor(role, requestId, attemptId) {
  return 'You are being activated as ' + role + ' to handle consultation request '
    + requestId + ' (attempt ' + attemptId + '). Read the request and its referenced '
    + 'subject bundle under the coordination root, then respond via the '
    + 'runtime-consultation.cjs CLI.';
}

/**
 * Mints one no-clobber ClaudeAgentSpawnReservation/v1 for a CURRENT,
 * consultation-dispatch-originated claude-agent activation -- proof that
 * agent-spawn-execution-gate.js's PreToolUse(Agent) gate atomically
 * reserved this exact spawn for THIS exact Agent-tool call's own
 * tool_input. Resolves+validates the referenced MainOrchestratorBinding end
 * to end via the SAME `validateMainOrchestratorBindingFor` every sibling
 * claim type uses (existence, exact schema, binding_id/worktree/plan/
 * session correlation, not expired) -- supplied a minimal
 * `{worktree_id,plan_digest,session_generation_id}` shape rather than a
 * full role-lifecycle `action` object, since that function only ever reads
 * those three fields off whatever is passed. Bounds the reservation's own
 * expiry by `min(activation.activation_liveness_expiry, binding.expiry,
 * now+readyTimeoutSeconds)`, mirroring mintRoleSpawnExecutionClaim's own
 * discipline exactly.
 * @param {{repoId:string}} repoDescriptor
 * @param {object} activation - a live `coordination/activation/v1` record with `selected_driver==='claude-agent'`.
 * @param {string} requestId - the activation's own parent request's `request_id`.
 * @param {string} role - the request's own `target_role`.
 * @param {string} worktreeId
 * @param {string} planDigest
 * @param {string} sessionGenerationId - independently re-derived by the caller for the SAME identity that minted `mainBindingId` (`peekSessionGeneration`).
 * @param {string} mainBindingId
 * @param {string} toolInputDigest - sha256(canonicalJSONStringify({subagent_type,name})) of the ACTUAL Agent-tool call this reservation covers.
 * @param {number} readyTimeoutSeconds
 * @returns {{ok:true,reservationPath:string,record:object}|{ok:false,reason:string}}
 */
function mintClaudeAgentSpawnReservation(repoDescriptor, activation, requestId, role, worktreeId, planDigest, sessionGenerationId, mainBindingId, toolInputDigest, readyTimeoutSeconds) {
  if (!activation || activation.schema !== 'coordination/activation/v1' || activation.selected_driver !== 'claude-agent') {
    return { ok: false, reason: 'wrong-activation-kind' };
  }
  if (!isHexActionId(activation.native_spawn_action_id)) return { ok: false, reason: 'native-spawn-action-id-invalid' };
  if (typeof activation.attempt_id !== 'string' || activation.attempt_id.length === 0) return { ok: false, reason: 'attempt-id-invalid' };
  if (!Number.isInteger(activation.lease_epoch) || activation.lease_epoch < 0) return { ok: false, reason: 'lease-epoch-invalid' };
  if (activation.request_id !== requestId) return { ok: false, reason: 'request-id-mismatch' };
  if (!CANONICAL_ROLES.includes(role)) return { ok: false, reason: 'invalid-role' };
  if (!isHexDigest64(worktreeId) || !isHexDigest64(planDigest)) return { ok: false, reason: 'invalid-scope-id' };
  if (!isHexDigest64(toolInputDigest)) return { ok: false, reason: 'tool-input-digest-invalid' };
  if (!Number.isInteger(readyTimeoutSeconds) || readyTimeoutSeconds < 1) return { ok: false, reason: 'ready-timeout-seconds-invalid' };

  const bindingResult = validateMainOrchestratorBindingFor(repoDescriptor, mainBindingId, {
    worktree_id: worktreeId, plan_digest: planDigest, session_generation_id: sessionGenerationId,
  });
  if (!bindingResult.ok) return { ok: false, reason: bindingResult.reason };

  const nowMs = currentClockMsForRegistry();
  const activationExpiryMs = isoToMsForRegistry(activation.activation_liveness_expiry);
  const bindingExpiryMs = isoToMsForRegistry(bindingResult.binding.expiry);
  const policyBoundMs = nowMs + readyTimeoutSeconds * 1000;
  const expiryMs = Math.min(activationExpiryMs, bindingExpiryMs, policyBoundMs);
  if (!(expiryMs > nowMs)) return { ok: false, reason: 'no-positive-ttl-remaining' };

  const reservationPath = claudeAgentSpawnReservationPathFor(repoDescriptor, activation.native_spawn_action_id);
  const dirResult = ensureSecureRegistryDir(path.dirname(reservationPath));
  if (!dirResult.ok) return { ok: false, reason: dirResult.reason };
  const record = {
    schema: CLAUDE_AGENT_SPAWN_RESERVATION_SCHEMA,
    reservation_id: crypto.randomBytes(16).toString('hex'),
    native_spawn_action_id: activation.native_spawn_action_id,
    main_binding_id: mainBindingId,
    session_generation_id: sessionGenerationId,
    request_id: requestId,
    attempt_id: activation.attempt_id,
    lease_epoch: activation.lease_epoch,
    role,
    worktree_id: worktreeId,
    plan_digest: planDigest,
    bootstrap_message: claudeAgentBootstrapMessageFor(role, requestId, activation.attempt_id),
    tool_input_digest: toolInputDigest,
    created_at: nowIsoForRegistry(),
    expiry: new Date(expiryMs).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    execution_state: 'ISSUED',
  };
  if (!hasExactKeys(record, CLAUDE_AGENT_SPAWN_RESERVATION_KEYS)) return { ok: false, reason: 'internal-key-set-mismatch' };
  try {
    publishNoClobber(reservationPath, Buffer.from(canonicalJSONStringify(record), 'utf8'), {});
  } catch (err) {
    return { ok: false, reason: 'claude-agent-spawn-reservation-already-issued' };
  }
  return { ok: true, reservationPath, record };
}

/**
 * Validates+atomically-consumes the reservation for `activation.native_spawn_action_id`
 * against the exact expected scope. Every field is checked independently and
 * fails closed: exact key-set closure, schema, `execution_state==='ISSUED'`,
 * action/session/request/attempt/epoch/role/plan/worktree/tool-input
 * correlation, finite ISO timestamps with `created_at<=expiry`, a
 * triple-bound expiry re-validation (activation's own current liveness,
 * policy, binding.expiry -- never merely the reservation's own cached
 * values), and a FULL independent re-resolution of the referenced
 * MainOrchestratorBinding. Consumption uses the same no-clobber
 * `.consumed`-marker idiom as every sibling claim type, so a replayed
 * confirmation for the same action collides EEXIST.
 * @param {{repoId:string}|string} repoDescriptor
 * @param {object} activation - the LIVE `coordination/activation/v1` record, freshly re-read by the caller.
 * @param {string} expectedRequestId
 * @param {string} expectedRole
 * @param {string} expectedWorktreeId
 * @param {string} expectedPlanDigest
 * @param {string} expectedToolInputDigest
 * @param {string} projectRoot
 * @returns {{ok:true,reservation:object}|{ok:false,reason:string}}
 */
function validateAndConsumeClaudeAgentSpawnReservation(repoDescriptor, activation, expectedRequestId, expectedRole, expectedWorktreeId, expectedPlanDigest, expectedToolInputDigest, projectRoot) {
  const peek = peekValidateClaudeAgentSpawnReservation(repoDescriptor, activation, expectedRequestId, expectedRole, expectedWorktreeId, expectedPlanDigest, expectedToolInputDigest, projectRoot);
  if (!peek.ok) return peek;
  const consumed = consumeClaudeAgentSpawnReservationMarker(repoDescriptor, activation.native_spawn_action_id);
  if (!consumed.ok) return consumed;
  return { ok: true, reservation: peek.reservation };
}

/**
 * M7 GREEN correction round 2, R1: read-only half of
 * validateAndConsumeClaudeAgentSpawnReservation, factored out so the
 * one-shot creation path (consumeClaudeAgentSpawnReservationAndCreateOneShotBinding
 * below) can perform the FULL authority admission pass -- which is the only
 * place the identity fence and transaction-terminal cuts are actually
 * checked -- WHILE the reservation is still ISSUED, before ever consuming
 * it. Every check below is identical to (and was moved verbatim from)
 * validateAndConsumeClaudeAgentSpawnReservation's own pre-consumption
 * validation; only the final no-clobber consumed-marker write is excluded.
 * @returns {{ok:true,reservation:object}|{ok:false,reason:string}}
 */
function peekValidateClaudeAgentSpawnReservation(repoDescriptor, activation, expectedRequestId, expectedRole, expectedWorktreeId, expectedPlanDigest, expectedToolInputDigest, projectRoot) {
  if (!activation || activation.schema !== 'coordination/activation/v1' || activation.selected_driver !== 'claude-agent') {
    return { ok: false, reason: 'wrong-activation-kind' };
  }
  if (!isHexActionId(activation.native_spawn_action_id)) return { ok: false, reason: 'native-spawn-action-id-invalid' };

  const reservationRead = readRegistryRecord(claudeAgentSpawnReservationPathFor(repoDescriptor, activation.native_spawn_action_id));
  if (!reservationRead.ok) return { ok: false, reason: reservationRead.reason };
  if (reservationRead.absent) return { ok: false, reason: 'claude-agent-spawn-reservation-absent' };
  const reservation = reservationRead.obj;

  if (!hasExactKeys(reservation, CLAUDE_AGENT_SPAWN_RESERVATION_KEYS)) return { ok: false, reason: 'claude-agent-spawn-reservation-key-set-invalid' };
  if (reservation.schema !== CLAUDE_AGENT_SPAWN_RESERVATION_SCHEMA) return { ok: false, reason: 'claude-agent-spawn-reservation-schema-invalid' };
  if (reservation.execution_state !== 'ISSUED') return { ok: false, reason: 'claude-agent-spawn-reservation-not-issued' };
  if (reservation.native_spawn_action_id !== activation.native_spawn_action_id) return { ok: false, reason: 'claude-agent-spawn-reservation-action-id-mismatch' };
  if (reservation.request_id !== expectedRequestId || reservation.request_id !== activation.request_id) {
    return { ok: false, reason: 'claude-agent-spawn-reservation-request-mismatch' };
  }
  if (reservation.attempt_id !== activation.attempt_id) return { ok: false, reason: 'claude-agent-spawn-reservation-attempt-mismatch' };
  if (reservation.lease_epoch !== activation.lease_epoch) return { ok: false, reason: 'claude-agent-spawn-reservation-epoch-mismatch' };
  if (reservation.role !== expectedRole) return { ok: false, reason: 'claude-agent-spawn-reservation-role-mismatch' };
  if (reservation.worktree_id !== expectedWorktreeId) return { ok: false, reason: 'claude-agent-spawn-reservation-worktree-mismatch' };
  if (reservation.plan_digest !== expectedPlanDigest) return { ok: false, reason: 'claude-agent-spawn-reservation-plan-mismatch' };
  if (reservation.tool_input_digest !== expectedToolInputDigest) return { ok: false, reason: 'claude-agent-spawn-reservation-tool-input-mismatch' };

  const createdAtMs = isoToMsForRegistry(reservation.created_at);
  const expiryMs = isoToMsForRegistry(reservation.expiry);
  if (!Number.isFinite(createdAtMs) || !Number.isFinite(expiryMs)) return { ok: false, reason: 'claude-agent-spawn-reservation-timestamp-invalid' };
  if (!(createdAtMs <= expiryMs)) return { ok: false, reason: 'claude-agent-spawn-reservation-timestamp-order-invalid' };
  const nowMsForReservation = currentClockMsForRegistry();
  if (createdAtMs > nowMsForReservation) return { ok: false, reason: 'claude-agent-spawn-reservation-created-in-future' };
  if (nowMsForReservation >= expiryMs) return { ok: false, reason: 'claude-agent-spawn-reservation-expired' };

  // Re-validate expiry against the CURRENT activation liveness and policy,
  // never merely the reservation's own stored expiry -- mirrors
  // validateAndConsumeRoleSpawnExecutionClaim's own triple-bound
  // re-validation discipline exactly.
  const activationExpiryMsForReservation = isoToMsForRegistry(activation.activation_liveness_expiry);
  if (Number.isFinite(activationExpiryMsForReservation) && expiryMs > activationExpiryMsForReservation) {
    return { ok: false, reason: 'claude-agent-spawn-reservation-expiry-exceeds-activation' };
  }
  const policyPairForReservation = resolvePolicyPair(projectRoot);
  if (!policyPairForReservation.ok) return { ok: false, reason: 'claude-agent-spawn-reservation-policy-invalid' };
  const policyBoundMsForReservation = createdAtMs + Math.min(policyPairForReservation.policy.ready_timeout_seconds, 120) * 1000;
  if (expiryMs > policyBoundMsForReservation) return { ok: false, reason: 'claude-agent-spawn-reservation-expiry-exceeds-policy' };

  const bindingResult = validateMainOrchestratorBindingFor(repoDescriptor, reservation.main_binding_id, {
    worktree_id: reservation.worktree_id, plan_digest: reservation.plan_digest, session_generation_id: reservation.session_generation_id,
  });
  if (!bindingResult.ok) return { ok: false, reason: 'claude-agent-spawn-reservation-' + bindingResult.reason };
  const bindingExpiryMsForReservation = isoToMsForRegistry(bindingResult.binding.expiry);
  if (!Number.isFinite(bindingExpiryMsForReservation) || expiryMs > bindingExpiryMsForReservation) {
    return { ok: false, reason: 'claude-agent-spawn-reservation-expiry-exceeds-binding' };
  }
  return { ok: true, reservation };
}

/**
 * Atomic one-use consumption of a peeked reservation's own no-clobber
 * `.consumed` marker -- factored out so it can be invoked as the
 * preWriteHook INSIDE createClaudeOneShotBindingInternal's own guarded
 * write (see consumeClaudeAgentSpawnReservationAndCreateOneShotBinding
 * below), never as an independent, already-complete operation preceding a
 * separate admission check.
 * @returns {{ok:true}|{ok:false,reason:string}}
 */
function consumeClaudeAgentSpawnReservationMarker(repoDescriptor, nativeSpawnActionId) {
  const markerPath = claudeAgentSpawnReservationConsumedMarkerPathFor(repoDescriptor, nativeSpawnActionId);
  const dirResult = ensureSecureRegistryDir(path.dirname(markerPath));
  if (!dirResult.ok) return { ok: false, reason: dirResult.reason };
  try {
    publishNoClobber(markerPath, Buffer.from(canonicalJSONStringify({ consumed_at: nowIsoForRegistry() }), 'utf8'), {});
  } catch (err) {
    return { ok: false, reason: 'claude-agent-spawn-reservation-replay' };
  }
  return { ok: true };
}

  return Object.freeze({
    CLAUDE_AGENT_SPAWN_RESERVATION_SCHEMA, CLAUDE_AGENT_SPAWN_RESERVATION_KEYS,
    claudeAgentSpawnReservationPathFor, claudeAgentSpawnReservationConsumedMarkerPathFor,
    claudeAgentBootstrapMessageFor, mintClaudeAgentSpawnReservation,
    validateAndConsumeClaudeAgentSpawnReservation, peekValidateClaudeAgentSpawnReservation,
    consumeClaudeAgentSpawnReservationMarker,
  });
}

module.exports = { createClaudeAgentSpawnReservation };
