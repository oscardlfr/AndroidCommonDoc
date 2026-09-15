'use strict';

// Extracted behaviorally from runtime-role-lifecycle.cjs: the sixteenth-slice
// (S16) consultation-context/pair resolution seams -- makeOperation,
// s16ConsultationApi (lazy require of runtime-consultation.cjs, same
// circular-import-safe pattern as the facade's own), and the main-context/
// retained-pair/mixed-review-pair resolvers root-consult and P5 mixed-review
// dispatch both build on. retainedSupervisorBridgeApi is injected (defined
// in the not-yet-extracted ensure/supervisor zone -- forward reference,
// never a require() cycle). Never requires the facade or a sibling module.

function createS16ContextResolution({
  path, OPERATION_KEYS, validateAndConsumeLifecycleCommandGrant, attachDerivedSessionGenerationId,
  discoverPlan, resolvePolicyPair, computeWorktreeId, peekSessionGeneration,
  currentClockMsForRegistry, isoToMsForRegistry, computeRepoId, coordinationRootPathFor,
  retainedSupervisorBridgeApi, roleProfileDigestFor, isHexCsprng32, readRoleBindingState, hasExactKeys,
}) {
function makeOperation(kind, operationId, state, values) {
  const v = values || {};
  const op = {
    kind, operation_id: operationId, state,
    request_id: v.request_id === undefined ? null : v.request_id,
    request_ref: v.request_ref === undefined ? null : v.request_ref,
    request_digest: v.request_digest === undefined ? null : v.request_digest,
    result_ref: v.result_ref === undefined ? null : v.result_ref,
    result_digest: v.result_digest === undefined ? null : v.result_digest,
    accepted_result_ref: v.accepted_result_ref === undefined ? null : v.accepted_result_ref,
    accepted_result_digest: v.accepted_result_digest === undefined ? null : v.accepted_result_digest,
    ack_ref: v.ack_ref === undefined ? null : v.ack_ref,
    ack_digest: v.ack_digest === undefined ? null : v.ack_digest,
    cancel_ref: v.cancel_ref === undefined ? null : v.cancel_ref,
    cancel_digest: v.cancel_digest === undefined ? null : v.cancel_digest,
  };
  if (!hasExactKeys(op, OPERATION_KEYS)) throw new Error('operation-key-set-invalid');
  return op;
}

// s16ConsultationApi is deliberately NOT here: it lazily requires
// runtime-consultation.cjs, which an internal module may never do (no
// upward import) -- it stays defined in the facade itself and is not part
// of this module's own surface.

function s16CoordinationRelativeRef(coordRoot, absolutePath) {
  const rel = path.relative(coordRoot, absolutePath).split(path.sep).join('/');
  if (rel === '' || rel === '..' || rel.startsWith('../') || path.isAbsolute(rel)) throw new Error('s16-artifact-ref-unconfined');
  return rel;
}

function s16ResolveMainContext(projectRoot, lifecycleBindingRef, argvDigest, role, command, actionId, requireCreationLifetime) {
  if (lifecycleBindingRef === undefined) return { ok: false, reason: 'lifecycle-grant-absent' };
  const consumed = validateAndConsumeLifecycleCommandGrant(
    projectRoot, lifecycleBindingRef, argvDigest, role, command,
    actionId === undefined ? null : actionId,
  );
  if (!consumed.ok || consumed.bindingKind !== 'main-orchestrator') return { ok: false, reason: consumed.reason || 'main-binding-required' };
  const binding = consumed.binding;
  if (!attachDerivedSessionGenerationId(projectRoot, binding).ok) return { ok: false, reason: 'session-generation-invalid' };
  const plan = discoverPlan(projectRoot);
  const pair = resolvePolicyPair(projectRoot);
  const worktreeId = computeWorktreeId(projectRoot);
  if (!plan.ok || !pair.ok) return { ok: false, reason: 'policy-or-plan-invalid' };
  if (binding.plan_digest !== plan.planDigest || binding.worktree_id !== worktreeId) return { ok: false, reason: 'main-scope-mismatch' };
  const generation = peekSessionGeneration(projectRoot, {
    provider: binding.runtime, runtime_session_key: binding.runtime_session_key,
  });
  if (!generation.ok || generation.generationId !== binding.session_generation_id) return { ok: false, reason: 'session-generation-invalid' };
  const nowMs = currentClockMsForRegistry();
  const requestExpiryMs = Math.min(nowMs + 3600 * 1000, isoToMsForRegistry(binding.expiry), isoToMsForRegistry(generation.expiresAt));
  if (requireCreationLifetime === true && requestExpiryMs - nowMs < 120 * 1000) return { ok: false, reason: 'root-operation-lifetime-insufficient' };
  return {
    ok: true, binding, plan, pair, worktreeId, generation,
    repoId: computeRepoId(projectRoot), coordRoot: coordinationRootPathFor(projectRoot),
    requestExpiry: new Date(requestExpiryMs).toISOString().replace(/\.\d{3}Z$/, 'Z'),
  };
}

function s16ResolveRetainedPair(projectRoot, context, requesterRole, targetRole) {
  if (!['arch-platform', 'arch-testing', 'arch-integration'].includes(requesterRole)) return { ok: false, reason: 'root-consult-source-not-architect' };
  const route = context.pair.routing.routes[targetRole];
  if (!Array.isArray(route) || !route.includes('codex-app-server')) return { ok: false, reason: 'root-consult-target-topology-invalid' };
  let bridge;
  try { bridge = retainedSupervisorBridgeApi(); } catch (err) { return { ok: false, reason: 'retained-bridge-unavailable' }; }
  if (!bridge || typeof bridge.resolveLiveCodexAppServerWorker !== 'function') return { ok: false, reason: 'retained-worker-resolver-unavailable' };
  const source = bridge.resolveLiveCodexAppServerWorker(projectRoot, requesterRole, roleProfileDigestFor(requesterRole));
  const target = bridge.resolveLiveCodexAppServerWorker(projectRoot, targetRole, roleProfileDigestFor(targetRole));
  if (!source.ok || !source.available || !target.ok || !target.available) return { ok: false, reason: 'root-consult-retained-worker-unavailable' };
  const a = source.worker;
  const b = target.worker;
  if (a.repoId !== context.repoId || b.repoId !== context.repoId
      || a.worktreeId !== context.worktreeId || b.worktreeId !== context.worktreeId
      || a.planDigest !== context.plan.planDigest || b.planDigest !== context.plan.planDigest
      || a.sessionGenerationId !== context.generation.generationId || b.sessionGenerationId !== context.generation.generationId
      || a.actionId !== b.actionId || a.supervisorInstanceId !== b.supervisorInstanceId
      || a.rendezvousInstanceId !== b.rendezvousInstanceId || a.pid !== b.pid
      || !isHexCsprng32(a.bindingId) || !isHexCsprng32(a.workerSessionId)) {
    return { ok: false, reason: 'root-consult-retained-owner-mismatch' };
  }
  return { ok: true, source: a, target: b };
}

/**
 * P5 U2 live-wiring: resolves a mixed-review pair where the requester is a
 * genuinely Claude-native role (never a Codex fallback -- MX-01 requires
 * this, unlike handleRootSource's own toolkit-specialist-specific fallback)
 * and the target is a retained Codex worker. Requester check mirrors
 * handleRootSource's own Claude-native admission exactly. Target check
 * mirrors s16ResolveRetainedPair's own target half exactly, cross-checked
 * against context directly -- there is no second resolved side to compare
 * against here, unlike s16ResolveRetainedPair's symmetric two-Codex-worker
 * case, so actionId/supervisorInstanceId/rendezvousInstanceId/pid (which
 * only ever compared source against target) have no analog and are not
 * reproduced; only the four context-comparable fields (repo/worktree/plan/
 * session-generation) are.
 * @param {string} projectRoot
 * @param {object} context
 * @param {string} requesterRole
 * @param {string} targetRole
 * @returns {{ok:true,target:object,requesterBindingId:string,requesterActorInstanceId:string}|{ok:false,reason:string}}
 */
function s16ResolveMixedReviewPair(projectRoot, context, requesterRole, targetRole) {
  if (requesterRole === targetRole) return { ok: false, reason: 'mixed-review-self-review-rejected' };
  const requesterBinding = readRoleBindingState(
    projectRoot, context.worktreeId, context.plan.planDigest,
    roleProfileDigestFor(requesterRole), context.generation.generationId,
    requesterRole,
  );
  // Three separate facts, reported separately: an unreadable binding, a requester that is not in a
  // usable state, and a requester on the wrong driver each need a different fix, and collapsing all
  // three into "not-claude-native" made live attempt N12's refusal unreadable.
  if (!requesterBinding.ok) {
    return { ok: false, reason: 'mixed-review-requester-binding-unreadable' };
  }
  // The usable set is the support plane's own: READY, WAITING or BUSY. Requiring exactly READY here
  // contradicted both allSupportRolesHealthy and this same feature's OWN readback check a few
  // hundred lines below, and it is unsatisfiable in practice -- an admitted Claude-native role
  // PARKS in WAITING once its startup turn ends, which is precisely the state it is in by the time
  // init-session reports the plane healthy and the review is dispatched. Live attempt N12 was
  // refused here with all three native roles WAITING, moments after init-session returned READY.
  if (!['READY', 'WAITING', 'BUSY'].includes(requesterBinding.state)) {
    return { ok: false, reason: 'mixed-review-requester-not-healthy-' + String(requesterBinding.state).toLowerCase() };
  }
  // The driver requirement is the real invariant and is unchanged: a mixed review is Claude-native
  // requester to Codex reviewer, never anything else.
  if (!requesterBinding.record || requesterBinding.record.driver !== 'claude-sendmessage') {
    return { ok: false, reason: 'mixed-review-requester-not-claude-native' };
  }
  // Mirrors s16ResolveRetainedPair's own routing pre-check exactly. Provisioning
  // (codexAppServerStartupEligible, driver-selection time) already enforces this
  // once, but s16ResolveRetainedPair re-checks it on every call against freshly-
  // read routing.json (context.pair is re-resolved every s16ResolveMainContext
  // call) -- so a routing.json edit revoking a role's codex-app-server
  // eligibility mid-session is caught on the very next call, never giving an
  // already-retained worker a free pass. Omitting this re-check here would open
  // exactly that (narrow, operator-triggered-only, but real) gap. context.pair
  // is always populated on any context that successfully leaves
  // s16ResolveMainContext (its own if (!plan.ok || !pair.ok) return early makes
  // that a structural guarantee, not merely a convention) -- the correct fix for
  // a fixture without .pair is the fixture, not this function.
  const route = context.pair.routing.routes[targetRole];
  if (!Array.isArray(route) || !route.includes('codex-app-server')) return { ok: false, reason: 'root-consult-target-topology-invalid' };
  let bridge;
  try { bridge = retainedSupervisorBridgeApi(); } catch (err) { return { ok: false, reason: 'retained-bridge-unavailable' }; }
  if (!bridge || typeof bridge.resolveLiveCodexAppServerWorker !== 'function') return { ok: false, reason: 'retained-worker-resolver-unavailable' };
  const target = bridge.resolveLiveCodexAppServerWorker(projectRoot, targetRole, roleProfileDigestFor(targetRole));
  if (!target.ok || !target.available) return { ok: false, reason: 'root-consult-retained-worker-unavailable' };
  const b = target.worker;
  if (
    b.repoId !== context.repoId || b.worktreeId !== context.worktreeId
    || b.planDigest !== context.plan.planDigest || b.sessionGenerationId !== context.generation.generationId
    || !isHexCsprng32(b.bindingId) || !isHexCsprng32(b.workerSessionId)
  ) {
    return { ok: false, reason: 'root-consult-retained-owner-mismatch' };
  }
  return {
    ok: true, target: b,
    requesterBindingId: requesterBinding.record.binding_id,
    requesterActorInstanceId: context.binding.actor_instance_id,
  };
}

  return Object.freeze({
    makeOperation, s16CoordinationRelativeRef, s16ResolveMainContext,
    s16ResolveRetainedPair, s16ResolveMixedReviewPair,
  });
}

module.exports = { createS16ContextResolution };
