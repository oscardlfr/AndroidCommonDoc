'use strict';

// Extracted behaviorally from runtime-bridge-codex.cjs's createAppServerConnection:
// the public initialize/login/threadStart/threadResume/turnStart/
// onTurnCompleted/turnInterrupt/threadArchive methods, plus the shared
// ThreadStartResponse/ThreadResumeResponse validator. Every cross-controller
// need (state, lifecycle, dispatch, turn-correlation, protocol validators,
// diagnostics) is an explicit injected capability. Never requires the facade
// or either sibling facade, directly or transitively.

function createAppServerRpcMethods({
  state, stdin, writeJsonlFrame, isTerminal, terminalStop, dispatchRequest, computeDispatchWindow,
  onNotification, hasExactKeys, defaultRpcTimeoutMs,
  isValidInitializeResponse, isValidLoginAccountResponse, isValidAccountUpdatedNotification,
  isValidThreadStartOrResumeResponse, isValidTurnStartResponse, isValidTurnInterruptResponse,
  isValidThreadArchiveResponse, authModeValues, planTypeValues,
  describeRpcError, isUnknownThreadArchiveError,
  isCurrentTurnSafelyTerminal, isCurrentTurnSafeToArchive, bindOrVerifyCurrentTurnId,
  retireTurnId, tryDeliverCurrentTurn, codexStructuredRuntimeTurnEnvelopeSchema,
}) {
  /**
   * `initialize` (PLAN.md ~L897/~L899): request id EXACTLY 1 (structurally
   * guaranteed -- only `initialize` may run from phase NEW), only from phase
   * NEW, never called twice. Validated against the real `InitializeResponse`
   * shape; `initialized`'s own flush is credited BEFORE the connection
   * transitions to INITIALIZED or the call resolves ok.
   */
  function initialize(timeoutOpts) {
    if (isTerminal()) return Promise.resolve({ ok: false, reason: 'connection-stopped' });
    if (state.getPhase() !== 'NEW' || state.getInitializeCalled()) { terminalStop('initialize-wrong-phase-or-called-more-than-once'); return Promise.resolve({ ok: false, reason: 'initialize-wrong-phase-or-called-more-than-once' }); }
    state.setInitializeCalled(true);
    const id = state.allocateId();
    return dispatchRequest(id, 'initialize', {
      clientInfo: { name: 'android-common-doc-runtime-bridge', version: '1.0.0' },
      capabilities: { experimentalApi: true },
    }, timeoutOpts).then((res) => {
      // `res` already reflects whatever happened -- do NOT re-check isTerminal() and override a specific reason with a generic one.
      if (!res.ok) { terminalStop('initialize-rejected:' + (res.reason || 'error-response')); return res; }
      if (isTerminal()) return { ok: false, reason: state.getStopReason() }; // a stale-but-valid response must never "resurrect" the connection after a later-in-chunk STOP.
      const r = res.result;
      if (!r || typeof r !== 'object' || Array.isArray(r) || !isValidInitializeResponse(r)) {
        terminalStop('initialize-response-schema-invalid');
        return { ok: false, reason: 'initialize-response-schema-invalid' };
      }
      if (r.userAgent.length === 0 || r.codexHome.length === 0 || r.platformFamily.length === 0 || r.platformOs.length === 0) {
        terminalStop('initialize-response-invalid-shape');
        return { ok: false, reason: 'initialize-response-invalid-shape' };
      }
      return new Promise((resolve) => {
        writeJsonlFrame(stdin, { method: 'initialized', params: {} }, (err) => {
          if (isTerminal()) { resolve({ ok: false, reason: state.getStopReason() }); return; } // once STOPPING/STOPPED, no later-settling callback may write phase='INITIALIZED' again.
          if (err) { terminalStop('initialized-notification-write-failed'); resolve({ ok: false, reason: 'initialized-notification-write-failed' }); return; }
          state.setPhase('INITIALIZED');
          resolve(res);
        });
      });
    });
  }

  /**
   * `account/login/start` (PLAN.md ~L897). Within `timeoutMs`, requires in
   * EITHER arrival order: exactly one schema-valid id-matched
   * `LoginAccountResponse` with `type:"chatgptAuthTokens"`, AND an
   * `account/updated` notification whose `authMode=="chatgptAuthTokens"` AND
   * whose `planType` agrees with a non-null supplied `credentials.chatgptPlanType`.
   */
  function login(credentials, opts) {
    if (isTerminal()) return Promise.resolve({ ok: false, reason: 'connection-stopped' });
    if (state.getPhase() !== 'INITIALIZED' || state.getLoginCalled()) { terminalStop('login-wrong-phase-or-called-more-than-once'); return Promise.resolve({ ok: false, reason: 'login-wrong-phase-or-called-more-than-once' }); }
    // `loginCalled` only latches once this call confirms it will actually proceed -- a non-positive-deadline call must never permanently consume the one-shot latch.
    const explicitTimeoutMs = (opts && typeof opts.timeoutMs === 'number' && opts.timeoutMs > 0) ? opts.timeoutMs : defaultRpcTimeoutMs;
    let timeoutMs = Math.min(defaultRpcTimeoutMs, explicitTimeoutMs);
    if (opts && typeof opts.backendDeadlineMs === 'number') {
      timeoutMs = Math.min(timeoutMs, opts.backendDeadlineMs - Date.now());
      if (timeoutMs <= 0) return Promise.resolve({ ok: false, reason: 'deadline-non-positive' }); // never writes (mirrors dispatchRequest).
    }
    state.setLoginCalled(true);
    return new Promise((resolve) => {
      let responseOk = false;
      let notifiedOk = false;
      let observedPlanType = null;
      let settled = false;
      const timer = setTimeout(() => finish({ ok: false, reason: 'login-timeout' }), timeoutMs);
      function finish(result) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        state.pending.delete(id);
        if (typeof unsubscribeUpdated === 'function') unsubscribeUpdated();
        if (!result.ok) terminalStop('login-failed:' + result.reason);
        resolve(result);
      }
      let commitScheduled = false;
      function maybeSucceed() {
        if (responseOk && notifiedOk && !settled && !commitScheduled) {
          commitScheduled = true;
          // Deferred by one microtask so a later line in the SAME sync chunk (e.g. a malformed frame) that STOPs via failAllPending reaches this call's still-present `pending` entry FIRST, settling ok:false, rather than this resolving ok:true just before that STOP.
          queueMicrotask(() => {
            if (settled) return;
            if (isTerminal()) { finish({ ok: false, reason: state.getStopReason() }); return; }
            state.setPhase('AUTHENTICATED');
            // null->unknown/derived rule: a non-null broker value is exact authority; a null broker value carries no plan assertion, so the first already-validated account/updated notification supplies the effective value.
            const effectivePlanType = credentials.chatgptPlanType === null
              ? observedPlanType
              : credentials.chatgptPlanType;
            const authenticatedIdentity = { chatgptAccountId: credentials.chatgptAccountId, chatgptPlanType: effectivePlanType };
            state.setAuthenticatedIdentity(authenticatedIdentity);
            state.usedAccessTokens.add(credentials.accessToken); // the login token counts as "already used" -- a later refresh rolling back to it must be rejected too.
            // The handshake's OWN listener unsubscribes once settled -- vigilance continues via a SEPARATE, permanent listener so a LATER conflicting notification still STOPs it.
            onNotification('account/updated', (postParams) => {
              if (isTerminal()) return;
              if (!postParams || typeof postParams !== 'object' || Array.isArray(postParams) || !isValidAccountUpdatedNotification(postParams)) { terminalStop('post-login-account-updated-schema-invalid'); return; }
              if (!hasExactKeys(postParams, ['authMode', 'planType'].sort())) { terminalStop('post-login-account-updated-shape-invalid'); return; }
              if (postParams.authMode !== null && !authModeValues.includes(postParams.authMode)) { terminalStop('post-login-account-updated-authmode-not-enum'); return; }
              if (postParams.authMode !== 'chatgptAuthTokens') { terminalStop('post-login-conflicting-account-updated'); return; }
              if (postParams.planType !== null && !planTypeValues.includes(postParams.planType)) { terminalStop('post-login-account-updated-plantype-not-enum'); return; }
              if (postParams.planType !== null && authenticatedIdentity && postParams.planType !== authenticatedIdentity.chatgptPlanType) { terminalStop('post-login-conflicting-plan-type'); return; }
            });
            finish({ ok: true });
          });
        }
      }
      const id = state.allocateId();
      state.pending.set(id, {
        finish: (frameRes) => {
          if (!frameRes.ok) { finish({ ok: false, reason: frameRes.reason || 'login-response-invalid' }); return; }
          // LoginAccountResponse is a closed oneOf union; this bridge only
          // ever accepts the chatgptAuthTokens variant, a business rule
          // separate from the schema gate.
          const r = frameRes.result;
          if (!r || typeof r !== 'object' || Array.isArray(r) || !isValidLoginAccountResponse(r)) { finish({ ok: false, reason: 'login-response-schema-invalid' }); return; }
          if (r.type !== 'chatgptAuthTokens') { finish({ ok: false, reason: 'login-response-invalid' }); return; }
          responseOk = true;
          maybeSucceed();
        },
      });
      const unsubscribeUpdated = onNotification('account/updated', (params) => {
        if (settled) return;
        if (!params || typeof params !== 'object' || Array.isArray(params) || !isValidAccountUpdatedNotification(params)) { finish({ ok: false, reason: 'login-account-updated-schema-invalid' }); return; }
        if (!hasExactKeys(params, ['authMode', 'planType'].sort())) { finish({ ok: false, reason: 'login-account-updated-shape-invalid' }); return; }
        if (params.authMode !== null && !authModeValues.includes(params.authMode)) { finish({ ok: false, reason: 'login-account-updated-authmode-not-enum' }); return; }
        if (params.authMode !== 'chatgptAuthTokens') { finish({ ok: false, reason: 'login-conflicting-account-updated' }); return; }
        if (params.planType !== null && !planTypeValues.includes(params.planType)) { finish({ ok: false, reason: 'login-account-updated-plantype-not-enum' }); return; }
        if (
          params.planType !== null
          && credentials.chatgptPlanType !== null
          && params.planType !== credentials.chatgptPlanType
        ) {
          finish({ ok: false, reason: 'login-conflicting-plan-type' });
          return;
        }
        if (notifiedOk && params.planType !== observedPlanType) {
          finish({ ok: false, reason: 'login-conflicting-plan-type' });
          return;
        }
        observedPlanType = params.planType;
        notifiedOk = true; // duplicate identical notifications: idempotent, never a second rejection path.
        maybeSucceed();
      });
      writeJsonlFrame(stdin, {
        id,
        method: 'account/login/start',
        params: {
          type: 'chatgptAuthTokens',
          accessToken: credentials.accessToken,
          chatgptAccountId: credentials.chatgptAccountId,
          chatgptPlanType: credentials.chatgptPlanType,
        },
      }, (err) => {
        if (err) finish({ ok: false, reason: 'write-failed-confirmed-before-commit:' + String((err && err.message) || err) });
      });
    });
  }

  /**
   * Shared `ThreadStartResponse`/`ThreadResumeResponse` validator -- both
   * are structurally identical. Business rules that are NOT part of the
   * generic schema (exact required approvalPolicy/cwd-matching/sandbox
   * shape/thread identity/idle-vs-turn-count rules) run afterward, with
   * their own granular reason strings.
   */
  function validateThreadStartLikeResponse(frameRes, expectedCwd, reasonPrefix, respOpts) {
    if (!frameRes.ok) return { ok: false, reason: frameRes.reason || (reasonPrefix + '-error-response') };
    const r = frameRes.result;
    const isThreadResume = reasonPrefix === 'thread-resume';
    if (!r || typeof r !== 'object' || Array.isArray(r) || !isValidThreadStartOrResumeResponse(isThreadResume, r)) return { ok: false, reason: reasonPrefix + '-response-schema-invalid' };
    const thread = r.thread;
    if (r.approvalPolicy !== 'never' || r.approvalsReviewer !== 'user') return { ok: false, reason: reasonPrefix + '-wrong-approval-policy' };
    if (r.cwd !== expectedCwd) return { ok: false, reason: reasonPrefix + '-cwd-mismatch' };
    if (!r.sandbox || r.sandbox.type !== 'readOnly' || r.sandbox.networkAccess !== false) return { ok: false, reason: reasonPrefix + '-wrong-sandbox' };
    // instructionSources carries `default:[]` and is NOT required -- omitted
    // entirely is valid; only the EMPTINESS business rule is checked here.
    if (Object.prototype.hasOwnProperty.call(r, 'instructionSources') && r.instructionSources.length !== 0) return { ok: false, reason: reasonPrefix + '-nonempty-instruction-sources' };
    if (thread.cwd !== expectedCwd || thread.cwd !== r.cwd) return { ok: false, reason: reasonPrefix + '-thread-cwd-mismatch' };
    if (thread.modelProvider !== r.modelProvider) return { ok: false, reason: reasonPrefix + '-thread-provider-mismatch' };
    if (!thread.status || thread.status.type !== 'idle') return { ok: false, reason: reasonPrefix + '-thread-status-not-idle' };
    if (thread.ephemeral !== false) return { ok: false, reason: reasonPrefix + '-not-ephemeral-false' };
    if (respOpts && respOpts.requireNonEmptyTurns) {
      if (respOpts.expectedThreadId !== undefined && thread.id !== respOpts.expectedThreadId) return { ok: false, reason: reasonPrefix + '-thread-id-substitution' };
      if (!Array.isArray(thread.turns) || thread.turns.length === 0) return { ok: false, reason: reasonPrefix + '-zero-turn-resume-rejected' };
    } else {
      if (!Array.isArray(thread.turns) || thread.turns.length !== 0) return { ok: false, reason: reasonPrefix + '-not-idle' };
    }
    return { ok: true, threadId: thread.id };
  }

  /**
   * `thread/start` (PLAN.md ~L906-912, full validation ~L932). Returns
   * `{ok:true,threadId}` only after full `ThreadStartResponse` validation.
   */
  function threadStart(opts, timeoutOpts) {
    if (isTerminal()) return Promise.resolve({ ok: false, reason: 'connection-stopped' });
    if (state.getPhase() !== 'AUTHENTICATED') { terminalStop('thread-start-wrong-phase'); return Promise.resolve({ ok: false, reason: 'thread-start-wrong-phase' }); }
    // R14 (Bloque A): at most one active root-chain thread -- a second
    // thread/start (or thread/resume) while one is already PENDING or
    // ACTIVE is refused before ever dispatching.
    if (state.getThreadLifecycleState() !== 'IDLE') return Promise.resolve({ ok: false, reason: 'thread-lifecycle-busy' });
    state.setThreadLifecycleState('THREAD_START_PENDING');
    const id = state.allocateId();
    return dispatchRequest(id, 'thread/start', {
      approvalPolicy: 'never',
      approvalsReviewer: 'user',
      baseInstructions: opts.baseInstructions,
      config: null,
      cwd: opts.cwd,
      developerInstructions: opts.developerInstructions,
      ephemeral: false,
      model: null,
      modelProvider: null,
      personality: null,
      sandbox: null,
      serviceTier: null,
    }, timeoutOpts).then((frameRes) => {
      // finalizeStop unconditionally resets threadLifecycleState to IDLE on
      // EVERY STOP, so once terminal, frameRes.reason (or stopReason) is
      // ALREADY the most specific diagnostic available.
      if (isTerminal()) return { ok: false, reason: frameRes.reason || state.getStopReason() };
      if (state.getThreadLifecycleState() !== 'THREAD_START_PENDING') return { ok: false, reason: 'thread-start-lost-tracking' };
      const result = validateThreadStartLikeResponse(frameRes, opts.cwd, 'thread-start', {});
      if (!result.ok) { terminalStop('thread-start-invalid:' + result.reason); return result; }
      // Reusing an id this connection already told the server to retire
      // (archive) is not a silent, recoverable refusal -- STOP.
      if (result.threadId === state.getLastArchivedThreadId()) { terminalStop('thread-start-response-reuses-archived-id'); return { ok: false, reason: 'thread-start-response-reuses-archived-id' }; }
      state.setActiveThreadId(result.threadId);
      state.setThreadLifecycleState('ACTIVE');
      state.setCurrentTurn(null);
      state.retiredTurnIds.clear(); // a freshly-activated thread starts with a clean replay lineage.
      return result;
    });
  }

  /**
   * `thread/resume` (PLAN.md ~L913-918). The generated `ThreadResumeResponse`
   * is structurally identical to `ThreadStartResponse`, so validation reuses
   * the same helper. Does not itself retry or fall back to a fresh
   * `threadStart` -- that policy decision belongs to the caller.
   */
  function threadResume(opts, timeoutOpts) {
    if (isTerminal()) return Promise.resolve({ ok: false, reason: 'connection-stopped' });
    if (state.getPhase() !== 'AUTHENTICATED') { terminalStop('thread-resume-wrong-phase'); return Promise.resolve({ ok: false, reason: 'thread-resume-wrong-phase' }); }
    if (state.getThreadLifecycleState() !== 'IDLE') return Promise.resolve({ ok: false, reason: 'thread-lifecycle-busy' });
    // A soft, retriable pre-dispatch refusal must never escalate into a hard
    // STOP -- only a genuine POST-dispatch failure does.
    const preDispatchWindow = computeDispatchWindow(timeoutOpts);
    if (!preDispatchWindow.ok) return Promise.resolve({ ok: false, reason: preDispatchWindow.reason });
    state.setThreadLifecycleState('THREAD_RESUME_PENDING');
    state.setPendingThreadId(opts.threadId);
    const id = state.allocateId();
    return dispatchRequest(id, 'thread/resume', {
      threadId: opts.threadId,
      approvalPolicy: 'never',
      approvalsReviewer: 'user',
      baseInstructions: opts.baseInstructions,
      config: null,
      cwd: opts.cwd,
      developerInstructions: opts.developerInstructions,
      model: null,
      modelProvider: null,
      personality: null,
      sandbox: null,
      serviceTier: null,
    }, timeoutOpts).then((frameRes) => {
      if (isTerminal()) return { ok: false, reason: frameRes.reason || state.getStopReason() };
      if (state.getThreadLifecycleState() !== 'THREAD_RESUME_PENDING') return { ok: false, reason: 'thread-resume-lost-tracking' };
      const result = validateThreadStartLikeResponse(frameRes, opts.cwd, 'thread-resume', { requireNonEmptyTurns: true, expectedThreadId: opts.threadId });
      // ANY post-dispatch resume failure is a hard STOP -- a nested
      // same-thread continuation STOPs rather than silently substituting a
      // fresh thread/start's identity.
      if (!result.ok) { terminalStop('thread-resume-invalid:' + result.reason); return result; }
      if (result.threadId === state.getLastArchivedThreadId()) { terminalStop('thread-resume-response-reuses-archived-id'); return { ok: false, reason: 'thread-resume-response-reuses-archived-id' }; }
      state.setPendingThreadId(null);
      state.setActiveThreadId(result.threadId);
      state.setThreadLifecycleState('ACTIVE');
      state.setCurrentTurn(null);
      state.retiredTurnIds.clear();
      return result;
    });
  }

  /**
   * `turn/start` (PLAN.md ~L919-926, validation ~L932). `outputSchema` is
   * built internally from the canonical local schema via the Codex-only
   * closed wrapper projection -- a caller cannot inject an arbitrary schema.
   */
  function turnStart(opts, timeoutOpts) {
    if (isTerminal()) return Promise.resolve({ ok: false, reason: 'connection-stopped' });
    if (state.getPhase() !== 'AUTHENTICATED') { terminalStop('turn-start-wrong-phase'); return Promise.resolve({ ok: false, reason: 'turn-start-wrong-phase' }); }
    if (state.getThreadLifecycleState() !== 'ACTIVE' || state.getActiveThreadId() !== opts.threadId) { terminalStop('turn-start-thread-not-known'); return Promise.resolve({ ok: false, reason: 'turn-start-thread-not-known' }); }
    // A NEW turn may only start once the current one (if any) has reached
    // its one authoritative delivery.
    if (!isCurrentTurnSafelyTerminal()) { terminalStop('turn-start-already-in-flight-for-thread'); return Promise.resolve({ ok: false, reason: 'turn-start-already-in-flight-for-thread' }); }
    // Check the SAME window dispatchRequest itself will check, BEFORE
    // committing currentTurn -- a non-terminal, RETRIABLE refusal must never
    // permanently mark this thread in flight for a request never actually sent.
    const window = computeDispatchWindow(timeoutOpts);
    if (!window.ok) return Promise.resolve({ ok: false, reason: window.reason });
    const outputPurpose = opts.purpose === undefined ? 'normal' : opts.purpose;
    let outputSchema;
    try {
      outputSchema = codexStructuredRuntimeTurnEnvelopeSchema(
        opts.expectedResultKind, opts.allowedChildRoles, outputPurpose,
        opts.executionContext,
      );
    } catch (err) {
      const reason = 'turn-start-output-schema-projection-failed:' + String((err && err.message) || err);
      terminalStop(reason);
      return Promise.resolve({ ok: false, reason });
    }
    const id = state.allocateId();
    // C5: frame ID<->thread ID bound BEFORE the write. This is the ONE
    // current-turn record; responseObserved/completion/handlerEntry are its
    // three orthogonal delivery prerequisites.
    state.setCurrentTurn({
      turnId: null,
      responseObserved: false,
      completion: null,
      handlerEntry: null,
      startedObserved: false,
      refreshDeferralEpoch: null,
      state: 'IN_PROGRESS',
      turnStartRequestId: id,
      outputPurpose,
      backendDeadlineMs: timeoutOpts && typeof timeoutOpts.backendDeadlineMs === 'number'
        ? timeoutOpts.backendDeadlineMs : null,
      hydrationStarted: false,
    });
    return dispatchRequest(id, 'turn/start', {
      threadId: opts.threadId,
      input: [{ type: 'text', text: opts.inputText, text_elements: [] }],
      approvalPolicy: 'never',
      approvalsReviewer: 'user',
      cwd: opts.cwd,
      effort: null,
      model: null,
      outputSchema,
      personality: null,
      sandboxPolicy: null,
      serviceTier: null,
      summary: 'none',
    }, timeoutOpts).then((frameRes) => {
      const fail = (reason) => { terminalStop('turn-start-invalid:' + reason); return { ok: false, reason }; };
      if (isTerminal()) return { ok: false, reason: frameRes.reason || state.getStopReason() };
      const t = state.getCurrentTurn();
      if (!t) return fail('turn-start-lost-tracking'); // currentTurn is null and yet we are NOT terminal -- an invariant violation that should never legitimately occur.
      if (!frameRes.ok) return fail(frameRes.reason || 'turn-start-error-response');
      const r = frameRes.result;
      if (!r || typeof r !== 'object' || Array.isArray(r) || !isValidTurnStartResponse(r)) return fail('turn-start-response-schema-invalid');
      if (r.turn.id.length === 0) return fail('turn-start-empty-turn-id');
      if (t.state === 'DELIVERED') return fail('rpc-response-after-delivered');
      if (t.responseObserved) return fail('duplicate-rpc-response');
      // A `turn/started` notification may have already bound a DIFFERENT
      // turn id for this thread. The response can never silently SUBSTITUTE
      // a conflicting id as authority.
      const bind = bindOrVerifyCurrentTurnId(r.turn.id);
      if (!bind.ok) return fail(bind.retiredReplay ? 'turn-start-response-turn-id-replay-of-retired-id' : 'turn-start-response-conflicting-turn-id');
      // `responseObserved` is a REQUIRED third prerequisite for delivery.
      t.responseObserved = true;
      tryDeliverCurrentTurn();
      if (isTerminal()) return { ok: false, reason: state.getStopReason() }; // cap exhaustion or another STOP triggered by the delivery attempt above.
      return { ok: true, turnId: r.turn.id };
    });
  }

  /**
   * Registers the terminal handler for exactly one (threadId, turnId) pair.
   * Authority for a pair REQUIRES `threadLifecycleState === 'ACTIVE'` with
   * `activeThreadId === threadId` AND a live `currentTurn` record already
   * allocated by this connection's own `turnStart()` call -- never lazily
   * created by this function itself.
   */
  function onTurnCompleted(threadId, turnId, expectedResultKind, allowedChildRoles, handler, executionContext) {
    if (isTerminal()) return;
    if (state.getThreadLifecycleState() !== 'ACTIVE' || state.getActiveThreadId() !== threadId) return;
    const t = state.getCurrentTurn();
    if (!t) return; // no turn dispatched yet -- nothing to register against.
    if (t.state === 'DELIVERED') { terminalStop('handler-registration-after-delivered'); return; }
    if (t.state === 'INTERRUPT_PENDING' || t.state === 'INTERRUPTED') { terminalStop('handler-registration-after-interrupt'); return; }
    if (t.state === 'DEFERRED_FOR_REFRESH' || t.state === 'HYDRATION_PENDING') { terminalStop('second-handler-for-occupied-slot'); return; }
    if (t.handlerEntry !== null) { terminalStop('duplicate-turn-completed-handler-registration'); return; }
    const bind = bindOrVerifyCurrentTurnId(turnId);
    if (!bind.ok) { terminalStop((bind.retiredReplay ? 'turn-notification-turn-id-replay-of-retired-id:' : 'turn-notification-conflicting-turn-id:') + 'onTurnCompleted'); return; }
    t.handlerEntry = { expectedResultKind, allowedChildRoles, handler, executionContext };
    tryDeliverCurrentTurn();
  }

  /**
   * `turn/interrupt` -- exact `{threadId,turnId}` params. Interrupt REQUIRES
   * the turn to be genuinely accredited: `responseObserved===true` AND a
   * non-null `turnId` EXACTLY equal to the caller's. `state` flips to
   * `INTERRUPT_PENDING` IRREVOCABLY BEFORE the wire write.
   */
  function turnInterrupt(threadId, turnId, timeoutOpts) {
    if (isTerminal()) return Promise.resolve({ ok: false, reason: 'connection-stopped' });
    if (state.getPhase() !== 'AUTHENTICATED') { terminalStop('turn-interrupt-wrong-phase'); return Promise.resolve({ ok: false, reason: 'turn-interrupt-wrong-phase' }); }
    if (state.getThreadLifecycleState() !== 'ACTIVE' || state.getActiveThreadId() !== threadId) { terminalStop('turn-interrupt-thread-not-known'); return Promise.resolve({ ok: false, reason: 'turn-interrupt-thread-not-known' }); }
    const t = state.getCurrentTurn();
    if (!t || !t.responseObserved || t.turnId === null || t.turnId !== turnId) { terminalStop('turn-interrupt-turn-not-correlated'); return Promise.resolve({ ok: false, reason: 'turn-interrupt-turn-not-correlated' }); }
    if (t.state !== 'IN_PROGRESS' && t.state !== 'HYDRATION_PENDING' && t.state !== 'DEFERRED_FOR_REFRESH') { terminalStop('turn-interrupt-turn-not-interruptible'); return Promise.resolve({ ok: false, reason: 'turn-interrupt-turn-not-interruptible' }); }
    // Irrevocable from this exact point on -- BEFORE any wire byte is written.
    t.state = 'INTERRUPT_PENDING';
    const id = state.allocateId();
    return dispatchRequest(id, 'turn/interrupt', { threadId, turnId }, timeoutOpts).then((frameRes) => {
      if (isTerminal() && frameRes.ok) return { ok: false, reason: state.getStopReason() };
      if (!frameRes.ok) { const reason = frameRes.reason || 'turn-interrupt-error-response'; terminalStop('turn-interrupt-failed:' + reason); return { ok: false, reason }; }
      // TurnInterruptResponse is Record<string,never> -- the wrapper must
      // carry exactly an empty-object `result`.
      if (!frameRes.result || typeof frameRes.result !== 'object' || Array.isArray(frameRes.result) || !isValidTurnInterruptResponse(frameRes.result)) { terminalStop('turn-interrupt-result-schema-invalid'); return { ok: false, reason: 'turn-interrupt-result-schema-invalid' }; }
      if (!hasExactKeys(frameRes.result, [])) { terminalStop('turn-interrupt-result-not-empty-object'); return { ok: false, reason: 'turn-interrupt-result-not-empty-object' }; }
      // Successful interrupt: retire the turn id exactly once, then the
      // terminal INTERRUPTED state.
      if (!retireTurnId(t.turnId)) return { ok: false, reason: state.getStopReason() }; // cap exhaustion STOPs internally.
      t.state = 'INTERRUPTED';
      return { ok: true };
    });
  }

  /**
   * `thread/archive` -- exact `{threadId}` params. On success, clears the
   * single `threadLifecycleState`/`activeThreadId`/`currentTurn` record
   * wholesale.
   */
  function threadArchive(threadId, timeoutOpts) {
    if (isTerminal()) return Promise.resolve({ ok: false, reason: 'connection-stopped' });
    if (state.getPhase() !== 'AUTHENTICATED') { terminalStop('thread-archive-wrong-phase'); return Promise.resolve({ ok: false, reason: 'thread-archive-wrong-phase' }); }
    if (state.getThreadLifecycleState() !== 'ACTIVE' || state.getActiveThreadId() !== threadId) { terminalStop('thread-archive-thread-not-known'); return Promise.resolve({ ok: false, reason: 'thread-archive-thread-not-known' }); }
    // Never archive out from under a turn that has not yet fully delivered
    // -- refuse before ever touching the wire. Uses the WIDER
    // isCurrentTurnSafeToArchive -- a genuinely INTERRUPTED turn is also
    // safe to archive from.
    if (!isCurrentTurnSafeToArchive()) return Promise.resolve({ ok: false, reason: 'thread-archive-refused-turn-in-flight' });
    const id = state.allocateId();
    return dispatchRequest(id, 'thread/archive', { threadId }, timeoutOpts).then((frameRes) => {
      if (isTerminal()) return { ok: false, reason: frameRes.reason || state.getStopReason() };
      if (state.getThreadLifecycleState() !== 'ACTIVE' || state.getActiveThreadId() !== threadId) return { ok: false, reason: 'thread-archive-lost-tracking' }; // not terminal, yet the tracked thread changed underneath us -- an invariant violation that should never legitimately occur.
      if (!frameRes.ok) {
        const described = describeRpcError(frameRes.error);
        const reason = frameRes.reason
          || (described.length > 0 ? 'thread-archive-error-response ' + described : 'thread-archive-error-response');
        // A well-formed error RESPONSE means the transport is healthy and the
        // peer is speaking the protocol. When what it declines is "archive
        // this thread" because it has no such thread, the post-condition
        // already holds: clear this connection's own thread record exactly
        // as a successful archive does.
        if (frameRes.reason === undefined && isUnknownThreadArchiveError(frameRes.error)) {
          try {
            process.stderr.write('[app-server] archive declined for a thread the server does not know; '
              + 'treating as already archived: ' + reason + '\n');
          } catch (ignored) { /* diagnostics only */ }
          state.setLastArchivedThreadId(threadId);
          state.setActiveThreadId(null);
          state.setCurrentTurn(null);
          state.setThreadLifecycleState('IDLE');
          state.retiredTurnIds.clear();
          return { ok: true, unknownThread: true };
        }
        terminalStop('thread-archive-failed:' + reason);
        return { ok: false, reason };
      }
      // ThreadArchiveResponse is also Record<string,never>.
      if (!frameRes.result || typeof frameRes.result !== 'object' || Array.isArray(frameRes.result) || !isValidThreadArchiveResponse(frameRes.result)) { terminalStop('thread-archive-result-schema-invalid'); return { ok: false, reason: 'thread-archive-result-schema-invalid' }; }
      if (!hasExactKeys(frameRes.result, [])) { terminalStop('thread-archive-result-not-empty-object'); return { ok: false, reason: 'thread-archive-result-not-empty-object' }; }
      // Successful archive resets ALL active-thread state at once.
      state.setLastArchivedThreadId(threadId);
      state.setActiveThreadId(null);
      state.setCurrentTurn(null);
      state.setThreadLifecycleState('IDLE');
      state.retiredTurnIds.clear(); // a FUTURE thread/start reusing this same server-side id starts with a clean slate.
      return { ok: true };
    });
  }

  return Object.freeze({
    initialize, login, validateThreadStartLikeResponse, threadStart, threadResume,
    turnStart, onTurnCompleted, turnInterrupt, threadArchive,
  });
}

module.exports = Object.freeze({ createAppServerRpcMethods });
