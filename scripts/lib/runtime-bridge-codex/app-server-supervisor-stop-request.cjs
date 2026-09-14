'use strict';

// Extracted behaviorally from runtime-bridge-codex.cjs's
// startOwnedAppServerSupervisorEngine: the engine's own t0 actions and the
// two legitimate ways to reach them -- the public, memoized requestStop,
// and the coordinator's own pre-engine-to-engine handoff hook
// runStopTimelineDirect. `clearEngineTimers` is injected because
// keepAliveHandle/expiryTimer/startupExpiryTimer are facade-module-scope
// lets, not this engine's own state. Never requires the facade or either
// sibling facade, directly or transitively.

function createSupervisorStopRequest({
  engine, injectedShutdown, settleReadyOnStartupFailure,
  getEngineStopRequested, setEngineStopRequested, getStopPromiseCache, setStopPromiseCache,
  setAdmissionClosed, setFirstStopReasonIfUnset, getDeterministicMcpControl, resolveStopSignal,
  clearEngineTimers, runOwnedStopTimeline,
}) {
  const shutdown = (reason) => {
    settleReadyOnStartupFailure(reason);
    return injectedShutdown(reason);
  };

  /**
   * The engine's own t0 actions and actual stop-timeline invocation,
   * factored out so runStopTimelineDirect (below) can perform the IDENTICAL
   * sequence without going through requestStop's own memoization check
   * (which would otherwise create a circular self-referential Promise).
   */
  function performT0AndRunTimeline(reason) {
    setFirstStopReasonIfUnset(reason);
    setEngineStopRequested(true);
    setAdmissionClosed(true);
    clearEngineTimers();
    const deterministicMcpControl = getDeterministicMcpControl();
    if (deterministicMcpControl) void deterministicMcpControl.beginClose();
    resolveStopSignal();
    settleReadyOnStartupFailure(reason);
    return runOwnedStopTimeline(reason);
  }

  /**
   * This engine no longer owns an independent memoized Promise of its own
   * for a real cmdSessionRun batch -- engine.sharedStopCache (present ONLY
   * for a real batch) is the SAME physical cache cell
   * installShutdownHandlers' own coordinator reads and writes. Whichever
   * side is called FIRST performs the real t0/stop-timeline work and
   * commits its result into that ONE shared cell; the other side reads the
   * SAME cell back and returns the literal identical Promise, never a
   * second one. Absent a shared cache (direct-engine test), falls back to
   * this closure's own local stopPromiseCache.
   */
  function requestStop(reason) {
    const cache = engine.sharedStopCache || null;
    const existing = cache ? cache.promise : getStopPromiseCache();
    if (existing) return existing;
    const p = performT0AndRunTimeline(reason);
    if (cache) { cache.promise = p; } else { setStopPromiseCache(p); }
    return p;
  }

  /**
   * The coordinator's OWN pre-engine-to-engine handoff hook, and the ONLY
   * legitimate caller of this function -- never a second public stop
   * entrypoint. By the time installShutdownHandlers' own
   * runPreEngineStopTimeline discovers this engine exists, the coordinator
   * has ALREADY synchronously committed its own manually-resolvable Promise
   * into sharedStopCache.promise, so calling this engine's own
   * cache-checking requestStop here would just read that SAME still-pending
   * Promise back out and return it -- which the coordinator would then try
   * to resolve WITH ITSELF, a circular self-reference Node rejects. This
   * performs the real t0/stop-timeline work directly, bypassing the cache
   * check entirely; engineStopRequested is this function's own defensive
   * re-entrancy guard (should never actually be true on entry given the
   * current call graph, but a genuine double-invocation is still never
   * silently re-run).
   */
  function runStopTimelineDirect(reason) {
    if (getEngineStopRequested()) {
      return (engine.sharedStopCache && engine.sharedStopCache.promise) || getStopPromiseCache();
    }
    const p = performT0AndRunTimeline(reason);
    setStopPromiseCache(p);
    return p;
  }

  return Object.freeze({ shutdown, performT0AndRunTimeline, requestStop, runStopTimelineDirect });
}

module.exports = Object.freeze({ createSupervisorStopRequest });
