'use strict';

// Extracted behaviorally from runtime-role-lifecycle.cjs: the action-failed,
// ready, and wait-ready CLI subcommand handlers plus the shared repeated-
// flag-value argv collector wait-ready's supervisor-start branch uses.
// Never requires the facade or a sibling module.

function createCliActionReadyHandlers({
SUBCOMMAND_SPEC, parseSubcommandArgv, usageError, isHexActionId, findActionAcrossRepos, invalidError,
  sha256String, validateAndConsumeLifecycleCommandGrant, peekSessionGeneration, terminalizeActionAsFailed,
  unavailableError, roleProfileDigestFor, readRoleBindingState, currentClockMsForRegistry, isoToMsForRegistry,
  transitionRoleBinding, roleBindingForEnvelope, emitAndExit, makeResult, RC, isIntInRange, CANONICAL_ROLES,
}) {
// ── action-failed / ready / wait-ready (Frozen CLI ABI, PLAN.md ~L143-145) ──────

const ACTION_FAILED_REASON_ENUM = Object.freeze(['capability-unavailable', 'native-tool-error', 'deadline']);
const ACTION_FAILED_REASON_TO_DETAIL = Object.freeze({
  'capability-unavailable': 'CAPABILITY_UNAVAILABLE',
  'native-tool-error': 'NATIVE_TOOL_ERROR',
  // No closed detail_code names a host-call deadline directly; ACTION_EXPIRED
  // is the closest existing enum member (PLAN.md ~L152's detail_code union is
  // closed -- this reuses it rather than inventing a new member).
  deadline: 'ACTION_EXPIRED',
});


/**
 * `action-failed --action <32+-hex> --reason <capability-unavailable|native-tool-error|deadline>`
 * -- consume one pending action as failed and make the connector eligible for
 * policy fallback. No `--project-root`/`--lifecycle-binding` in the frozen argv
 * (PLAN.md ~L143): scope is derived from the action's own embedded identity via
 * `findActionAcrossRepos`, and the 128-bit action_id itself (mintable only under
 * an already-validated grant) is the bearer of authorization for this follow-up
 * call -- never a separate fresh grant.
 * @param {string[]} rawArgv
 * @returns {never}
 */
function handleActionFailed(rawArgv) {
  const parsed = parseSubcommandArgv(rawArgv, SUBCOMMAND_SPEC['action-failed']);
  if (!parsed.ok) {
    usageError('action-failed');
    return;
  }
  const actionId = parsed.values['--action'];
  if (!isHexActionId(actionId)) {
    usageError('action-failed');
    return;
  }
  const reason = parsed.values['--reason'];
  if (!ACTION_FAILED_REASON_ENUM.includes(reason)) {
    usageError('action-failed');
    return;
  }

  const found = findActionAcrossRepos(actionId);
  if (!found.ok) {
    invalidError('action-failed', 'INTERNAL_ERROR');
    return;
  }
  if (found.absent) {
    invalidError('action-failed', 'NONE');
    return;
  }
  const action = found.action;
  const repoDescriptor = { repoId: action.repo_id };

  // Point 1.1 (R4): every lifecycle command requires a grant. `role` is the
  // action's own embedded role (null for team-ensure/supervisor-start,
  // matching PLAN.md ~L576's closed role union for a current team/
  // supervisor action). `action-failed` is always reported by the
  // orchestrator, never a target (PLAN.md ~L165's "the executor calls
  // granted action-failed") -- binding_kind/authority are validated as
  // main-orchestrator/orchestrator inside validateAndConsumeLifecycleCommandGrant.
  const lifecycleBindingRef = parsed.values['--lifecycle-binding'];
  if (lifecycleBindingRef === undefined) {
    invalidError('action-failed', 'IDENTITY_MISMATCH');
    return;
  }
  const argvDigest = sha256String('action-failed:' + actionId + ':' + reason);
  const consumeResult = validateAndConsumeLifecycleCommandGrant(repoDescriptor, lifecycleBindingRef, argvDigest, action.role, 'action-failed', actionId);
  if (!consumeResult.ok) {
    invalidError('action-failed', 'IDENTITY_MISMATCH');
    return;
  }
  const binding = consumeResult.binding;
  const actionFailedGenResult = peekSessionGeneration(repoDescriptor, { provider: binding.runtime, runtime_session_key: binding.runtime_session_key });
  if (
    binding.worktree_id !== action.worktree_id
    || binding.plan_digest !== action.plan_digest
    || !actionFailedGenResult.ok || actionFailedGenResult.generationId !== action.session_generation_id
  ) {
    invalidError('action-failed', 'IDENTITY_MISMATCH');
    return;
  }

  // M6 CORRECTION PASS (P0-2): the per-kind terminalization logic itself now
  // lives in the shared terminalizeActionAsFailed (above) -- this handler's
  // own job is only argv/grant validation and mapping its result back onto
  // the exact same detail-code shape this CLI has always used.
  const result = terminalizeActionAsFailed(action, reason);
  if (!result.ok) {
    if (result.code === 'REPLAY') {
      invalidError('action-failed', 'ACTION_REPLAY');
      return;
    }
    if (result.code === 'AMBIGUOUS_OWNER') {
      invalidError('action-failed', 'AMBIGUOUS_OWNER');
      return;
    }
    if (result.code === 'UNSUPPORTED') {
      invalidError('action-failed', 'NONE');
      return;
    }
    invalidError('action-failed', 'INTERNAL_ERROR');
    return;
  }

  unavailableError('action-failed', ACTION_FAILED_REASON_TO_DETAIL[reason]);
}

/**
 * `ready --action <32+-hex> [--lifecycle-binding <grant-ref>]` -- target-side
 * first bootstrap call; gated identity correlation may transition the pending
 * role to READY. No `--project-root` in the frozen argv (PLAN.md ~L144): scope
 * is derived from the action's own embedded identity via
 * `findActionAcrossRepos`, never a guessed CWD. Only a currently-pending
 * STARTING/REHYDRATING binding whose `pending_action_id` is EXACTLY this
 * action_id, validated against a grant whose binding matches the action's own
 * worktree/plan/session-generation, can transition to READY -- no PID, output
 * text, or action return is ever consulted (PLAN.md ~L167).
 * @param {string[]} rawArgv
 * @returns {never}
 */
function handleReady(rawArgv) {
  const parsed = parseSubcommandArgv(rawArgv, SUBCOMMAND_SPEC.ready);
  if (!parsed.ok) {
    usageError('ready');
    return;
  }
  const actionId = parsed.values['--action'];
  if (!isHexActionId(actionId)) {
    usageError('ready');
    return;
  }

  const found = findActionAcrossRepos(actionId);
  if (!found.ok) {
    invalidError('ready', 'INTERNAL_ERROR');
    return;
  }
  if (found.absent) {
    invalidError('ready', 'NONE');
    return;
  }
  const action = found.action;
  if (action.role === null || (action.kind !== 'role-spawn' && action.kind !== 'role-rebind')) {
    // team-ensure/supervisor-start/role-notify/role-stop-owned/*-stop-owned
    // never create a pending-READY expectation a peer's first call resolves;
    // Codex's own READY correlation is item C (see the handoff).
    invalidError('ready', 'NONE');
    return;
  }

  const lifecycleBindingRef = parsed.values['--lifecycle-binding'];
  if (lifecycleBindingRef === undefined) {
    invalidError('ready', 'IDENTITY_MISMATCH');
    return;
  }

  const repoDescriptor = { repoId: action.repo_id };
  const argvDigest = sha256String('ready:' + actionId);
  const consumeResult = validateAndConsumeLifecycleCommandGrant(repoDescriptor, lifecycleBindingRef, argvDigest, action.role, 'ready', actionId);
  if (!consumeResult.ok) {
    invalidError('ready', 'IDENTITY_MISMATCH');
    return;
  }
  const binding = consumeResult.binding;
  // R4 round 3 (block 1a): `ready` is the only role-actor+target
  // subcommand, so `consumeResult.bindingKind` is always 'role-actor' here
  // in practice -- branched explicitly (rather than assumed) so a future
  // caller of this same code shape is never silently wrong. RoleActorBinding
  // stores session_generation_id directly (no hook-observed runtime tuple to
  // re-derive it from in this wave, unlike MainOrchestratorBinding -- see
  // the RoleActorBinding/v1 section header); the main-orchestrator branch
  // is UNCHANGED from before (PLAN.md ~L574: the binding never carries
  // session_generation_id -- re-derive fresh from its own (runtime,
  // runtime_session_key) tuple. Point A.4: lookup-only).
  let readyGenerationId;
  if (consumeResult.bindingKind === 'role-actor') {
    readyGenerationId = binding.session_generation_id;
  } else {
    const readyGenResult = peekSessionGeneration(repoDescriptor, { provider: binding.runtime, runtime_session_key: binding.runtime_session_key });
    if (!readyGenResult.ok) {
      invalidError('ready', 'IDENTITY_MISMATCH');
      return;
    }
    readyGenerationId = readyGenResult.generationId;
  }
  if (
    binding.worktree_id !== action.worktree_id
    || binding.plan_digest !== action.plan_digest
    || readyGenerationId !== action.session_generation_id
  ) {
    // The grant's own binding was minted for a DIFFERENT scope than this
    // action (stale binding / identity drift) -- reject, never proceed.
    invalidError('ready', 'IDENTITY_MISMATCH');
    return;
  }

  const profileDigest = roleProfileDigestFor(action.role);
  const stateResult = readRoleBindingState(repoDescriptor, action.worktree_id, action.plan_digest, profileDigest, action.session_generation_id, action.role);
  if (!stateResult.ok) {
    invalidError('ready', 'INTERNAL_ERROR');
    return;
  }
  if (
    (stateResult.state !== 'STARTING' && stateResult.state !== 'REHYDRATING')
    || stateResult.record.pending_action_id !== actionId
  ) {
    invalidError('ready', 'ACTION_REPLAY');
    return;
  }

  if (currentClockMsForRegistry() >= isoToMsForRegistry(action.expires_at)) {
    const expireState = stateResult.state === 'STARTING' ? 'UNAVAILABLE' : 'QUARANTINED';
    transitionRoleBinding(repoDescriptor, action.worktree_id, action.plan_digest, profileDigest, action.session_generation_id, action.role, stateResult.state, expireState, stateResult.record, { failure_reason: 'expired' });
    invalidError('ready', 'ACTION_EXPIRED');
    return;
  }

  const readyTransition = transitionRoleBinding(repoDescriptor, action.worktree_id, action.plan_digest, profileDigest, action.session_generation_id, action.role, stateResult.state, 'READY', stateResult.record, {});
  if (!readyTransition.ok) {
    // A concurrent caller already claimed this exact pending action.
    invalidError('ready', 'AMBIGUOUS_OWNER');
    return;
  }

  emitAndExit(makeResult('ready', RC.OK, 'READY', 'NONE', [roleBindingForEnvelope(readyTransition.record)], []));
}

// M6 GROUP B: a narrow, single-flag, order-preserving `--flag value`
// repeated-occurrence collector over an already-frozen argv array (e.g. a
// supervisor-start action's own immutable `payload.bridge_argv`) -- reads a
// value back OUT of an argv array belonging to a DIFFERENT program
// (runtime-bridge-codex.cjs's own `session-run` CLI), never used for this
// file's own subcommand parsing (`parseSubcommandArgv`/`SUBCOMMAND_SPEC`,
// unrelated and untouched).
function extractRepeatedFlagValues(argv, flag) {
  const values = [];
  if (!Array.isArray(argv)) return values;
  for (let i = 0; i < argv.length - 1; i += 1) {
    if (argv[i] === flag) values.push(argv[i + 1]);
  }
  return values;
}

/**
 * `wait-ready --action <32+-hex> --timeout <1..120>` -- bounded read-only wait
 * for observed start plus gated READY; tool success/message text alone never
 * satisfies it. WP3 performs one synchronous registry state check per call
 * (matching the pre-existing WP1 "never sleeps for the requested timeout
 * window" contract this file's own bats suite already pins) rather than an
 * internal timed poll loop -- nothing observes host/peer progress between
 * calls yet in this sandbox; a caller retries externally. See the handoff.
 * @param {string[]} rawArgv
 * @returns {never}
 */
function handleWaitReady(rawArgv) {
  const parsed = parseSubcommandArgv(rawArgv, SUBCOMMAND_SPEC['wait-ready']);
  if (!parsed.ok) {
    usageError('wait-ready');
    return;
  }
  const actionId = parsed.values['--action'];
  if (!isHexActionId(actionId)) {
    usageError('wait-ready');
    return;
  }
  const timeout = parsed.values['--timeout'];
  if (!isIntInRange(timeout, 1, 120)) {
    usageError('wait-ready');
    return;
  }

  // R4 NO-GO round 2 (point 1) + R4 round 3 (block 1c, corrected round 4):
  // every lifecycle command requires a grant (PLAN.md ~L150), and a
  // missing/invalid one is an AUTHORITY failure -- never disguised as an
  // ordinary WAIT_TIMEOUT/READY_TIMEOUT. Checked BEFORE the action lookup
  // below so that a grantless caller can never reach ANY
  // WAIT_TIMEOUT/READY_TIMEOUT response.
  const lifecycleBindingRef = parsed.values['--lifecycle-binding'];
  if (lifecycleBindingRef === undefined) {
    invalidError('wait-ready', 'IDENTITY_MISMATCH');
    return;
  }

  const found = findActionAcrossRepos(actionId);
  if (!found.ok) {
    invalidError('wait-ready', 'INTERNAL_ERROR');
    return;
  }
  if (found.absent) {
    // Round 4 correction: a NONEXISTENT action is never an "authorized
    // wait" at all -- there is no action_id for ANY grant to have been
    // genuinely minted against (a real `ensure` call always mints the
    // action BEFORE ever handing a caller a grant reference to it), so
    // authority can never be verified either way. Reject outright, BEFORE
    // the grants/ registry is ever even consulted -- no grant is
    // examined, and certainly none is consumed. The prior design (cross-
    // repo-scan for a grant self-referentially echoing its OWN role back as
    // the "expected" one) accepted and CONSUMED a one-use grant against a
    // phantom action_id merely because the grant happened to be internally
    // well-formed -- masking the absence rather than honestly rejecting it.
    invalidError('wait-ready', 'IDENTITY_MISMATCH');
    return;
  }
  const action = found.action;
  const repoDescriptor = { repoId: action.repo_id };

  const argvDigest = sha256String('wait-ready:' + actionId);
  const consumeResult = validateAndConsumeLifecycleCommandGrant(repoDescriptor, lifecycleBindingRef, argvDigest, action.role, 'wait-ready', actionId);
  if (!consumeResult.ok) {
    invalidError('wait-ready', 'IDENTITY_MISMATCH');
    return;
  }

  // Authority is now proven -- ONLY past this point may a null-role action
  // (team-ensure/supervisor-start, which never creates a pending-READY
  // expectation) legitimately resolve to the ordinary liveness answer. The
  // action genuinely EXISTS here (found.absent already returned above), so
  // action.repo_id/action.role are both real and a grant COULD legitimately
  // have been minted against it (e.g. ensure's own wait-ready grant for a
  // pending team-ensure, minted with role:null).
  if (action.role === null) {
    // M6 GROUP B: `action.kind === 'supervisor-start'` is the ONE null-role
    // kind that DOES eventually resolve to a genuine batch-READY answer (via
    // `transitionSupervisorBatchToReady`, `session-run`'s own admission
    // point) -- discriminated explicitly here so every OTHER null-role kind
    // (team-ensure, the only other one sharing this branch today) keeps its
    // pre-existing WAIT_TIMEOUT/WAITING behavior completely unchanged. The
    // role set this batch owns is read from the action's own immutable
    // `payload.bridge_argv` (the repeated `--role <role>` tokens `session-
    // run`'s own frozen CLI ABI requires, PLAN.md ~L787) rather than a fresh
    // registry scan -- a role already durably READY has no `pending_action_id`
    // left to correlate it back to this action, so the batch's OWN role set
    // must come from the action, never be re-derived from current state.
    if (action.kind === 'supervisor-start') {
      const batchRoles = extractRepeatedFlagValues(action.payload && action.payload.bridge_argv, '--role');
      if (batchRoles.length === 0 || !batchRoles.every((r) => CANONICAL_ROLES.includes(r))) {
        emitAndExit(makeResult('wait-ready', RC.WAIT_TIMEOUT, 'WAITING', 'READY_TIMEOUT', [], []));
        return;
      }
      function readAllBatchBindingsIfReady() {
        const bindings = [];
        for (const batchRole of batchRoles) {
          const batchProfileDigest = roleProfileDigestFor(batchRole);
          const batchState = readRoleBindingState(repoDescriptor, action.worktree_id, action.plan_digest, batchProfileDigest, action.session_generation_id, batchRole);
          if (!batchState.ok || batchState.state !== 'READY') return null;
          bindings.push(roleBindingForEnvelope(batchState.record));
        }
        return bindings;
      }
      const readyBindings = readAllBatchBindingsIfReady();
      if (readyBindings) {
        emitAndExit(makeResult('wait-ready', RC.OK, 'READY', 'NONE', readyBindings, []));
        return;
      }
      // Mirrors the named-role branch's own `stillPending` discipline below:
      // not-yet-READY is only a recoverable WAITING while the batch action
      // itself has not yet expired; past that, it is an honest READY_TIMEOUT.
      if (currentClockMsForRegistry() < isoToMsForRegistry(action.expires_at)) {
        emitAndExit(makeResult('wait-ready', RC.OK, 'WAITING', 'NONE', [], []));
        return;
      }
      emitAndExit(makeResult('wait-ready', RC.WAIT_TIMEOUT, 'WAITING', 'READY_TIMEOUT', [], []));
      return;
    }
    emitAndExit(makeResult('wait-ready', RC.WAIT_TIMEOUT, 'WAITING', 'READY_TIMEOUT', [], []));
    return;
  }

  const profileDigest = roleProfileDigestFor(action.role);
  const stateResult = readRoleBindingState(repoDescriptor, action.worktree_id, action.plan_digest, profileDigest, action.session_generation_id, action.role);
  if (!stateResult.ok) {
    emitAndExit(makeResult('wait-ready', RC.WAIT_TIMEOUT, 'WAITING', 'READY_TIMEOUT', [], []));
    return;
  }

  if (stateResult.state === 'READY') {
    emitAndExit(makeResult('wait-ready', RC.OK, 'READY', 'NONE', [roleBindingForEnvelope(stateResult.record)], []));
    return;
  }

  const stillPending = (stateResult.state === 'STARTING' || stateResult.state === 'REHYDRATING')
    && stateResult.record.pending_action_id === actionId
    && currentClockMsForRegistry() < isoToMsForRegistry(action.expires_at);
  if (stillPending) {
    emitAndExit(makeResult('wait-ready', RC.OK, 'WAITING', 'NONE', [], []));
    return;
  }

  emitAndExit(makeResult('wait-ready', RC.WAIT_TIMEOUT, 'WAITING', 'READY_TIMEOUT', [], []));
}

  return Object.freeze({
handleActionFailed, handleReady, extractRepeatedFlagValues, handleWaitReady,
  });
}

module.exports = { createCliActionReadyHandlers };
