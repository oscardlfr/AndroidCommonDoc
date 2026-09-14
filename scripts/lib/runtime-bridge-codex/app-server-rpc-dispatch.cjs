'use strict';

// Extracted behaviorally from runtime-bridge-codex.cjs's createAppServerConnection:
// request-id allocation, the deadline-aware dispatch window, the single
// request-dispatch primitive, fixed-row/unknown-method server-request
// handling (SR-01 itself is delegated to the injected credential-refresh
// controller), and the notification-handler registry. Never requires the
// facade or either sibling facade, directly or transitively.

function createRpcDispatch({
  state, stdin, writeJsonlFrame, isTerminal, isRefreshing, defaultRpcTimeoutMs,
  beginStop, writeThenFinalizeStop, handleRefreshServerRequest,
  serverRequestFixedRows, serverRequestParamsValidators,
  serverRequestUnknownMethodError, serverRequestInvalidParamsError,
}) {
  function allocateId() { return state.allocateId(); }

  /**
   * R9 (post-P0-3 hardening): the three reasons `dispatchRequest` may refuse
   * to even START a call, extracted so a CALLER that must commit its own
   * bookkeeping state BEFORE dispatching (turnStart's `currentTurn` bind, C5
   * "bound BEFORE the write") can check this FIRST and skip that commit
   * entirely on rejection. Returns `{ok:true, timeoutMs}` or `{ok:false, reason}`.
   */
  function computeDispatchWindow(reqOpts) {
    reqOpts = reqOpts || {};
    if (isTerminal()) return { ok: false, reason: 'connection-stopped' };
    // R9 (P0-3): while a just-succeeded refresh's own reply flush is still
    // unconfirmed, the connection is deliberately NON-AUTHORITATIVE for
    // every OTHER RPC. This is a soft, retriable refusal (not a STOP): the
    // caller may simply try again once the flush confirms.
    if (isRefreshing()) return { ok: false, reason: 'refresh-flush-pending' };
    // R9 (Codex NO-GO P1-4): PLAN.md's "within 10 seconds" is a HARD CEILING
    // on this client's own patience, not merely a fallback DEFAULT. The real
    // formula is min(10000, requested, backendDeadline-now), every term
    // optional except the 10000 ceiling itself.
    const explicitTimeoutMs = (typeof reqOpts.timeoutMs === 'number' && reqOpts.timeoutMs > 0) ? reqOpts.timeoutMs : defaultRpcTimeoutMs;
    let timeoutMs = Math.min(defaultRpcTimeoutMs, explicitTimeoutMs);
    if (typeof reqOpts.backendDeadlineMs === 'number') {
      timeoutMs = Math.min(timeoutMs, reqOpts.backendDeadlineMs - Date.now());
      if (timeoutMs <= 0) return { ok: false, reason: 'deadline-non-positive' }; // PLAN.md ~L934 "non-positive means do not start" -- never writes.
    }
    return { ok: true, timeoutMs };
  }

  /**
   * The single request-dispatch primitive: checks terminal state, registers
   * `pending` BEFORE the write (fixes the synchronous-echo race), computes
   * the deadline-aware timeout, and tracks write-flush success separately
   * from response arrival (commit-point distinction) via Node's own
   * per-write completion callback.
   */
  function dispatchRequest(id, method, params, reqOpts) {
    const window = computeDispatchWindow(reqOpts);
    if (!window.ok) return Promise.resolve({ ok: false, reason: window.reason });
    const timeoutMs = window.timeoutMs;
    return new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => finish({ ok: false, reason: 'timeout-possibly-delivered' }), timeoutMs);
      function finish(result) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        state.pending.delete(id);
        resolve(result);
      }
      state.pending.set(id, { finish });
      writeJsonlFrame(stdin, { id, method, params }, (err) => {
        if (err) finish({ ok: false, reason: 'write-failed-confirmed-before-commit:' + String((err && err.message) || err) });
        // else: flushed successfully -- genuinely possibly-delivered now; wait for response/timeout/EOF.
      });
    });
  }

  /**
   * R7: STOPPING-then-flush-then-STOPPED (A6). SR-01 (refresh) is delegated
   * to the injected credential-refresh controller -- the sole row that may
   * continue the connection; every other row/unknown-method transitions to
   * STOPPING BEFORE its reply is even written, flushes the exact frozen
   * reply, and only THEN finalizes to STOPPED.
   */
  function handleServerRequest(frame) {
    if (isTerminal()) return; // A2/D5: never process a server request once STOP has begun.
    const { id, method, params } = frame;
    if (method === 'account/chatgptAuthTokens/refresh') {
      handleRefreshServerRequest(id, params);
      return;
    }
    // R8 (item 13): a bare `SERVER_REQUEST_FIXED_ROWS[method]` bracket lookup
    // on a plain object literal would return an INHERITED Object.prototype
    // member for a method literally named "toString"/"constructor"/etc. --
    // hasOwnProperty closes that inherited-property hole.
    const row = Object.prototype.hasOwnProperty.call(serverRequestFixedRows, method) ? serverRequestFixedRows[method] : undefined;
    if (!row) {
      beginStop('unknown-server-request-method:' + method);
      writeThenFinalizeStop({ id, error: serverRequestUnknownMethodError });
      return;
    }
    // R8 (item 8): method-specific params validation for SR-02..SR-10 -- an
    // invalid shape gets a dedicated error response and STOP instead of the
    // row's normal frozen reply.
    const validator = Object.prototype.hasOwnProperty.call(serverRequestParamsValidators, method) ? serverRequestParamsValidators[method] : null;
    if (validator && !validator(params)) {
      beginStop('invalid-server-request-params:' + method);
      writeThenFinalizeStop({ id, error: serverRequestInvalidParamsError });
      return;
    }
    beginStop('server-request-' + method);
    writeThenFinalizeStop(Object.assign({ id }, row));
  }

  /** E1: returns an unsubscribe function so a caller's own listener never outlives its need. */
  function onNotification(method, handler) {
    if (!state.notificationHandlers.has(method)) state.notificationHandlers.set(method, []);
    const arr = state.notificationHandlers.get(method);
    arr.push(handler);
    let removed = false;
    return function unsubscribe() {
      if (removed) return;
      removed = true;
      const idx = arr.indexOf(handler);
      if (idx !== -1) arr.splice(idx, 1);
    };
  }

  return Object.freeze({ allocateId, computeDispatchWindow, dispatchRequest, handleServerRequest, onNotification });
}

module.exports = Object.freeze({ createRpcDispatch });
