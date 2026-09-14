'use strict';

// Sequence 0009: the single private mutable record for one
// createAppServerConnection instance, extracted so every controller can
// share it without a generic service-locator bag -- each field is reached
// only through an explicit, named accessor. Map/Set containers (`pending`,
// `usedAccessTokens`, `retiredTurnIds`, `notificationHandlers`) are exposed
// as the SAME live container object every caller already mutated directly
// (a getter/setter pair for a Map/Set would only add indirection, not
// safety); scalar fields get an explicit get/set pair since JS has no way
// to share a mutable reference to a primitive. Zero dependencies -- never
// requires the facade or either sibling facade, directly or transitively.

function createConnectionState() {
  let nextId = 1;
  const pending = new Map(); // id -> {finish(result)}

  let lastCredentialRefreshOutcome = null;
  let pendingCredentialSettlement = null; // {resolve,reject} for the ONE currently in-flight settlement, or null.

  let phase = 'NEW';
  let stopReason = null;
  let initializeCalled = false;
  let loginCalled = false;
  let authenticatedIdentity = null; // {chatgptAccountId,chatgptPlanType} once login() succeeds.

  const usedAccessTokens = new Set(); // every accessToken this connection has EVER been authenticated with.
  let refreshEpoch = 0;
  let activeRefreshEpoch = null; // null = no refresh in flight; otherwise the epoch number of the one currently in flight.

  let threadLifecycleState = 'IDLE'; // 'IDLE' | 'THREAD_START_PENDING' | 'THREAD_RESUME_PENDING' | 'ACTIVE'.
  let activeThreadId = null;
  let pendingThreadId = null;
  let lastArchivedThreadId = null;
  let currentTurn = null;
  const retiredTurnIds = new Set();

  const notificationHandlers = new Map(); // method -> Array<(params) => void>

  return Object.freeze({
    allocateId: () => nextId++,
    pending,

    getLastCredentialRefreshOutcome: () => lastCredentialRefreshOutcome,
    setLastCredentialRefreshOutcome: (value) => { lastCredentialRefreshOutcome = value; },
    getPendingCredentialSettlement: () => pendingCredentialSettlement,
    setPendingCredentialSettlement: (value) => { pendingCredentialSettlement = value; },

    getPhase: () => phase,
    setPhase: (value) => { phase = value; },
    getStopReason: () => stopReason,
    setStopReason: (value) => { stopReason = value; },
    getInitializeCalled: () => initializeCalled,
    setInitializeCalled: (value) => { initializeCalled = value; },
    getLoginCalled: () => loginCalled,
    setLoginCalled: (value) => { loginCalled = value; },
    getAuthenticatedIdentity: () => authenticatedIdentity,
    setAuthenticatedIdentity: (value) => { authenticatedIdentity = value; },

    usedAccessTokens,
    getRefreshEpoch: () => refreshEpoch,
    nextRefreshEpoch: () => { refreshEpoch += 1; return refreshEpoch; },
    getActiveRefreshEpoch: () => activeRefreshEpoch,
    setActiveRefreshEpoch: (value) => { activeRefreshEpoch = value; },

    getThreadLifecycleState: () => threadLifecycleState,
    setThreadLifecycleState: (value) => { threadLifecycleState = value; },
    getActiveThreadId: () => activeThreadId,
    setActiveThreadId: (value) => { activeThreadId = value; },
    getPendingThreadId: () => pendingThreadId,
    setPendingThreadId: (value) => { pendingThreadId = value; },
    getLastArchivedThreadId: () => lastArchivedThreadId,
    setLastArchivedThreadId: (value) => { lastArchivedThreadId = value; },
    getCurrentTurn: () => currentTurn,
    setCurrentTurn: (value) => { currentTurn = value; },
    retiredTurnIds,

    notificationHandlers,

    // finalizeStop's own "R14 (Bloque A): STOP clears ALL lifecycle
    // authority" reset, kept as one atomic method so every caller resets
    // the exact same field set finalizeStop always has, never a partial
    // hand-copied subset.
    resetThreadLifecycleOnStop() {
      threadLifecycleState = 'IDLE';
      activeThreadId = null;
      pendingThreadId = null;
      lastArchivedThreadId = null;
      currentTurn = null;
      retiredTurnIds.clear();
    },
  });
}

module.exports = Object.freeze({ createConnectionState });
