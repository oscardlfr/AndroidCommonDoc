'use strict';

// session-run timer scheduling (owned-expiration, startup-lease backstop) and the shared stop-reason -> rc classifier.

function createSessionRunTimerScheduling({
  RC,
  isTestCapability,
  timerState,
}) {
/** Point C.6's "schedule owned expiration": auto-shutdown at session-expiry, even absent an external signal. */
function scheduleOwnedExpiration(shutdown, sessionExpiryMs) {
  const delay = Math.max(0, sessionExpiryMs - Date.now());
  timerState.setExpiryTimer(setTimeout(() => shutdown('EXPIRY'), delay));
}

/**
 * Schedules (or RESCHEDULES) the startup-phase backstop timer. Called TWICE over a real batch's
 * lifetime: once right after claim consumption (bound to actionExpiryMs, covering ONLY the
 * pre-READY role-owner acquisition loop), and once more right after acquisition genuinely
 * reaches READY (bound to the SEPARATE, bounded, derived post-claim startup lease -- see
 * SUPERVISOR_STARTUP_LEASE_CEILING_SECONDS / computeSupervisorStartupLeaseDeadlineMs). Clears any
 * existing timer first so the second call genuinely SUPERSEDES the first rather than leaving the
 * original, now-too-short deadline still armed in the background to fire early.
 */
function scheduleStartupExpiration(shutdown, deadlineMs) {
  timerState.clearStartupExpiryTimer();
  const delay = Math.max(0, deadlineMs - Date.now());
  timerState.setStartupExpiryTimer(setTimeout(() => shutdown('EXPIRY'), delay));
}

/**
 * Test-only synchronous pause between role claims. Grants no authority
 * (timing only), so a single `isTestCapability()` gate is enough -- unlike
 * the execution-claim/identity double-gated seams. Lets a bats test send a
 * real SIGTERM during a genuine multi-role acquisition window.
 */
function testAcquisitionDelayMs() {
  if (!isTestCapability()) return 0;
  const raw = process.env.RUNTIME_BRIDGE_CODEX_TEST_ACQUISITION_DELAY_MS;
  const parsed = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/**
 * SUPERVISOR_STARTUP_BUDGET correction (PLAN item 53/58, 2026-09-12). Test-only synchronous
 * pause at the START of each role's own post-claim startup iteration (runStartup, per role) --
 * same single-gate, timing-only convention as testAcquisitionDelayMs. Lets a bats test prove the
 * bounded post-claim startup lease genuinely tolerates real per-role work (spawn+initialize+
 * login+threadStart+bootstrap-turn) that exceeds the ORIGINAL action/claim ceiling, without ever
 * touching that ceiling -- the acquisition loop above (and TTL-02's claim-consumption check)
 * remain governed by actionExpiryMs exactly as before; this delay cannot even be reached until
 * AFTER that unchanged gate has already been satisfied.
 */
function testStartupDelayMs() {
  if (!isTestCapability()) return 0;
  const raw = process.env.RUNTIME_BRIDGE_CODEX_TEST_STARTUP_DELAY_MS;
  const parsed = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/**
 * SUPERVISOR_STARTUP_BUDGET correction: the bounded ceiling for the post-claim startup lease
 * (see computeSupervisorStartupLeaseDeadlineMs). 300s is well short of the retained session/
 * service authority this lease is derived from (SESSION_GENERATION_TTL_SECONDS /
 * SUPERVISOR_HOOK_MAIN_BINDING_TTL_SECONDS are both 3600s in runtime-role-lifecycle.cjs), and
 * comfortably covers the measured N13 baseline (155s for two sequential roles) with margin for
 * a single role's own worst case (BOOTSTRAP_TURN_TIMEOUT_MS=30s, doubled by one disposable
 * retry, plus spawn/initialize/login/threadStart overhead). Test-only override lets a bats test
 * prove the ceiling is a genuine bound (crossing it terminalizes the batch) without waiting out
 * five real minutes.
 */
const SUPERVISOR_STARTUP_LEASE_CEILING_SECONDS_DEFAULT = 300;
function supervisorStartupLeaseCeilingSeconds() {
  if (isTestCapability()) {
    const raw = process.env.RUNTIME_BRIDGE_CODEX_TEST_STARTUP_LEASE_CEILING_SECONDS;
    const parsed = raw ? parseInt(raw, 10) : NaN;
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return SUPERVISOR_STARTUP_LEASE_CEILING_SECONDS_DEFAULT;
}

/**
 * The ONE place the post-claim startup lease deadline is computed. Pure function of
 * (sessionExpiryMs, nowMs) -- exported test-only below for a fast, deterministic unit check of
 * the bound itself, independent of any real subprocess/timing. Never exceeds sessionExpiryMs
 * (the ALREADY-AUTHENTICATED retained session/service authority this lease is derived from,
 * itself validated at the top of cmdSessionRun before this is ever called), and never exceeds
 * nowMs + the bounded ceiling above -- so this can only ever SHRINK relative to a session nearing
 * its own end of life, never extend authority beyond what was already granted.
 */
function computeSupervisorStartupLeaseDeadlineMs(sessionExpiryMs, nowMs) {
  return Math.min(sessionExpiryMs, nowMs + supervisorStartupLeaseCeilingSeconds() * 1000);
}


/**
 * P1-A (section5) / sequence143 correction (finding P1A-142-01): hoisted to
 * module scope so BOTH the pre-engine coordinator (installShutdownHandlers)
 * and the owned engine's own runOwnedStopTimeline (which now owns terminal
 * reporting for a real, engine.ownsBatchLifecycle===true cmdSessionRun
 * batch -- see its own doc) share the exact SAME rc-mapping logic from ONE
 * source, never two independently-maintained copies. The exact functional
 * rc mapping section5's rc table freezes, keyed off the ONE stop timeline's
 * own sticky firstStopReason -- never re-derived per trigger.
 * Resource/publication uncertainty (the caller's own
 * stopResult.resourceUncertain) always overrides this with rc7,
 * independent of the functional reason. "all remaining engine
 * startup/transport/bootstrap/presence/batch errors... return6" is applied
 * for every reason not explicitly named in section5's own closed rc3/rc4
 * lists, but ONLY while genuinely pre-batchReady -- once the batch is
 * genuinely READY, ANY further stop (signal, retained-worker child loss,
 * transport loss) is an ordinary shutdown of an already-successful run,
 * never a "startup failure" code, matching "explicit SIGTERM/SIGINT/
 * default REQUEST_STOP with clean resources returns0 (shutdown only,
 * never READY proof)".
 */
function classifyStopReasonRc(stopReason, batchReady) {
  const bare = String(stopReason || '').split(':')[0];
  if (bare === 'EXPIRY' || bare === 'START_DEADLINE') return batchReady ? RC.OK : RC.TIMEOUT;
  if (batchReady) return RC.OK;
  if (bare === 'APP_SERVER_SPAWN_COMMAND_UNRESOLVED' || bare === 'APP_SERVER_ROLE_PROFILE_UNRESOLVED') {
    return RC.CAPABILITY_SCHEMA_DRIFT;
  }
  if (
    bare === 'APP_SERVER_LOGIN_FAILED' || bare === 'APP_SERVER_ROOT_PROVISION_FAILED'
    || bare === 'APP_SERVER_ROOT_FINALIZE_FAILED' || bare === 'APP_SERVER_READ_VIEW_ROOT_FAILED'
    || bare === 'APP_SERVER_READ_VIEW_HARDEN_FAILED' || bare === 'APP_SERVER_READ_VIEW_AUTHORITY_FAILED'
    || bare === 'APP_SERVER_HOST_CAPABILITY_FAILED'
  ) return RC.AUTH_ISOLATION;
  // Every remaining pre-batchReady APP_SERVER_ engine error (spawn,
  // transport, initialize, bootstrap, presence, batch-admission,
  // capability-mint -- section5's own closed "remaining... return6"
  // bucket, applied broadly here, never narrowed to a single named
  // example).
  if (bare.indexOf('APP_SERVER_') === 0) return RC.LIVE_CONFORMANCE_FAILURE;
  // Explicit SIGTERM/SIGINT/default REQUEST_STOP (or any other
  // cooperative, non-mapped stop reason) with clean resources: shutdown
  // only, never READY proof. An ACQUISITION_* reason (the pre-engine
  // loop's own self-detected deadline/claim-conflict) is never passed
  // here -- the pre-engine coordinator's own reporting maps it directly.
  return RC.OK;
}

  return Object.freeze({
    classifyStopReasonRc,
    computeSupervisorStartupLeaseDeadlineMs,
    scheduleOwnedExpiration,
    scheduleStartupExpiration,
    supervisorStartupLeaseCeilingSeconds,
    testAcquisitionDelayMs,
    testStartupDelayMs,
  });
}

module.exports = Object.freeze({ createSessionRunTimerScheduling });
