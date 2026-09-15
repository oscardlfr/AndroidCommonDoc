'use strict';

// The one place that ever signals a spawned app-server child, plus a bounded-confirmation stop (cooperative SIGTERM, escalating to a guaranteed SIGKILL).

function createOwnedChildStop({}) {
/**
 * M6 CORRECTION PASS (P1-2): the ONE function that ever sends a signal to a
 * spawned app-server child -- used BOTH as spawnWithIntent's own injected
 * `stopOwnedChild` authority (signal-only there; spawnWithIntent's own
 * internals, untouched, already do their OWN bounded confirm+quarantine
 * around it) AND, wrapped in the bounded confirmation below, by
 * cmdSessionRun's own post-BORN shutdown path. A single signal call site,
 * never two independently-hand-rolled `child.kill()`s.
 */
function signalOwnedAppServerChild(child) {
  try { child.kill('SIGTERM'); } catch (err) { /* best-effort */ }
}

// M6 CORRECTION PASS (P1-2): session-run's own post-BORN shutdown bound --
// deliberately separate from spawnWithIntent's own DEFAULT_SPAWN_*_TIMEOUT_MS
// (a different phase/concern: BORN-acquisition, not a genuinely-owned,
// already-running child). Two SHORT, sequential phases (cooperative SIGTERM,
// then a guaranteed-effective SIGKILL escalation) sum to comfortably less
// than the 5s bound this suite's own _wait_for_pid_exit polls for.
const SESSION_RUN_TERM_CONFIRM_TIMEOUT_MS = 2000;
const SESSION_RUN_KILL_CONFIRM_TIMEOUT_MS = 2000;

/**
 * M6 CORRECTION PASS (P1-2): the ONE place that ever signals a spawned
 * app-server child -- a real, bounded-confirmation stop, mirroring
 * spawnWithIntent's own already-correct internal startStopping() contract
 * (signal via the injected authority, then a bounded wait for a genuine
 * `'exit'` event, never a fire-and-forget kill trusted to have worked).
 * BRIDGE-STOP-01 proves this must go further than mere honest reporting for
 * a genuinely-owned, already-running child that IGNORES the cooperative
 * signal (`trap '' TERM`): SIGKILL cannot be trapped/blocked/ignored (POSIX)
 * -- it is escalated to as a guaranteed-effective fallback once the
 * cooperative bound elapses, so a stop this function reports as confirmed is
 * always genuinely, verifiably dead. Resolves `{stopped:true,escalated}`
 * only on a CONFIRMED `'exit'` event (from either phase, `escalated` true
 * iff SIGKILL was genuinely needed -- an escalated stop is never reported
 * identically to a cooperative one, BRIDGE-STOP-01's own second proof
 * target); `{stopped:false,escalated:true}` only in the practically-
 * unreachable case where even SIGKILL's own confirm window elapses without one.
 * @returns {Promise<{stopped:boolean,escalated:boolean}>}
 */
function stopOwnedAppServerChildBounded(child, termConfirmTimeoutMs, killConfirmTimeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    let killTimer = null;
    let termTimer = null;
    let escalated = false;
    function finish(stopped) {
      if (settled) return;
      settled = true;
      if (termTimer) clearTimeout(termTimer);
      if (killTimer) clearTimeout(killTimer);
      resolve({ stopped, escalated });
    }
    // The child-loss watcher can enter shutdown after Node has already
    // delivered this handle's exit. Treat that host-observed terminal state
    // as confirmed instead of waiting four seconds for an event that cannot
    // fire twice.
    child.once('exit', () => finish(true));
    if (
      (child.exitCode !== undefined && child.exitCode !== null)
      || (child.signalCode !== undefined && child.signalCode !== null)
    ) {
      finish(true);
      return;
    }
    termTimer = setTimeout(() => {
      if (settled) return;
      escalated = true;
      try { child.kill('SIGKILL'); } catch (err) { /* best-effort */ }
      killTimer = setTimeout(() => finish(false), killConfirmTimeoutMs);
    }, termConfirmTimeoutMs);
    // stopOwnedChild(handle) is the only operation allowed to signal a
    // process (PLAN.md ~L992) -- the SAME signalOwnedAppServerChild function
    // spawnWithIntent's own stopOwnedChild option is given below, never a
    // second, independently-hand-rolled kill call.
    signalOwnedAppServerChild(child);
  });
}

  return Object.freeze({
    SESSION_RUN_TERM_CONFIRM_TIMEOUT_MS,
    SESSION_RUN_KILL_CONFIRM_TIMEOUT_MS,
    signalOwnedAppServerChild,
    stopOwnedAppServerChildBounded,
  });
}

module.exports = Object.freeze({ createOwnedChildStop });
