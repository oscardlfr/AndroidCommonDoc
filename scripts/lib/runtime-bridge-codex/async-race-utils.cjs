'use strict';

// Generic event-loop-yielding delay, bounded-race, settlement-tracking and deep-freeze primitives shared by the stop-timeline machinery.

function createAsyncRaceUtils({}) {
/**
 * WP3 item C correction pass R2 (point 2): a REAL, event-loop-yielding
 * delay -- never Atomics.wait, which blocks the event loop and would make a
 * "SIGTERM mid-acquisition" test vacuous. Node's signal delivery is
 * asynchronous via libuv (a normal event-loop callback like a timer), so it
 * literally cannot run while synchronous JS -- including a busy-spin -- is
 * executing; only a genuine await point lets the OS-delivered signal's
 * handler actually fire mid-loop.
 */
function asyncSleep(ms, onTimer) {
  if (!(ms > 0)) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    // P1-A (section5) / sequence142 correction (finding P1A-AUDIT-01): the
    // two TEST-ONLY callers below (see their own comments) capture this
    // exact timer via onTimer so the coordinator's own closeAdmissionTimers
    // (requestStop's t0) can clearTimeout it the instant a stop is
    // requested -- this specific timer carries no production meaning of
    // its own and must never be the reason natural process drain waits out
    // its own remaining duration after a stop has already fully completed
    // and exitCode is set. Simply unref-ing it instead would be WRONG: for
    // as long as this delay is genuinely still the ONLY reason the process
    // is alive (the normal, uninterrupted case a bats test relies on to
    // reliably land a signal within this exact window), an unref'd timer
    // would let Node exit the instant this call returns, before the real
    // delay the caller asked for ever elapses. Every OTHER
    // (production-meaningful) caller omits onTimer and keeps the existing
    // plain ref'd behavior unchanged.
    if (typeof onTimer === 'function') onTimer(timer);
  });
}

/**
 * P1-A (section5, findings P1A-AUDIT-01/06): the exact "stage ceiling" race
 * primitive every stop-timeline stage uses -- functionally identical to
 * `Promise.race([workPromise, asyncSleep(boundMs)])` (workPromise's own
 * resolved/rejected outcome wins if it settles first; otherwise the race
 * resolves once boundMs genuinely elapses), but GUARANTEES the bound's own
 * underlying setTimeout is cleared the instant workPromise wins. A bare
 * `Promise.race([..., asyncSleep(ms)])` never cancels the losing
 * asyncSleep's own timer -- harmless under the old process.exit()-terminated
 * shutdown (a forced exit ignores every pending handle), but under
 * process.exitCode's own required natural drain (finding P1A-AUDIT-01) a
 * genuinely fast, clean stage would otherwise still leave a live Timeout
 * pinning the event loop open for the REST of that stage's own ceiling
 * (12s/4s/etc) after every real handle has already, genuinely closed.
 */
function raceAgainstBound(workPromise, boundMs) {
  let timer;
  const bound = new Promise((resolve) => { timer = setTimeout(resolve, Math.max(0, boundMs)); });
  const guardedWork = workPromise.then(
    (value) => { clearTimeout(timer); return value; },
    (err) => { clearTimeout(timer); throw err; },
  );
  return Promise.race([guardedWork, bound]);
}

/**
 * P1-A (section5) / sequence143 correction (P1A-142-02/05): attaches an
 * UNCONDITIONAL settlement callback to `promise` immediately -- BEFORE any
 * bounded race involving it can ever be started -- and returns
 * `{promise, isSettled}`. `isSettled()` reflects genuine settlement
 * regardless of whether a LATER `raceAgainstBound` against this SAME
 * promise times out, so a caller can always distinguish "the real work
 * genuinely finished" from "the bound gave up while it was still live" --
 * never silently treating a race the bound won as if the underlying work
 * had actually quiesced.
 * @param {Promise<*>} promise
 * @returns {{promise: Promise<*>, isSettled: () => boolean}}
 */
function trackSettlement(promise) {
  let settled = false;
  promise.then(() => { settled = true; }, () => { settled = true; });
  return { promise, isSettled: () => settled };
}

/**
 * P1-A (section5) / sequence143 correction (finding P1A-142-09): "return
 * the same deeply closed receipt/result object on replay" -- recursively
 * freezes every plain-object/array field so no later code (this SAME
 * process's own, or a caller's) can ever mutate a receipt/result already
 * bound to a memoized Promise's own resolved value. Only descends into
 * plain objects and arrays -- a Buffer/Date/etc is left as whatever it
 * already is (freezing it is a harmless no-op for a primitive-backed
 * built-in, never attempted recursively into non-plain internals).
 */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item);
  } else if (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null) {
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

  return Object.freeze({
    asyncSleep,
    raceAgainstBound,
    trackSettlement,
    deepFreeze,
  });
}

module.exports = Object.freeze({ createAsyncRaceUtils });
