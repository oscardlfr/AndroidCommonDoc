'use strict';

// Extracted verbatim (behaviorally) from runtime-bridge-codex.cjs's
// createAppServerConnection: the phase machine, pending-call settlement and
// safe-shutdown primitives. `settlePendingCredentialOutcome` is injected
// (owned by the credential-refresh controller) so this module never needs to
// know anything about credential refresh beyond "call this on stop". Never
// requires the facade or either sibling facade, directly or transitively.

function createConnectionLifecycle({ state, writeJsonlFrame, stdin, defaultRpcTimeoutMs, settlePendingCredentialOutcome }) {
  function isTerminal() {
    const phase = state.getPhase();
    return phase === 'STOPPING' || phase === 'STOPPED';
  }

  /** Settles every currently-pending call with `reason` and clears the map -- used on malformed frame / transport EOF / transport error / full teardown, never leaving a caller hanging. */
  function failAllPending(reason) {
    const waiters = Array.from(state.pending.values());
    state.pending.clear();
    for (const w of waiters) w.finish({ ok: false, reason });
  }

  /** Idempotent: first reason wins, phase only ever moves forward. Does NOT yet fail pending calls -- see finalizeStop. */
  function beginStop(reason) {
    if (isTerminal()) return;
    state.setStopReason(reason);
    state.setPhase('STOPPING');
  }

  /**
   * Idempotent terminal teardown: settles all pending calls, drops all
   * notification handlers and turn-completion registrations, and frees
   * per-thread/turn tracking (E3 "no crecen sin límite; se limpian en
   * archive y STOP"). `pendingReason` lets a caller give currently-pending
   * calls a MORE SPECIFIC rejection reason than the connection's own
   * diagnostic `stopReason` (queried via `stopReason()`).
   */
  function finalizeStop(pendingReason) {
    if (state.getPhase() === 'STOPPED') return;
    state.setPhase('STOPPED');
    failAllPending(typeof pendingReason === 'string' ? pendingReason : state.getStopReason());
    state.notificationHandlers.clear();
    state.setActiveRefreshEpoch(null); // R10: harmless once terminal (isTerminal() already gates every dispatch), but keeps state tidy; also drops any stale epoch a late callback might still reference.
    // CORRECTION ROUND Block A: an unrelated STOP (malformed frame, EOF,
    // transport error) arriving while a credential settlement is still
    // pending must still abort it exactly once -- otherwise the broker's
    // lock/account stay stuck pending forever, and this connection can never
    // be the thing that eventually settles it (STOPPED is terminal).
    settlePendingCredentialOutcome(false, 'connection-stopped');
    // R14 (Bloque A): STOP clears ALL lifecycle authority -- the single
    // consolidated record, not several independent structures.
    state.resetThreadLifecycleOnStop();
  }

  /** The single terminal-STOP primitive for every trigger EXCEPT the server-request reply path (which needs the STOPPING window to finish its own flush first -- see handleServerRequest). */
  function terminalStop(reason, pendingReason) {
    beginStop(reason);
    finalizeStop(pendingReason);
  }

  /**
   * R10 (Codex NO-GO P2, Block D): every server-request negative-path reply
   * used to finalize ONLY from `writeJsonlFrame`'s own completion callback --
   * `beginStop` had already run, so `phase` was 'STOPPING', but if that
   * callback never fires (a hung/broken stdin the transport itself never
   * surfaces as an error or close event), `finalizeStop` never runs either.
   * A bounded timeout now races the real write callback -- settle-once, same
   * pattern as the refresh flush timer.
   */
  function writeThenFinalizeStop(frame) {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      finalizeStop();
    }, defaultRpcTimeoutMs);
    writeJsonlFrame(stdin, frame, () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      finalizeStop();
    });
  }

  return Object.freeze({ isTerminal, failAllPending, beginStop, finalizeStop, terminalStop, writeThenFinalizeStop });
}

module.exports = Object.freeze({ createConnectionLifecycle });
