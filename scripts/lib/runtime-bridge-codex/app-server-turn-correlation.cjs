'use strict';

// Extracted behaviorally from runtime-bridge-codex.cjs's createAppServerConnection:
// turn-id replay-fence bookkeeping, thread/read hydration, the single
// tryDeliverCurrentTurn transition, and the turn/started+turn/completed wire
// correlator. Every cross-controller need (dispatch, lifecycle, credential
// refresh-in-flight status, turn-completion delivery, protocol validators) is
// an explicit injected capability -- never a facade/module-wide bag. Never
// requires the facade or either sibling facade, directly or transitively.

function createTurnCorrelation({
  state, terminalStop, isTerminal, isRefreshing, dispatchRequest, allocateId,
  invokeTurnCompletionResult, invokeTurnCompletionHandler, boundedTurnErrorSuffix,
  isValidThreadReadParams, isValidThreadReadResponse,
  isValidTurnStartedNotification, isValidTurnCompletedNotification,
  hasExactKeys, asyncSleep, retainedWorkerPollIntervalMs, maxRetiredTurnIdsPerThread,
}) {
  /** R14: records `turnId` as retired, enforcing the frozen cap. Returns false (having already called terminalStop internally) if the cap is exhausted -- callers must check isTerminal()/the return value afterward rather than assuming success. */
  function retireTurnId(turnId) {
    if (state.retiredTurnIds.size >= maxRetiredTurnIdsPerThread) {
      terminalStop('retired-turn-id-registry-exhausted');
      return false;
    }
    state.retiredTurnIds.add(turnId);
    return true;
  }

  /** R14: true iff `turnId` has already been retired on the active thread's current lifetime -- binding a NEW turn to a retired id is a replay, never a legitimate reuse. */
  function isRetiredTurnId(turnId) {
    return state.retiredTurnIds.has(turnId);
  }

  /**
   * True iff `currentTurn` exists and has reached its one authoritative
   * delivery -- safe to start a genuinely NEW turn on this thread. Mirrors
   * turn-state-model.cjs's `_turnIsSafelyTerminal()`. Deliberately EXCLUDES
   * `INTERRUPTED` -- an interrupted turn is terminal enough to ARCHIVE from
   * but PLAN.md's own closure/recovery contract requires the thread to
   * actually be archived (and a fresh thread/turn cycle started) before any
   * new turn may begin.
   */
  function isCurrentTurnSafelyTerminal() {
    const currentTurn = state.getCurrentTurn();
    return currentTurn === null || (currentTurn.state === 'DELIVERED' && currentTurn.responseObserved === true && currentTurn.refreshDeferralEpoch === null);
  }

  /** R14: the WIDER predicate used only by `threadArchive` -- a genuinely `INTERRUPTED` turn is ALSO safe to archive from, in addition to every `isCurrentTurnSafelyTerminal()` case. Deliberately NOT used by `turnStart`. */
  function isCurrentTurnSafeToArchive() {
    const currentTurn = state.getCurrentTurn();
    return isCurrentTurnSafelyTerminal() || (currentTurn !== null && currentTurn.state === 'INTERRUPTED');
  }

  /** Binds `turnId` to the current turn's own id the FIRST time it's seen, or verifies an exact match thereafter. Rejects (without binding) a fresh id that replays an already-retired one. Never called once `currentTurn` is null. */
  function bindOrVerifyCurrentTurnId(turnId) {
    const currentTurn = state.getCurrentTurn();
    if (currentTurn.turnId === null) {
      if (isRetiredTurnId(turnId)) return { ok: false, retiredReplay: true };
      currentTurn.turnId = turnId;
      return { ok: true };
    }
    if (currentTurn.turnId !== turnId) return { ok: false };
    return { ok: true };
  }

  /**
   * Delivers one terminal hydration failure through the same once-only turn
   * authority as a normal completion. The incomplete notification remains
   * recorded for diagnostics, but it is never inspected as an answer.
   */
  function failCurrentTurnHydration(t, reason) {
    if (isTerminal() || state.getCurrentTurn() !== t || t.state !== 'HYDRATION_PENDING') return;
    if (!retireTurnId(t.turnId)) return;
    t.state = 'DELIVERED';
    invokeTurnCompletionResult(t.handlerEntry, { ok: false, reason });
  }

  /**
   * Starts the `thread/read` hydration allowed for an incomplete
   * (`notLoaded`/`summary`) completion. The active thread/turn record and
   * original backend deadline are captured before the first dispatch; a late
   * response after interrupt/archive/STOP is ignored and can never resurrect
   * it. A response whose exact captured turn is still `inProgress` is an
   * eventual-consistency gap between the completion notification and the
   * app-server's own finalized thread state -- retried (fresh id each
   * attempt) via the existing bounded poll-interval yield, strictly bounded
   * by this SAME already-captured `t.backendDeadlineMs`.
   */
  async function startCurrentTurnHydration(t) {
    if (t.hydrationStarted || state.getCurrentTurn() !== t || t.state !== 'IN_PROGRESS') return;
    t.hydrationStarted = true;
    t.state = 'HYDRATION_PENDING';
    const expectedThreadId = state.getActiveThreadId();
    const expectedTurnId = t.turnId;
    const params = { threadId: expectedThreadId, includeTurns: true };
    if (!isValidThreadReadParams(params) || !hasExactKeys(params, ['includeTurns', 'threadId'].sort())) {
      failCurrentTurnHydration(t, 'thread-read-params-invalid');
      return;
    }
    for (;;) {
      const id = allocateId();
      let frameRes;
      try {
        frameRes = await dispatchRequest(id, 'thread/read', params, {
          backendDeadlineMs: t.backendDeadlineMs === null ? undefined : t.backendDeadlineMs,
        });
      } catch (err) {
        failCurrentTurnHydration(t, 'thread-read-failed:' + String((err && err.message) || err));
        return;
      }
      if (isTerminal() || state.getCurrentTurn() !== t || t.state !== 'HYDRATION_PENDING') return;
      if (!frameRes.ok) {
        failCurrentTurnHydration(t, 'thread-read-failed:' + (frameRes.reason || 'error-response'));
        return;
      }
      const response = frameRes.result;
      if (!response || typeof response !== 'object' || Array.isArray(response) || !isValidThreadReadResponse(response)) {
        failCurrentTurnHydration(t, 'thread-read-response-schema-invalid');
        return;
      }
      if (!response.thread || response.thread.id !== expectedThreadId || state.getActiveThreadId() !== expectedThreadId) {
        failCurrentTurnHydration(t, 'thread-read-thread-id-mismatch');
        return;
      }
      const matches = response.thread.turns.filter((turn) => turn && turn.id === expectedTurnId);
      if (matches.length !== 1) {
        failCurrentTurnHydration(t, matches.length === 0 ? 'thread-read-active-turn-missing' : 'thread-read-active-turn-duplicate');
        return;
      }
      const hydrated = matches[0];
      if (hydrated.status !== 'completed') {
        if (hydrated.status !== 'inProgress') {
          failCurrentTurnHydration(t, 'thread-read-active-turn-terminal-status:' + hydrated.status + boundedTurnErrorSuffix(hydrated.error));
          return;
        }
        const deadline = t.backendDeadlineMs;
        if (typeof deadline !== 'number' || Date.now() >= deadline) {
          failCurrentTurnHydration(t, 'thread-read-active-turn-deadline-exhausted');
          return;
        }
        await asyncSleep(retainedWorkerPollIntervalMs);
        if (isTerminal() || state.getCurrentTurn() !== t || t.state !== 'HYDRATION_PENDING') return;
        if (Date.now() >= deadline) {
          failCurrentTurnHydration(t, 'thread-read-active-turn-deadline-exhausted');
          return;
        }
        continue;
      }
      if (hydrated.itemsView !== 'full') {
        failCurrentTurnHydration(t, 'thread-read-active-turn-items-view-not-full:' + hydrated.itemsView);
        return;
      }
      t.completion = hydrated;
      t.state = 'IN_PROGRESS';
      tryDeliverCurrentTurn();
      return;
    }
  }

  /**
   * R14 (Bloque A): the SINGLE delivery transition for the current turn --
   * every one of the three orthogonal prerequisites (turnResponse arriving,
   * a turn/completed notification, registerHandler) calls this same
   * function after updating its own field on `currentTurn`, and it is the
   * ONLY place that retires a turn id or marks a turn DELIVERED.
   */
  function tryDeliverCurrentTurn() {
    const t = state.getCurrentTurn();
    if (!t || !(t.responseObserved && t.completion !== null && t.handlerEntry !== null)) return;
    if (t.state === 'INTERRUPT_PENDING' || t.state === 'INTERRUPTED') return;
    if (isRefreshing()) {
      t.refreshDeferralEpoch = state.getActiveRefreshEpoch();
      t.state = 'DEFERRED_FOR_REFRESH';
      return;
    }
    if (t.completion.itemsView === 'notLoaded' || t.completion.itemsView === 'summary') {
      startCurrentTurnHydration(t);
      return;
    }
    if (!retireTurnId(t.turnId)) return;
    t.state = 'DELIVERED';
    invokeTurnCompletionHandler(t.handlerEntry, t.completion, t.outputPurpose);
  }

  /**
   * Called once an active refresh epoch resolves SUCCESSFULLY. Routes
   * through the SAME `tryDeliverCurrentTurn` transition as the live-wire
   * paths -- never invokes the handler directly. A no-op if nothing is
   * deferred, or if the deferral belongs to a since-superseded epoch.
   */
  function onRefreshConfirmed(epoch) {
    const t = state.getCurrentTurn();
    if (!t || t.state !== 'DEFERRED_FOR_REFRESH' || t.refreshDeferralEpoch !== epoch) return;
    t.refreshDeferralEpoch = null;
    t.state = 'IN_PROGRESS'; // tryDeliverCurrentTurn re-checks isRefreshing() (now false) and re-derives DELIVERED itself -- never assumed here.
    tryDeliverCurrentTurn();
  }

  /**
   * C6: shared wire-level correlator for BOTH `turn/started` and
   * `turn/completed` (both exactly `{threadId, turn:Turn}`). An unknown
   * thread (nothing tracked in-flight) is silently ignored -- diagnostic-only
   * noise. A KNOWN in-flight thread whose notification names a CONFLICTING
   * turn id is a genuine protocol violation and STOPs the connection.
   */
  function correlateTurnNotification(methodName, params) {
    if (isTerminal()) return;
    if (!params || typeof params !== 'object' || Array.isArray(params)) return;
    if (!hasExactKeys(params, ['threadId', 'turn'].sort())) return;
    const { threadId, turn } = params;
    if (typeof threadId !== 'string' || !turn || typeof turn !== 'object' || typeof turn.id !== 'string' || turn.id.length === 0) return;
    if (state.getThreadLifecycleState() !== 'ACTIVE' || state.getActiveThreadId() !== threadId) return;
    if (!(methodName === 'turn/started' ? isValidTurnStartedNotification(params) : isValidTurnCompletedNotification(params))) { terminalStop('turn-notification-schema-invalid:' + methodName); return; }
    const currentTurn = state.getCurrentTurn();
    if (!currentTurn) return; // no turn dispatched yet on this thread -- diagnostic-only noise.
    if (isRetiredTurnId(turn.id)) { terminalStop('turn-notification-turn-id-replay-of-retired-id:' + methodName); return; }
    if (currentTurn.state === 'DELIVERED') { terminalStop((methodName === 'turn/started' ? 'turn-started-after-delivered' : 'turn-completed-after-delivered')); return; }
    if (currentTurn.state === 'INTERRUPT_PENDING' || currentTurn.state === 'INTERRUPTED') { terminalStop((methodName === 'turn/started' ? 'turn-started-after-interrupt' : 'turn-completed-after-interrupt')); return; }
    if (methodName === 'turn/started') {
      if (currentTurn.startedObserved) { terminalStop('duplicate-turn-started'); return; }
      if (currentTurn.completion !== null) { terminalStop('turn-started-after-completion-observed'); return; }
    } else if (currentTurn.completion !== null) {
      terminalStop('turn-completed-duplicate-early-completion');
      return;
    }
    const bind = bindOrVerifyCurrentTurnId(turn.id);
    if (!bind.ok) { terminalStop((bind.retiredReplay ? 'turn-notification-turn-id-replay-of-retired-id:' : 'turn-notification-conflicting-turn-id:') + methodName); return; }
    if (methodName === 'turn/started') { currentTurn.startedObserved = true; return; }
    currentTurn.completion = turn;
    tryDeliverCurrentTurn();
  }

  return Object.freeze({
    retireTurnId, isRetiredTurnId, isCurrentTurnSafelyTerminal, isCurrentTurnSafeToArchive,
    bindOrVerifyCurrentTurnId, failCurrentTurnHydration, startCurrentTurnHydration,
    tryDeliverCurrentTurn, onRefreshConfirmed, correlateTurnNotification,
  });
}

module.exports = Object.freeze({ createTurnCorrelation });
