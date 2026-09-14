'use strict';

// Extracted behaviorally from runtime-bridge-codex.cjs's
// startOwnedAppServerSupervisorEngine: the one engine instance's own mutable
// state (readiness promise, stop bookkeeping, the root/child ledger,
// retained workers, in-flight job tracking). Every field is private behind
// an explicit getter/setter/method -- Maps/Sets/arrays are exposed directly
// (the same convention app-server-connection-state.cjs already established)
// since the collection itself, not a wrapper, is the correct abstraction.
// Never requires the facade or either sibling facade, directly or
// transitively. A second createSupervisorEngineState() call shares nothing
// with the first -- no module-level mutable field of its own.

function createSupervisorEngineState({ getBatchReady, ownedChildRef }) {
  let resolveReady;
  let rejectReady;
  const readyPromise = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  let engineStopRequested = false;
  let stopPromiseCache = null;
  let startupSettled = false;
  /** A no-op once startupSettled or the batch already reached durable READY -- never rejects a promise the caller has already treated as settled. */
  function settleReadyOnStartupFailure(reason) {
    if (startupSettled || getBatchReady()) return;
    startupSettled = true;
    rejectReady(new Error('startup-failed:' + String(reason)));
  }
  const ledger = new Map();
  let isolationProvider = null;
  const retainedWorkers = [];
  let deterministicMcpControl = null;
  let pollInFlight = false;
  let pollTicketPromise = null;
  let firstStopReason = null;
  const pendingRawMcpPromises = new Set();
  function registerRawMcpPromise(promise) {
    pendingRawMcpPromises.add(promise);
    const untrack = () => { pendingRawMcpPromises.delete(promise); };
    promise.then(untrack, untrack);
  }
  let admissionClosed = false;
  let startupJoinSettled = false;
  const observerJobs = new Set();
  const bornVerificationPending = new Set();
  let resolveStopSignal;
  const stopSignal = { promise: new Promise((resolve) => { resolveStopSignal = resolve; }) };
  function ownedChildrenSnapshot() {
    return (Array.isArray(ownedChildRef.children) && ownedChildRef.children.length > 0)
      ? ownedChildRef.children.slice()
      : (ownedChildRef.child ? [ownedChildRef.child] : []);
  }

  return Object.freeze({
    readyPromise,
    resolveReady: () => resolveReady(),
    settleReadyOnStartupFailure,
    getEngineStopRequested: () => engineStopRequested,
    setEngineStopRequested: (v) => { engineStopRequested = v; },
    getStopPromiseCache: () => stopPromiseCache,
    setStopPromiseCache: (v) => { stopPromiseCache = v; },
    ledger,
    getIsolationProvider: () => isolationProvider,
    setIsolationProvider: (v) => { isolationProvider = v; },
    retainedWorkers,
    getDeterministicMcpControl: () => deterministicMcpControl,
    setDeterministicMcpControl: (v) => { deterministicMcpControl = v; },
    getPollInFlight: () => pollInFlight,
    setPollInFlight: (v) => { pollInFlight = v; },
    getPollTicketPromise: () => pollTicketPromise,
    setPollTicketPromise: (v) => { pollTicketPromise = v; },
    getFirstStopReason: () => firstStopReason,
    setFirstStopReasonIfUnset: (reason) => { if (firstStopReason === null) firstStopReason = reason; },
    pendingRawMcpPromises,
    registerRawMcpPromise,
    getAdmissionClosed: () => admissionClosed,
    setAdmissionClosed: (v) => { admissionClosed = v; },
    getStartupJoinSettled: () => startupJoinSettled,
    setStartupJoinSettled: (v) => { startupJoinSettled = v; },
    observerJobs,
    bornVerificationPending,
    stopSignal,
    resolveStopSignal: () => resolveStopSignal(),
    ownedChildrenSnapshot,
  });
}

module.exports = Object.freeze({ createSupervisorEngineState });
