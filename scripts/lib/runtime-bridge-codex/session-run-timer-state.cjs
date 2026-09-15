'use strict';

// The `session-run` subcommand is a single long-running CLI process; the five
// pieces of state below (shutdown flag, keep-alive interval, the two expiry
// timers, and the one test-only delay timer) are genuinely process-lifetime,
// not per-call -- a LATER, unrelated cmdSessionRun invocation in the same
// process must never inherit an earlier run's already-closed timers. This
// factory is composed exactly once by the facade (mirroring the plain
// module-level `let`s this state used to be) and its methods are threaded
// into every function that needs to read or mutate this shared timeline.

function createSessionRunTimerState() {
  let shuttingDown = false;
  let keepAliveHandle = null;
  let expiryTimer = null;
  let startupExpiryTimer = null;
  let testOnlyDelayTimer = null;

  return Object.freeze({
    isShuttingDown: () => shuttingDown,
    markShuttingDown: () => { shuttingDown = true; },
    setKeepAliveHandle: (handle) => { keepAliveHandle = handle; },
    clearKeepAliveHandle: () => {
      if (keepAliveHandle) { clearInterval(keepAliveHandle); keepAliveHandle = null; }
    },
    setExpiryTimer: (timer) => { expiryTimer = timer; },
    clearExpiryTimer: () => {
      if (expiryTimer) { clearTimeout(expiryTimer); expiryTimer = null; }
    },
    setStartupExpiryTimer: (timer) => { startupExpiryTimer = timer; },
    clearStartupExpiryTimer: () => {
      if (startupExpiryTimer) { clearTimeout(startupExpiryTimer); startupExpiryTimer = null; }
    },
    setTestOnlyDelayTimer: (timer) => { testOnlyDelayTimer = timer; },
    clearTestOnlyDelayTimer: () => {
      if (testOnlyDelayTimer) { clearTimeout(testOnlyDelayTimer); testOnlyDelayTimer = null; }
    },
  });
}

module.exports = Object.freeze({ createSessionRunTimerState });
