'use strict';

// The session-run shutdown coordinator: SIGTERM/SIGINT/expiry -> bounded pre-engine stop timeline -> claim release/terminalize -> exactly-once terminal report.

function createSessionRunShutdownCoordinator({
  RC,
  SESSION_RUN_KILL_CONFIRM_TIMEOUT_MS,
  SESSION_RUN_TERM_CONFIRM_TIMEOUT_MS,
  classifyStopReasonRc,
  isTestCapability,
  raceAgainstBound,
  releaseAllClaimed,
  stopOwnedAppServerChildBounded,
  terminalizeSupervisorStartAction,
  timerState,
  trackSettlement,
}) {
/**
 * WP3 item C correction pass R2 (point 2): installed BEFORE the execution
 * claim is consumed (never after), so NO window exists where a signal falls
 * through to Node's default (no-cleanup) termination. `state.phase` is the
 * explicit pre-claim/post-claim/ready tracking this correction requires,
 * consulted here to decide what a signal actually needs to do:
 *
 * - PRE_CLAIM: the claim was never consumed -- it remains valid, and a
 *   FRESH session-run invocation could still legitimately use it. Nothing
 *   was claimed and nothing was terminalized; terminalizing here would
 *   incorrectly foreclose that retry. Exit cleanly with nothing to roll back.
 * - POST_CLAIM / READY: the claim is now PERMANENTLY burned (one-use). Both
 *   release whatever role-owners THIS invocation itself claimed (`claimed`,
 *   the SAME mutable array the acquisition loop pushes into, so a signal
 *   mid-loop rolls back only what was actually claimed) AND terminalize the
 *   WHOLE affected batch (point 2: never leave bindings stuck in
 *   STARTING/REHYDRATING referencing a now-dead action) -- both mandatory,
 *   identical handling for these two phases; `state.phase` stays distinct
 *   in the result envelope purely for observability.
 *
 * Returns the `shutdown` function itself so the owned-expiration timer
 * (point C.6) can invoke the identical path. M6 CORRECTION PASS (P1-2):
 * `shutdown` is now async -- it genuinely AWAITS the bounded child-stop
 * confirmation above before ever reporting a terminal envelope, so an
 * orphaned (SIGTERM-ignoring) child can never be reported as a clean
 * `'owned-shutdown'`.
 */
/**
 * P1-A (sequence123-codex-r129-binding.md section5): "signal, expiry, engine
 * error and public engine requestStop use the identical memoized Promise."
 * `engineBox` is a plain `{handle: null}` box cmdSessionRun creates BEFORE
 * claim acquisition and mutates SYNCHRONOUSLY (via startOwnedAppServerSupervisorEngine's
 * own onHandleReady hook, called before that factory's first await) the
 * instant the owned engine/coordinator exists -- so this SAME shutdown
 * function, registered on the process signal handlers once, before the
 * execution claim is ever consumed, transparently upgrades from the
 * pre-engine (PRE_CLAIM/POST_CLAIM-mid-acquisition) rollback path below to
 * the engine's own one-shared-stop-timeline path the instant one exists,
 * with no separate registration/window.
 */
/**
 * P1-A (sequence123-codex-r129-binding.md section5): "One private shutdown
 * coordinator is created by session-run before claim acquisition; it
 * retains state/claimed owners/action/owned handles. Signal, expiry, engine
 * error and public engine requestStop use the identical memoized Promise."
 *
 * This factory IS that coordinator. Called once, before the pre-engine
 * role-owner acquisition loop is ever started (cmdSessionRun's own
 * prologue), it registers the process signal handlers immediately -- before
 * the execution claim is ever consumed -- and exposes exactly:
 *   - requestStop(signal): the ONE memoized entry point every trigger
 *     (SIGTERM/SIGINT, scheduleStartupExpiration/scheduleOwnedExpiration's
 *     own 'EXPIRY', an engine-internal error via the injected `shutdown`,
 *     and -- once engineBox.handle exists -- the SAME public engine
 *     requestStop a direct caller might also invoke) resolves through.
 *     Repeated/concurrent calls, from ANY trigger, always return the exact
 *     SAME Promise (never undefined).
 *   - registerAcquisitionTask(promise): lets cmdSessionRun hand this
 *     coordinator the pre-engine role-owner acquisition loop's own Promise
 *     the instant it starts (before that loop's own first await), so a stop
 *     requested mid-acquisition genuinely joins it rather than racing it.
 *   - isAdmissionClosed(): the acquisition loop's own cancellation-cut
 *     check -- once true, it returns without admitting another claim.
 *
 * Never `process.exit()`: every terminal report sets `process.exitCode` and
 * returns, letting Node drain naturally once every owned handle (children,
 * timers) this SAME timeline already closed is genuinely gone -- a forced
 * exit could otherwise hide unfinished work the timeline itself was unable
 * to prove quiesced.
 */
function installShutdownHandlers(state, claimed, action, ownedChildRef, engineBox, sharedStopCache) {
  // P1-A / sequence144 correction (finding P1A-143-01): no local
  // stopPromiseCache of this coordinator's own -- sharedStopCache.promise
  // (created by cmdSessionRun, threaded into the engine too) is the ONE
  // physical memoization cell for the whole run, read/written by both this
  // coordinator's own requestStop AND the engine's own requestStop, so a
  // stop requested before the engine exists and later handed off to it
  // mid-join still resolves through the literal same Promise object as one
  // requested after the engine already existed.
  let acquisitionSettlement = trackSettlement(Promise.resolve());

  function registerAcquisitionTask(promise) {
    acquisitionSettlement = trackSettlement(promise);
  }
  function isAdmissionClosed() {
    // Deliberately keyed off this SAME invocation's own sharedStopCache
    // (created fresh per cmdSessionRun invocation -- never the module-shared
    // `shuttingDown` flag below, which -- like keepAliveHandle/expiryTimer/
    // startupExpiryTimer -- is process-lifetime shared state a LATER,
    // unrelated cmdSessionRun invocation in the same process must never
    // inherit as already-closed).
    return sharedStopCache.promise !== null;
  }
  function closeAdmissionTimers() {
    // Also flips the SAME module-shared `shuttingDown` flag several
    // pre-existing engine-internal call sites already gate on (e.g. the
    // raw-MCP owned-child post-stop pruning inside
    // runContextProviderInternalSearch, and every `shuttingDown ||
    // engineStopRequested` cooperative checkpoint) -- preserved exactly at
    // its prior t0 assignment point so none of that already-frozen
    // behavior shifts.
    timerState.markShuttingDown();
    timerState.clearKeepAliveHandle();
    timerState.clearExpiryTimer();
    timerState.clearStartupExpiryTimer();
    // P1-A (section5) / sequence142 correction: abandons whichever
    // test-only pause (PRE_CLAIM or acquisition) is currently in flight --
    // its own awaiting caller (cmdSessionRun's PRE_CLAIM prologue, or
    // runAcquisitionLoop) is ALREADY cooperatively abandoned by this SAME
    // stop, via isAdmissionClosed()/state.phase, so its own dormant
    // continuation resuming later is harmless -- but the raw setTimeout
    // handle itself must never keep the event loop open for its own
    // remaining duration after this coordinator has already finished and
    // set exitCode (finding P1A-AUDIT-01's natural-drain requirement).
    timerState.clearTestOnlyDelayTimer();
  }

  /**
   * The pre-engine (no owned engine ever registered for this run) half of
   * the shared timeline -- covers a signal/deadline arriving anywhere from
   * process start through the instant the role-owner acquisition loop
   * finishes (or is cooperatively cut). Genuinely joins the acquisition
   * task (bounded, matching stage2's own 12s ceiling) rather than racing
   * it, then -- if the engine was NOT registered while joining -- stops
   * whatever this run itself already owns and releases exactly what it
   * itself claimed.
   *
   * P1-A (section5) / sequence143 correction (finding P1A-142-02): the
   * bounded join's own settlement is tracked explicitly (trackSettlement,
   * attached to the SAME promise the coordinator was handed BEFORE its own
   * first await -- see cmdSessionRun's own registration site). If the
   * acquisition task has genuinely NOT settled once the bound elapses,
   * `claimed`/owned children may still be actively mutated by it this
   * exact instant -- reporting resource uncertainty and returning WITHOUT
   * touching either is the only honest outcome; releasing/cleaning here
   * would race the still-live task's own writes.
   */
  async function runPreEngineStopTimeline(internalReason) {
    await raceAgainstBound(acquisitionSettlement.promise.catch(() => {}), 12000);
    // The engine may have been registered WHILE we were joining (a
    // legitimate race: acquisition finished and handed off to the engine
    // just as stop was requested) -- delegate the REST of the timeline to
    // the engine's own actual stop-timeline work, never running two
    // independent cleanups for the same process. Its own returned result
    // already carries `reported: true` whenever it owns a real batch (see
    // runOwnedStopTimeline's own doc), so reportTerminal below correctly
    // skips reporting a second time on top of it.
    //
    // P1-A / sequence144 correction (finding P1A-143-01): calls the
    // engine's own runStopTimelineDirect, never its public requestStop --
    // by the time this coordinator ever reaches this await, sharedStopCache
    // .promise was ALREADY committed to THIS invocation's own manually-
    // resolvable promise (requestStop's own pre-engine branch, below,
    // assigns it synchronously before this whole async function is even
    // called). The engine's own requestStop checks that SAME cache first,
    // so calling it here would just hand back the very promise this
    // function is itself currently computing the value for -- a circular
    // self-reference Node detects and rejects. runStopTimelineDirect
    // performs the engine's real t0/stop-timeline work directly, without
    // consulting (or writing) sharedStopCache at all; ITS caller
    // (requestStop's own resolveShared callback, below) is the one and
    // only place that ever settles the shared Promise, so every external
    // observer -- through the coordinator OR through the engine's own
    // public requestStop, called at any later point -- still converges on
    // the literal same object.
    if (engineBox.handle) {
      return engineBox.handle.runStopTimelineDirect(internalReason);
    }
    if (!acquisitionSettlement.isSettled()) {
      return {
        stopped: false, escalated: false, firstStopReason: internalReason, resourceUncertain: true,
        receiptPath: null, receipt: null, phaseAtStop: state.phase, reported: false,
      };
    }
    let stopped = true;
    let escalated = false;
    const ownedChildren = (ownedChildRef && Array.isArray(ownedChildRef.children) && ownedChildRef.children.length > 0)
      ? ownedChildRef.children
      : (ownedChildRef && ownedChildRef.child ? [ownedChildRef.child] : []);
    for (const ownedChild of ownedChildren) {
      const r = await stopOwnedAppServerChildBounded(ownedChild, SESSION_RUN_TERM_CONFIRM_TIMEOUT_MS, SESSION_RUN_KILL_CONFIRM_TIMEOUT_MS);
      if (!r.stopped) stopped = false;
      if (r.escalated) escalated = true;
    }
    if (state.phase === 'PRE_CLAIM') {
      return {
        stopped, escalated, firstStopReason: internalReason, resourceUncertain: !stopped,
        receiptPath: null, receipt: null, phaseAtStop: 'PRE_CLAIM', reported: false,
      };
    }
    const claimsReleased = releaseAllClaimed(claimed);
    const termReason = (internalReason === 'EXPIRY' || internalReason === 'START_DEADLINE' || String(internalReason).indexOf('ACQUISITION_') === 0)
      ? 'deadline' : 'native-tool-error';
    const termResult = terminalizeSupervisorStartAction(action, termReason, 'startup-failure');
    const resourceUncertain = !stopped || !claimsReleased || !termResult.ok;
    return {
      stopped, escalated, firstStopReason: internalReason, resourceUncertain,
      receiptPath: null, receipt: null, phaseAtStop: state.phase, reported: false,
    };
  }

  /**
   * Exactly-once terminal reporting for the PRE-ENGINE path specifically.
   * P1-A (section5) / sequence143 correction (finding P1A-142-01): an
   * engine that owns a real batch (engine.ownsBatchLifecycle===true, every
   * real cmdSessionRun invocation) now reports its OWN terminal envelope
   * from inside runOwnedStopTimeline itself, marking its returned result
   * `reported:true` -- this function is skipped entirely whenever
   * stopResult.reported is already true (the "engine appeared mid-join"
   * delegation case above), guaranteeing exactly one coordinator-facing
   * report path end to end, never a double report.
   */
  function reportTerminal(signal, stopResult) {
    if (stopResult.reported) return;
    const phaseAtStop = stopResult.phaseAtStop || state.phase;
    const bare = String(stopResult.firstStopReason || '');
    let rc;
    let reasonOut;
    if (phaseAtStop === 'PRE_CLAIM') {
      rc = stopResult.stopped ? RC.OK : RC.CLEANUP_INTERNAL;
      reasonOut = stopResult.stopped ? 'pre-claim-shutdown' : 'child-stop-unconfirmed';
    } else if (bare.indexOf('ACQUISITION_') === 0) {
      // The pre-engine acquisition loop's own self-detected deadline/claim
      // conflict -- matches the pre-P1-A rejectAndExitAfterClaimConsumed's
      // own unconditional rc4 for both its callers (SUP-RDV-12/SUP-RDV-16),
      // now routed through this SAME shared timeline instead of a separate
      // process.exit call.
      rc = stopResult.resourceUncertain ? RC.CLEANUP_INTERNAL : RC.AUTH_ISOLATION;
      reasonOut = stopResult.resourceUncertain ? 'cleanup-failed' : bare;
    } else {
      const childStopConfirmed = stopResult.stopped;
      const confirmedCleanReason = stopResult.escalated ? 'owned-shutdown-forced' : 'owned-shutdown';
      if (!childStopConfirmed || stopResult.resourceUncertain) {
        rc = RC.CLEANUP_INTERNAL;
        reasonOut = childStopConfirmed ? 'cleanup-failed' : 'child-stop-unconfirmed';
      } else {
        rc = classifyStopReasonRc(bare, state.batchReady);
        reasonOut = rc === RC.OK ? confirmedCleanReason : bare;
      }
    }
    // P1-A (section5) / sequence143 correction (finding P1A-142-09): the
    // envelope object itself is frozen -- this exact reference is never
    // mutated by any later code, matching section5's own "closed frozen
    // value" requirement for the terminal report.
    const result = Object.freeze({
      schema: 'coordination/bridge-result/v1', command: 'session-run', ok: rc === RC.OK,
      action_id: action.action_id, reason: reasonOut, signal, phase: phaseAtStop,
    });
    process.stdout.write(JSON.stringify(result) + '\n');
    // P1-A (section5): "CLI emits its unchanged bridge-result/v1 envelope
    // derived from the coordinator and sets exitCode; it must drain
    // naturally, not use process.exit to hide unfinished work." Every owned
    // handle this SAME timeline is responsible for (children, timers) is
    // already genuinely closed (or truthfully reported as
    // resourceUncertain otherwise) by the time this runs.
    process.exitCode = rc;
  }

  function requestStop(signal) {
    if (sharedStopCache.promise) return sharedStopCache.promise;
    closeAdmissionTimers();
    const engineExists = !!engineBox.handle;
    // P1-A (section5): "Pass START_DEADLINE from the startup timer to
    // distinguish it from normal session expiry" -- scheduleStartupExpiration
    // and scheduleOwnedExpiration both raise the SAME outer 'EXPIRY' trigger
    // (preserved byte-for-byte in the terminal envelope's own "signal"
    // field, matching P1A-DEADLINE-PRESERVE-01/SUP-RDV-09's own frozen
    // pins -- runOwnedStopTimeline's own terminal reporting reverse-maps
    // 'START_DEADLINE' back to 'EXPIRY' for the SAME reason, see its own
    // doc), but internally -- for this coordinator's own sticky reason, the
    // durable receipt, and rc classification -- a pre-batchReady EXPIRY
    // observed once the engine already exists is this coordinator's OWN
    // engine-startup deadline (rc5), genuinely distinct from the SAME
    // external timer firing before the engine ever existed at all (an
    // acquisition-phase deadline, rc4 -- matches SUP-RDV-16's own frozen
    // pin) or from a genuine post-ready retained-session expiry (rc0).
    // scheduleStartupExpiration's own timer is ALWAYS cleared the instant
    // batchReady becomes true, so !state.batchReady is a reliable
    // discriminant at the exact moment this specific timer can ever fire.
    const internalReason = (signal === 'EXPIRY' && !state.batchReady)
      ? (engineExists ? 'START_DEADLINE' : 'ACQUISITION_DEADLINE_EXCEEDED')
      : signal;
    if (engineExists) {
      // P1-A (section5) / sequence144 correction (finding P1A-143-01): PURE
      // delegation -- the engine's own requestStop reads/writes the SAME
      // sharedStopCache.promise cell this coordinator does, so its return
      // value here IS already sharedStopCache.promise by the time control
      // returns (this assignment is therefore idempotent, never a second,
      // different write) -- never a `.then()` wrapper that would mint a
      // second, different identity for the same logical stop. The engine
      // itself (engine.ownsBatchLifecycle===true for every real
      // cmdSessionRun batch) owns printing the terminal envelope and
      // setting exitCode from inside its own runOwnedStopTimeline; this
      // coordinator has nothing further to do once it delegates.
      const enginePromise = engineBox.handle.requestStop(internalReason);
      sharedStopCache.promise = enginePromise;
      return enginePromise;
    }
    // P1-A / sequence144 correction (finding P1A-143-01): a manually
    // resolvable Promise, committed into sharedStopCache SYNCHRONOUSLY --
    // before the async pre-engine timeline (which may itself discover the
    // engine mid-join and hand off to it, above) ever runs a single await.
    // Every caller of THIS coordinator's own requestStop, from this exact
    // synchronous instant onward, receives this literal object; the
    // engine's own requestStop (once constructed) checks this SAME cache
    // first too, so a mid-handoff mid-flight construction still converges
    // on it rather than minting a second Promise. Settled exactly once,
    // by the one continuation below, with the real computed stopResult --
    // never re-wrapped, never a second identity.
    let resolveShared;
    const sharedPromise = new Promise((resolve) => { resolveShared = resolve; });
    sharedStopCache.promise = sharedPromise;
    runPreEngineStopTimeline(internalReason).then((stopResult) => {
      reportTerminal(signal, stopResult);
      resolveShared(stopResult);
    });
    return sharedPromise;
  }

  process.on('SIGTERM', () => { requestStop('SIGTERM'); });
  process.on('SIGINT', () => { requestStop('SIGINT'); });
  return { requestStop, registerAcquisitionTask, isAdmissionClosed };
}

  return Object.freeze({
    installShutdownHandlers,
  });
}

module.exports = Object.freeze({ createSessionRunShutdownCoordinator });
