'use strict';

// Per-connection composition root for the app-server JSONL wire client (7 sequence 5-10 sub-modules), plus retained session-generation liveness recheck throttling and the redacted test-only credential-refresh-outcome inspector.

function createAppServerConnectionModule({
  AUTH_MODE_VALUES,
  DEFAULT_RPC_TIMEOUT_MS,
  MAX_RETIRED_TURN_IDS_PER_THREAD,
  PLAN_TYPE_VALUES,
  RETAINED_SESSION_GENERATION_RECHECK_INTERVAL_MS,
  RETAINED_WORKER_POLL_INTERVAL_MS,
  SERVER_REQUEST_FIXED_ROWS,
  SERVER_REQUEST_INVALID_PARAMS_ERROR,
  SERVER_REQUEST_PARAMS_VALIDATORS,
  SERVER_REQUEST_REFRESH_FAILED_ERROR,
  SERVER_REQUEST_UNKNOWN_METHOD_ERROR,
  asyncSleep,
  classifyIncomingFrame,
  codexStructuredRuntimeTurnEnvelopeSchema,
  createJsonlFrameFeeder,
  createAppServerRpcMethods,
  createAppServerTurnCompletion,
  createConnectionLifecycle,
  createConnectionState,
  createCredentialRefresh,
  createRpcDispatch,
  createTurnCorrelation,
  crypto,
  describeRpcError,
  hasExactKeys,
  isUnknownThreadArchiveError,
  isValidAccountUpdatedNotification,
  isValidAgentMessageItem,
  isValidChatgptAuthTokensRefreshParams,
  isValidInitializeResponse,
  isValidLoginAccountResponse,
  isValidThreadArchiveResponse,
  isValidThreadReadParams,
  isValidThreadReadResponse,
  isValidThreadStartOrResumeResponse,
  isValidTurnCompletedNotification,
  isValidTurnInterruptResponse,
  isValidTurnStartResponse,
  isValidTurnStartedNotification,
  sessionGenerationIsLive,
  unwrapAndValidateCodexStructuredRuntimeTurnEnvelope,
  writeJsonlFrame,
}) {
// Retained inline: tied to this facade's own session-generation liveness
// proof (sessionGenerationIsLive) and its retry-interval constant, not a
// generic app-server protocol/diagnostic concern.
function retainedSessionGenerationStatus(action, lastCheckedAtMs, nowMs, isGenerationLive) {
  if (!(nowMs - lastCheckedAtMs >= RETAINED_SESSION_GENERATION_RECHECK_INTERVAL_MS)) return { due: false };
  const prove = typeof isGenerationLive === 'function' ? isGenerationLive : sessionGenerationIsLive;
  let live;
  try {
    live = prove({ repoId: action.repo_id }, action.session_generation_id);
  } catch (err) {
    live = false;
  }
  return { due: true, retired: live !== true, checkedAtMs: nowMs };
}


const connectionCredentialOutcomeInternals = new WeakMap();

/**
 * Creates a bidirectional app-server JSONL connection over the given
 * transport. `transport` is `{stdin: Writable, stdout: Readable}` -- either
 * a real ChildProcess's stdio pair or a test fake (e.g. a `stream.
 * PassThrough` pair). Owns frame ID allocation, request/response
 * correlation, and fail-closed handling of the 10 live-observed
 * server-initiated requests (PLAN.md ~L957 "Server-request handler
 * (fail-closed)"). `refreshProvider`, when supplied, is called
 * synchronously for `account/chatgptAuthTokens/refresh` and must return
 * `{ok:true,accessToken,chatgptAccountId,chatgptPlanType}` or `{ok:false}`
 * -- production wires this to `CredentialBroker/v1` (not yet built); tests
 * inject an explicit fake. Absent, refresh fails closed.
 *
 * Fail-closed transport contract (R5 correction, this revision): a
 * malformed frame, a `stdout` `'end'`/`'error'` event, or a failed/thrown
 * `stdin.write()` all mark the connection STOPped and settle every
 * currently-pending call with a distinct failure reason -- nothing is ever
 * left hanging indefinitely, and a corrupted/desynced transport is never
 * silently trusted to keep framing correctly afterward. Every request
 * registers its pending entry BEFORE the write that could (for a
 * synchronous fake transport) trigger an immediate response -- the
 * opposite order previously left a genuinely-synchronous echo unmatched.
 * @param {{stdin:object, stdout:object, refreshProvider?:Function}} opts
 */
function createAppServerConnection(opts) {
  const { stdin, stdout, refreshProvider, credentialBinding } = opts;
  const state = createConnectionState();

  // credentialRefresh and turnCorrelation each need a capability the OTHER
  // owns (turnCorrelation.isRefreshing / credentialRefresh.onRefreshConfirmed)
  // even though neither module ever requires the other -- broken via a
  // forward-declared thunk, the same pattern proven in
  // scripts/lib/runtime-role-lifecycle's session-generation/private-registry pair.
  let credentialRefresh;
  let turnCorrelation;

  const lifecycle = createConnectionLifecycle({
    state, writeJsonlFrame, stdin, defaultRpcTimeoutMs: DEFAULT_RPC_TIMEOUT_MS,
    settlePendingCredentialOutcome: (...args) => credentialRefresh.settlePendingCredentialOutcome(...args),
  });
  const { isTerminal, beginStop, finalizeStop, terminalStop, writeThenFinalizeStop } = lifecycle;

  const rpcDispatch = createRpcDispatch({
    state, stdin, writeJsonlFrame, isTerminal,
    isRefreshing: (...args) => credentialRefresh.isRefreshing(...args),
    defaultRpcTimeoutMs: DEFAULT_RPC_TIMEOUT_MS, beginStop, writeThenFinalizeStop,
    handleRefreshServerRequest: (...args) => credentialRefresh.handleRefreshServerRequest(...args),
    serverRequestFixedRows: SERVER_REQUEST_FIXED_ROWS,
    serverRequestParamsValidators: SERVER_REQUEST_PARAMS_VALIDATORS,
    serverRequestUnknownMethodError: SERVER_REQUEST_UNKNOWN_METHOD_ERROR,
    serverRequestInvalidParamsError: SERVER_REQUEST_INVALID_PARAMS_ERROR,
  });
  const { allocateId, computeDispatchWindow, dispatchRequest, handleServerRequest, onNotification } = rpcDispatch;

  credentialRefresh = createCredentialRefresh({
    state, stdin, writeJsonlFrame, isTerminal, beginStop, terminalStop, writeThenFinalizeStop,
    onRefreshConfirmed: (...args) => turnCorrelation.onRefreshConfirmed(...args),
    refreshProvider, credentialBinding, defaultRpcTimeoutMs: DEFAULT_RPC_TIMEOUT_MS,
    isValidChatgptAuthTokensRefreshParams, serverRequestRefreshFailedError: SERVER_REQUEST_REFRESH_FAILED_ERROR,
    serverRequestInvalidParamsError: SERVER_REQUEST_INVALID_PARAMS_ERROR,
  });
  const { isRefreshing, settlePendingCredentialOutcome, handleRefreshServerRequest } = credentialRefresh;

  const appServerTurnCompletion = createAppServerTurnCompletion({
    terminalStop, isValidAgentMessageItem, unwrapAndValidateCodexStructuredRuntimeTurnEnvelope, crypto,
  });
  const { invokeTurnCompletionResult, invokeTurnCompletionHandler, boundedTurnErrorSuffix } = appServerTurnCompletion;

  turnCorrelation = createTurnCorrelation({
    state, terminalStop, isTerminal, isRefreshing, dispatchRequest, allocateId,
    invokeTurnCompletionResult, invokeTurnCompletionHandler, boundedTurnErrorSuffix,
    isValidThreadReadParams, isValidThreadReadResponse,
    isValidTurnStartedNotification, isValidTurnCompletedNotification,
    hasExactKeys, asyncSleep, retainedWorkerPollIntervalMs: RETAINED_WORKER_POLL_INTERVAL_MS,
    maxRetiredTurnIdsPerThread: MAX_RETIRED_TURN_IDS_PER_THREAD,
  });
  const {
    retireTurnId, isCurrentTurnSafelyTerminal, isCurrentTurnSafeToArchive,
    bindOrVerifyCurrentTurnId, tryDeliverCurrentTurn, correlateTurnNotification,
  } = turnCorrelation;

  const rpcMethods = createAppServerRpcMethods({
    state, stdin, writeJsonlFrame, isTerminal, terminalStop, dispatchRequest, computeDispatchWindow,
    onNotification, hasExactKeys, defaultRpcTimeoutMs: DEFAULT_RPC_TIMEOUT_MS,
    isValidInitializeResponse, isValidLoginAccountResponse, isValidAccountUpdatedNotification,
    isValidThreadStartOrResumeResponse, isValidTurnStartResponse, isValidTurnInterruptResponse,
    isValidThreadArchiveResponse, authModeValues: AUTH_MODE_VALUES, planTypeValues: PLAN_TYPE_VALUES,
    describeRpcError, isUnknownThreadArchiveError,
    isCurrentTurnSafelyTerminal, isCurrentTurnSafeToArchive, bindOrVerifyCurrentTurnId,
    retireTurnId, tryDeliverCurrentTurn, codexStructuredRuntimeTurnEnvelopeSchema,
  });
  const {
    initialize, login, threadStart, threadResume, turnStart, onTurnCompleted,
    turnInterrupt, threadArchive,
  } = rpcMethods;

  // Incoming-frame router: stays here (not in any single controller) because
  // it fans a single wire-level event out across dispatch/turn-correlation/
  // server-request handling -- exactly the orchestration this factory alone
  // is responsible for.
  const feed = createJsonlFrameFeeder(
    (frame) => {
      if (isTerminal()) return; // defense in depth -- the feeder's own shouldStop already gates this in the normal dispatch path.
      const classified = classifyIncomingFrame(frame);
      if (classified.kind === 'invalid') { terminalStop('invalid-frame:' + classified.reason); return; }
      if (classified.kind === 'response') {
        const waiter = state.pending.get(classified.id);
        if (!waiter) {
          // A second response sharing the SAME id as the current turn's own
          // turn/start request must reach the lifecycle machine and STOP,
          // never fall through as an unrelated stray. Bounded to this ONE
          // currentTurn record's own turnStartRequestId field.
          const currentTurn = state.getCurrentTurn();
          if (currentTurn && currentTurn.turnStartRequestId === classified.id) {
            terminalStop('duplicate-rpc-response');
          }
          return; // otherwise: no matching pending call -- diagnostic-only, never fabricated (B4).
        }
        waiter.finish(classified.ok ? { ok: true, result: classified.result } : { ok: false, error: classified.error });
        return;
      }
      if (classified.kind === 'server-request') { handleServerRequest(classified.frame); return; }
      // notification
      if (classified.method === 'turn/started' || classified.method === 'turn/completed') {
        correlateTurnNotification(classified.method, classified.params);
        return;
      }
      const handlers = (state.notificationHandlers.get(classified.method) || []).slice(); // snapshot -- a handler unsubscribing mid-dispatch must not skip a sibling.
      for (const h of handlers) {
        try { h(classified.params); } catch (err) { terminalStop('notification-handler-exception:' + String((err && err.message) || err)); return; } // E4.
      }
    },
    // A transport that just emitted a byte sequence that isn't valid framing
    // cannot be trusted to still be correctly framed afterward -- fail
    // closed: STOP the connection and settle every currently-pending call
    // rather than let them hang.
    (reason, rawLine) => {
      terminalStop('malformed-frame:' + reason);
    },
    () => isTerminal(),
  );
  stdout.on('data', feed);
  // EOF/transport-error are "possibly-delivered, never confirmed" per
  // PLAN.md ~L934 -- settle everything currently pending, never silently
  // stall a caller.
  stdout.on('end', () => {
    terminalStop('transport-eof', 'transport-eof-possibly-delivered');
  });
  stdout.on('error', (err) => {
    const msg = String((err && err.message) || err);
    terminalStop('transport-error:' + msg, 'transport-error-possibly-delivered:' + msg);
  });
  // A real Readable can emit 'close' WITHOUT ever emitting 'end' or 'error'
  // first (an abrupt destroy/pipe-break).
  stdout.on('close', () => {
    terminalStop('transport-close', 'transport-close-possibly-delivered');
  });
  // An unhandled 'error' event on any EventEmitter is fatal by Node's own
  // default. A broken write-side pipe (e.g. EPIPE) must STOP this
  // connection, never crash the host process. Guarded by
  // `typeof stdin.on === 'function'`: a minimal test fake that implements
  // only `.write()` must not be forced to also implement the full
  // EventEmitter interface just for this listener.
  if (typeof stdin.on === 'function') {
    stdin.on('error', (err) => {
      const msg = String((err && err.message) || err);
      terminalStop('stdin-error:' + msg, 'stdin-error-possibly-delivered:' + msg);
    });
    // Symmetric with stdout's own 'close' handling above -- a Writable can
    // also be destroyed/closed without an 'error' ever firing.
    stdin.on('close', () => {
      terminalStop('stdin-close', 'stdin-close-possibly-delivered');
    });
  }

  // `sendRequest`/`sendNotification` raw escape hatches are deliberately
  // never exposed -- each dedicated method above calls `dispatchRequest`/
  // `writeJsonlFrame` directly with its own gating already applied.
  const connection = {
    initialize,
    login,
    threadStart,
    threadResume,
    turnStart,
    onTurnCompleted,
    turnInterrupt,
    threadArchive,
    onNotification,
    isStopped: () => isTerminal(),
    stopReason: () => state.getStopReason(),
    connectionPhase: () => state.getPhase(),
  };
  // The raw (secret-bearing) credential-refresh outcome is deliberately
  // NEVER a field on `connection` itself -- only a redacted view is ever
  // reachable, and only through the test-capability-gated
  // __testOnlyInspectCredentialRefreshOutcome below.
  connectionCredentialOutcomeInternals.set(connection, { getRaw: () => state.getLastCredentialRefreshOutcome() });
  return connection;
}
/**
 * Module-level introspection export (same convention as
 * __testOnlyInspectFinalizationState above), exported only when
 * isTestCapability() is true -- absent entirely (not merely `undefined`) in
 * production. Returns `undefined` for any object this module never
 * constructed (never throws on a foreign/unrecognized argument). Never
 * returns the raw outcome itself (which carries a real accessToken on
 * success) -- only a REDACTED view with non-secret fields.
 * @param {object} connection the exact object createAppServerConnection returned.
 * @returns {{committed:boolean, reason:string, observedAt:string}|null|undefined} undefined for a foreign object, null if no outcome has ever been observed yet.
 */
function __testOnlyInspectCredentialRefreshOutcome(connection) {
  const internals = connectionCredentialOutcomeInternals.get(connection);
  if (!internals) return undefined;
  const raw = internals.getRaw();
  if (raw === null) return null;
  return {
    committed: !!(raw.outcome && raw.outcome.ok === true),
    reason: raw.reason,
    observedAt: raw.observedAt,
  };
}

  return Object.freeze({
    __testOnlyInspectCredentialRefreshOutcome,
    createAppServerConnection,
    retainedSessionGenerationStatus,
  });
}

module.exports = Object.freeze({ createAppServerConnectionModule });
