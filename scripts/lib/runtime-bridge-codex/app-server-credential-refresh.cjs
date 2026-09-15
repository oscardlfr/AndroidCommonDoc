'use strict';

// Extracted behaviorally from runtime-bridge-codex.cjs's createAppServerConnection:
// the SR-01 (account/chatgptAuthTokens/refresh) server-request handling, the
// credential-broker `onRefreshOutcome` listener wiring, and the single-slot
// refresh-epoch exclusivity rule. Every cross-controller need (lifecycle's
// beginStop/terminalStop/writeThenFinalizeStop, turn-correlation's
// onRefreshConfirmed) is an explicit injected capability. Never requires the
// facade or either sibling facade, directly or transitively.

function createCredentialRefresh({
  state, stdin, writeJsonlFrame, isTerminal, beginStop, terminalStop, writeThenFinalizeStop,
  onRefreshConfirmed, refreshProvider, credentialBinding, defaultRpcTimeoutMs,
  isValidChatgptAuthTokensRefreshParams, serverRequestRefreshFailedError, serverRequestInvalidParamsError,
}) {
  /** Settles the current pending credential outcome exactly once; a no-op if nothing is pending (no credentialBinding wired, or already settled). */
  function settlePendingCredentialOutcome(committed, reason) {
    const settlement = state.getPendingCredentialSettlement();
    if (!settlement) return;
    state.setPendingCredentialSettlement(null);
    // This is the TRUE final settlement -- overwrites the earlier
    // listener-invocation-time write, which only reflects the broker's OWN
    // pre-check success, before this connection's own validation/flush-confirm
    // ever ran, and could therefore show committed:true for an attempt later
    // rejected.
    state.setLastCredentialRefreshOutcome({ outcome: { ok: committed }, reason: committed ? undefined : (reason || 'ABORTED'), observedAt: new Date().toISOString() });
    if (committed) settlement.resolve('COMMITTED');
    else settlement.reject(reason || 'ABORTED');
  }

  function isRefreshing() { return state.getActiveRefreshEpoch() !== null; }

  if (credentialBinding && typeof credentialBinding.onRefreshOutcome === 'function') {
    credentialBinding.onRefreshOutcome((outcome, reason) => {
      state.setLastCredentialRefreshOutcome({ outcome, reason, observedAt: new Date().toISOString() });
      // A genuinely async source read can resolve AFTER this connection has
      // ALREADY stopped for an unrelated reason (isTerminal() already true
      // the moment this listener is first invoked for this attempt) --
      // finalizeStop's own settlePendingCredentialOutcome hook only aborts a
      // settlement that already EXISTS at STOP time; it cannot reach one
      // created LATER, and finalizeStop itself is idempotent. Without this
      // check, a new pendingCredentialSettlement would be created here with
      // nothing left to ever resolve/reject it.
      if (isTerminal()) {
        state.setLastCredentialRefreshOutcome({ outcome: { ok: false }, reason: 'connection-already-stopped', observedAt: new Date().toISOString() });
        return Promise.reject('connection-already-stopped');
      }
      return new Promise((resolve, reject) => {
        state.setPendingCredentialSettlement({ resolve, reject });
      });
    });
  }

  /**
   * R7: STOPPING-then-flush-then-STOPPED (A6). SR-01 (refresh) is the sole
   * row that may continue the connection; every rejection branch below
   * transitions to STOPPING (no-authority already applies) BEFORE its reply
   * is even written, flushes the exact frozen reply, and only THEN
   * finalizes to STOPPED -- regardless of whether that flush itself
   * succeeds.
   */
  function handleRefreshServerRequest(id, params) {
    // R10 (Codex NO-GO P0, Block B): a SECOND SR-01 arriving while one is
    // ALREADY in flight is a genuine protocol violation -- at most ONE
    // refresh may ever be processed at a time.
    if (isRefreshing()) {
      beginStop('refresh-concurrent-request');
      writeThenFinalizeStop({ id, error: serverRequestRefreshFailedError });
      return;
    }
    // R8 (item 9): SR-01 only after AUTHENTICATED -- explicit and
    // defense-in-depth alongside the identity check below (which already
    // implies it, since `authenticatedIdentity` is only ever set together
    // with phase===AUTHENTICATED in login()).
    if (state.getPhase() !== 'AUTHENTICATED') {
      beginStop('refresh-before-authenticated');
      writeThenFinalizeStop({ id, error: serverRequestRefreshFailedError });
      return;
    }
    // R8 (item 8): invalid params -> provider is NEVER invoked, an error is
    // credited, and the connection STOPs.
    if (!isValidChatgptAuthTokensRefreshParams(params)) {
      beginStop('refresh-invalid-params');
      writeThenFinalizeStop({ id, error: serverRequestInvalidParamsError });
      return;
    }
    // R9 (P1-2): a claimed `previousAccountId` that CONTRADICTS the
    // connection's own authenticated account is a genuine identity
    // inconsistency -- rejected before ever invoking the provider.
    const authenticatedIdentity = state.getAuthenticatedIdentity();
    if (params.previousAccountId != null && params.previousAccountId !== authenticatedIdentity.chatgptAccountId) {
      beginStop('refresh-contradictory-previous-account');
      writeThenFinalizeStop({ id, error: serverRequestRefreshFailedError });
      return;
    }
    // R9 (Codex NO-GO P1-2): the ENTIRE result-inspection block below runs
    // inside one try/catch -- a hostile/buggy provider returning an object
    // with a throwing getter must never crash the process. Any exception
    // anywhere in this block is treated exactly like a shape-invalid result.
    function finishRefreshResult(result) {
      // The connection may have already stopped for an unrelated reason
      // while a genuinely async provider was still pending -- never act on a
      // stale result once terminal.
      if (isTerminal()) return;
      let shapeOk = false;
      let identityOk = false;
      let tokenGenuinelyNew = false;
      try {
        shapeOk = !!result && result.ok === true
          && typeof result.accessToken === 'string' && result.accessToken.length > 0
          && typeof result.chatgptAccountId === 'string' && result.chatgptAccountId.length > 0
          && (result.chatgptPlanType === null || typeof result.chatgptPlanType === 'string');
        // D4/PLAN.md SR-01 row: the refreshed account/plan MUST equal this
        // connection's own already-authenticated identity -- never merely
        // shape-valid.
        identityOk = shapeOk && !!authenticatedIdentity
          && result.chatgptAccountId === authenticatedIdentity.chatgptAccountId
          && (result.chatgptPlanType === null || result.chatgptPlanType === authenticatedIdentity.chatgptPlanType);
        // R10 (Codex NO-GO P0): a "refreshed" token that was EVER used
        // before -- not merely one that differs from the single most-recent
        // one -- is a rollback and must fail closed. `usedAccessTokens` is
        // permanent history, only ever ADDED to on a CONFIRMED flush.
        tokenGenuinelyNew = shapeOk && !state.usedAccessTokens.has(result.accessToken);
      } catch (err) {
        shapeOk = false; identityOk = false; tokenGenuinelyNew = false;
      }
      if (shapeOk && identityOk && tokenGenuinelyNew) {
        // R10 (Block B): this refresh attempt owns its own epoch from this
        // instant. `isRefreshing()` becomes true the moment this is set, and
        // ONLY this epoch's own callbacks may ever clear it -- a stale
        // callback from a since-superseded attempt checks
        // `activeRefreshEpoch === myEpoch` and no-ops otherwise.
        const myEpoch = state.nextRefreshEpoch();
        state.setActiveRefreshEpoch(myEpoch);
        let flushSettled = false;
        const flushTimer = setTimeout(() => {
          if (flushSettled || state.getActiveRefreshEpoch() !== myEpoch) return;
          flushSettled = true;
          state.setActiveRefreshEpoch(null);
          settlePendingCredentialOutcome(false, 'refresh-reply-flush-timeout'); // an unconfirmed flush must abort, never commit.
          terminalStop('refresh-reply-flush-timeout');
        }, defaultRpcTimeoutMs);
        writeJsonlFrame(stdin, { id, result: { accessToken: result.accessToken, chatgptAccountId: result.chatgptAccountId, chatgptPlanType: result.chatgptPlanType } }, (err) => {
          if (flushSettled || state.getActiveRefreshEpoch() !== myEpoch) return;
          flushSettled = true;
          clearTimeout(flushTimer);
          state.setActiveRefreshEpoch(null);
          // R9 (P0-1 class): re-check isTerminal() before granting anything
          // -- an unrelated STOP could have begun during this exact flush
          // window.
          if (isTerminal()) return;
          // R8 (item 9): the reply's own flush is now credited -- a write
          // failure (e.g. EPIPE) must itself be a STOP trigger.
          if (err) {
            settlePendingCredentialOutcome(false, 'refresh-reply-write-failed'); // a failed flush must abort, never commit.
            terminalStop('refresh-reply-write-failed:' + String((err && err.message) || err));
            return;
          }
          state.usedAccessTokens.add(result.accessToken); // only a CONFIRMED flush commits the token to history.
          settlePendingCredentialOutcome(true); // flush genuinely confirmed -- the broker may now commit hostWideBoundAccountId.
          onRefreshConfirmed(myEpoch); // anything deferred while THIS epoch was active is now safe to deliver, via the single delivery transition.
        });
        return; // sole row that may continue the connection -- no STOP (barring the write failure/timeout above).
      }
      settlePendingCredentialOutcome(false, 'refresh-validation-failed'); // shape/identity/replay rejected -- the broker must never commit this credential.
      beginStop('refresh-failed');
      writeThenFinalizeStop({ id, error: serverRequestRefreshFailedError });
    }

    let rawResult;
    try {
      rawResult = typeof refreshProvider === 'function' ? refreshProvider(params) : { ok: false };
    } catch (err) {
      rawResult = { ok: false };
    }
    if (rawResult && typeof rawResult.then === 'function') {
      // A genuinely async provider -- suspend here (the connection stays
      // open/authenticated, nothing about this attempt is knowable as
      // failed yet) and finish once it resolves/rejects.
      rawResult.then(
        (resolved) => finishRefreshResult(resolved),
        (err) => finishRefreshResult({ ok: false }),
      );
      return;
    }
    finishRefreshResult(rawResult);
  }

  return Object.freeze({ isRefreshing, settlePendingCredentialOutcome, handleRefreshServerRequest });
}

module.exports = Object.freeze({ createCredentialRefresh });
