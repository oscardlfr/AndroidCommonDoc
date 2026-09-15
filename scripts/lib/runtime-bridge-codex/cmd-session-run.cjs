'use strict';

// `session-run` CLI command controller: strict-order admission (identity -> action revalidation -> bindings -> confinement -> credentials -> singleton -> execution claim) then ordered role-owner acquisition and the owned app-server supervisor engine.

function createCmdSessionRun({
  CANONICAL_ROLES,
  RC,
  arraysEqual,
  asyncSleep,
  authError,
  canonicalJSONStringify,
  claimRoleOwner,
  computeCoordinationRootId,
  computeSupervisorStartupLeaseDeadlineMs,
  crypto,
  findExistingRoleOwner,
  installShutdownHandlers,
  isTestCapability,
  parseSessionRunArgv,
  path,
  publishNoClobber,
  requireProvenProcessIdentity,
  resolveRuntimeWaveActivation,
  resolveSessionRunCredentialSource,
  revalidateSupervisorStartAction,
  scheduleOwnedExpiration,
  scheduleStartupExpiration,
  sha256String,
  startOwnedAppServerSupervisorEngine,
  testAcquisitionDelayMs,
  timerState,
  usageError,
  validateAndConsumeExecutionClaim,
  validateBindingsPendThisAction,
  validateRootConfinement,
}) {
async function cmdSessionRun(rawArgv) {
  const parsed = parseSessionRunArgv(rawArgv);
  if (!parsed.ok) return usageError(parsed.reason);
  const p = parsed.value;

  if (p.testBackend !== null && (!isTestCapability() || p.testBackend !== 'deterministic-app-server-v1')) {
    process.stderr.write('[session-run] rejected: test-backend-not-permitted\n');
    process.exit(RC.CAPABILITY_SCHEMA_DRIFT);
  }

  const sessionExpiryMs = Date.parse(p.sessionExpiry);
  if (!Number.isFinite(sessionExpiryMs) || Date.now() >= sessionExpiryMs) {
    return authError('session-expiry-invalid-or-past');
  }

  if (p.roles.length === 0 || !p.roles.every((r) => CANONICAL_ROLES.includes(r))) {
    return usageError('role-not-canonical');
  }
  if (new Set(p.roles).size !== p.roles.length) return usageError('duplicate-role');
  if (!arraysEqual(p.roles, p.roles.slice().sort())) return usageError('roles-not-sorted');

  // 1. Point E hard gate: a provably-real process identity is required
  // before ANYTHING else that could consume the claim or write an owner.
  const identityResult = requireProvenProcessIdentity();
  if (!identityResult.ok) return authError(identityResult.reason);
  const pidIdentity = identityResult.pidIdentity;

  // 2. Read-only action revalidation.
  const revalidated = revalidateSupervisorStartAction(p, rawArgv);
  if (!revalidated.ok) return authError(revalidated.reason);
  const { action, coordinationRootReal, projectRoot } = revalidated;
  const actionExpiryMs = Date.parse(action.expires_at);
  const repoDescriptor = { repoId: action.repo_id };
  const waveActivation = resolveRuntimeWaveActivation(projectRoot, action.plan_digest);
  if (!waveActivation.ok) return authError(waveActivation.reason);

  // WP3 item C correction pass R2 (point 2): explicit pre-claim/post-claim/
  // ready state, and shutdown handlers installed HERE -- before the
  // execution claim is consumed, not after -- so no window exists where a
  // signal falls through to Node's default (no-cleanup) termination.
  // `claimed` is declared now (still empty) so the SAME array the
  // acquisition loop later pushes into is already the one the early-
  // installed handler closes over.
  const state = { phase: 'PRE_CLAIM', batchReady: false };
  const claimed = [];
  // Group A / C4 slice (2026-08-10, sub-item d): .children (array) tracks
  // every role's own owned app-server child; .child (legacy singular) is
  // kept in sync too for diagnostic/back-compat purposes only.
  const ownedChildRef = { child: null, children: [] };
  // P1-A (section5): "One private shutdown coordinator is created by
  // session-run before claim acquisition" -- engineBox is that coordinator's
  // own forward-reference: null until the owned engine actually exists
  // (startOwnedAppServerSupervisorEngine's own onHandleReady hook, below,
  // fills it in synchronously the instant it does), so this SAME shutdown
  // function -- registered on the process signal handlers now, before the
  // execution claim is ever consumed -- transparently upgrades to the
  // engine's own one-shared-stop-timeline the moment one exists.
  const engineBox = { handle: null };
  // P1-A / sequence144 correction (finding P1A-143-01): the ONE physical
  // memoization cell for this whole run's stop Promise -- created here,
  // before claim acquisition, alongside engineBox. Both installShutdownHandlers
  // (below) and startOwnedAppServerSupervisorEngine (once constructed) read
  // and write this SAME object's own `.promise` field; neither ever keeps a
  // second, independent cache of its own for a real cmdSessionRun batch --
  // see requestStop's own doc on both sides for exactly how identity is
  // preserved across the pre-engine-to-engine handoff race.
  const sharedStopCache = { promise: null };
  const coordinator = installShutdownHandlers(state, claimed, action, ownedChildRef, engineBox, sharedStopCache);

  // 3. Read-only binding-state check (point C.8 / E).
  const bindingsOk = validateBindingsPendThisAction(repoDescriptor, action, p.roles);
  if (!bindingsOk.ok) return authError(bindingsOk.reason);

  // 4. Read-only root confinement (point D) -- reuses the EXACT primitive
  // `root-validate` already uses, never a second weaker check.
  try {
    validateRootConfinement(coordinationRootReal);
  } catch (err) {
    return authError('coordination-root-confinement-failed: ' + ((err && err.message) || 'unknown'));
  }

  // Credentials are a read-only admission prerequisite, not evidence that a
  // worker is READY. Resolve them before the one-use execution claim is
  // consumed and before any owner/registry mutation, so an expired or absent
  // host credential leaves the action safely retryable after login instead
  // of retaining an initialized-but-unauthenticated child or publishing a
  // false READY batch.
  const credentialSource = resolveSessionRunCredentialSource(p.testBackend);
  if (!credentialSource.ok) {
    return authError('credential-source-unavailable:' + (credentialSource.reason || 'unknown'));
  }

  // 5. Point A singleton pre-check (read-only) -- BEFORE the claim is
  // consumed, so a conflict never burns the one-use claim on a request that
  // may simply need to wait for the existing supervisor to exit.
  const coordinationRootId = computeCoordinationRootId(coordinationRootReal);
  const existingOwner = findExistingRoleOwner(repoDescriptor, coordinationRootId);
  if (!existingOwner.ok) return authError(existingOwner.reason);
  if (existingOwner.found) return authError('singleton-supervisor-already-retained:' + existingOwner.role);

  if (Date.now() >= actionExpiryMs) return authError('action-expiry-elapsed-before-execution-claim');

  // Test-only real (event-loop-yielding) pause immediately before claim
  // consumption, so a bats test can deterministically deliver a genuine
  // SIGTERM while state.phase is still PRE_CLAIM -- proving that path never
  // terminalizes (the claim remains valid for a fresh retry). Same
  // isTestCapability() single-gate convention as testAcquisitionDelayMs.
  if (isTestCapability()) {
    const raw = process.env.RUNTIME_BRIDGE_CODEX_TEST_PRE_CLAIM_DELAY_MS;
    const delayMs = raw ? parseInt(raw, 10) : NaN;
    if (Number.isFinite(delayMs) && delayMs > 0) {
      // Deterministic test rendezvous: publish only after signal handlers and
      // every pre-claim read-only check are installed/completed, immediately
      // before yielding in the deliberate PRE_CLAIM delay. This replaces a
      // timing guess in SUP-RDV-15; it is unreachable without the existing
      // two-part test capability gate.
      const readyPath = process.env.RUNTIME_BRIDGE_CODEX_TEST_PRE_CLAIM_READY_FILE;
      if (typeof readyPath === 'string' && readyPath.length > 0) {
        if (!path.isAbsolute(readyPath) || Buffer.byteLength(readyPath, 'utf8') > 4096) {
          throw new Error('invalid PRE_CLAIM test rendezvous path');
        }
        publishNoClobber(readyPath, Buffer.from('ready\n', 'utf8'));
      }
      // Captures its own timer handle so a concurrent stop's own
      // closeAdmissionTimers can clearTimeout it instead of natural drain
      // ever waiting out its remaining duration once that stop has already
      // fully completed (see asyncSleep's own comment).
      await asyncSleep(delayMs, (timer) => { timerState.setTestOnlyDelayTimer(timer); });
    }
  }

  // Point D.1: expiry is re-validated immediately after the await above,
  // BEFORE the claim-consuming write below is even attempted -- time spent
  // awaiting can invalidate an earlier snapshot, and a write must never
  // proceed on a stale one. Cheaper AND safer than relying solely on the
  // claim's own downstream expiry check: state is still PRE_CLAIM here, so
  // rejection costs nothing to terminalize (the claim was never touched).
  if (Date.now() >= actionExpiryMs) {
    return authError('action-expiry-elapsed-before-execution-claim-write');
  }

  // 6. Execution claim -- the FIRST actual write, and the one that proves
  // this action was admitted for execution (point B). EVERY exit from this
  // point onward must terminalize the affected bindings (the claim can
  // never be reused).
  const argvDigest = sha256String(canonicalJSONStringify(action.payload.bridge_argv));
  const claimResult = validateAndConsumeExecutionClaim(repoDescriptor, action, argvDigest, projectRoot);
  if (!claimResult.ok) return authError(claimResult.reason);
  // The claim is now permanently burned -- from here on, ANY exit (signal,
  // deadline, owner conflict, partial failure) must terminalize the whole
  // batch. Flipped BEFORE the deadline re-check below so even that narrow
  // window is covered by the state a concurrent signal would observe.
  state.phase = 'POST_CLAIM';
  scheduleStartupExpiration(coordinator.requestStop, actionExpiryMs);

  // 7. ONE shared identity for this whole process (point C.1/C.7, already
  // proven in step 1), and ordered all-or-nothing role-owner acquisition
  // (point C.3) with shutdown handling already live since BEFORE claim
  // consumption (point 2) so a signal mid-loop rolls back cleanly. A
  // second, race-closing singleton check is implicit in the per-role
  // no-clobber claim itself combined with the earlier pre-check -- a
  // concurrent winner between the pre-check and this loop surfaces as an
  // ordinary (ambiguous-safe) claim failure below, handled via the
  // post-claim-consumed terminalization path. The standalone pre-loop
  // deadline check this comment used to precede is now runAcquisitionLoop's
  // own first synchronous action (below), so it is tracked by the SAME
  // coordinator.registerAcquisitionTask join as every other acquisition
  // step, rather than a direct, ungoverned process.exit-based rejection.
  const rendezvousInstanceId = crypto.randomBytes(16).toString('hex');
  const supervisorInstanceId = crypto.randomBytes(16).toString('hex');

  // P1-A (section5 / finding P1A-AUDIT-02): the pre-engine role-owner
  // acquisition loop is itself an admitted task this SAME coordinator
  // tracks and genuinely joins (never raced/silently abandoned) if a stop
  // is requested while it is still running -- registered via
  // coordinator.registerAcquisitionTask BEFORE this async function's own
  // first await, mirroring the engine's own startupTask registration. A
  // deadline crossing or claim conflict this loop detects itself never
  // calls process.exit directly; it requests a stop through the SAME
  // memoized coordinator (fire-and-forget, matching every other internal
  // trigger's own self-join avoidance -- see requestStop's own doc) and
  // returns, leaving state.phase at POST_CLAIM so the caller below knows
  // acquisition never reached READY and there is nothing further to admit.
  async function runAcquisitionLoop() {
    if (coordinator.isAdmissionClosed()) return;
    // Point D.1: the SAME re-validated-immediately-before-the-write
    // deadline check the standalone pre-loop guard used to perform, now
    // this loop's own first synchronous action.
    if (Date.now() >= actionExpiryMs) {
      void coordinator.requestStop('ACQUISITION_DEADLINE_EXCEEDED');
      return;
    }
    for (const role of p.roles) {
      // Test-only synchronous pause BETWEEN claims so a bats test can
      // reliably deliver a REAL SIGTERM mid-acquisition (never a
      // substitute via an owner conflict) -- grants no authority, so a
      // single test-capability gate is sufficient (see
      // testAcquisitionDelayMs).
      // Deliberately unref'd here (never captured into testOnlyDelayTimer
      // the way the PRE_CLAIM delay above is): this loop's own very next
      // statement is the coordinator.isAdmissionClosed() cooperative check
      // below, which depends on this exact timer genuinely firing (even
      // after a concurrent stop) so the loop can observe the closed
      // admission and return promptly -- clearTimeout-ing it the way
      // closeAdmissionTimers treats the PRE_CLAIM delay would instead hang
      // this loop (and therefore the stop timeline's own join of it)
      // forever. Safe to unref unconditionally: by this point in
      // cmdSessionRun (POST_CLAIM), scheduleStartupExpiration has already
      // installed the real, ref'd startupExpiryTimer, so this specific
      // timer is never the sole reason the process is alive either way --
      // it still fires at its own genuine scheduled time regardless, this
      // only stops it from ALSO independently pinning natural drain open
      // for its own remaining duration once a stop has already finished
      // (this value is always 0 in production, isTestCapability()-gated,
      // so this only ever matters for a bats test's own deterministic
      // mid-acquisition signal timing).
      if (claimed.length > 0) await asyncSleep(testAcquisitionDelayMs(), (timer) => { timer.unref(); });
      if (coordinator.isAdmissionClosed()) return;
      // Point D.1: expiry is re-validated AFTER the await, immediately
      // before the WRITE it guards -- never merely before it. A pre-await
      // snapshot can be invalidated by time spent awaiting; the write must
      // always act on a freshly-rechecked deadline, on every iteration
      // (trivially satisfied on the first, which has nothing to await
      // yet).
      if (Date.now() >= actionExpiryMs) {
        void coordinator.requestStop('ACQUISITION_DEADLINE_EXCEEDED');
        return;
      }
      const claim = claimRoleOwner(repoDescriptor, coordinationRootId, role, rendezvousInstanceId, supervisorInstanceId, pidIdentity);
      if (!claim.ok) {
        void coordinator.requestStop('ACQUISITION_CLAIM_FAILED');
        return;
      }
      claimed.push(claim);
    }
    // Fully acquired -- the state VALUE itself distinguishes this from
    // POST_CLAIM purely for observability; shutdown handling treats both
    // identically (see runPreEngineStopTimeline).
    state.phase = 'READY';
  }

  // P1-A (section5) / sequence143 correction (finding P1A-142-02): the
  // task is registered with the coordinator BEFORE runAcquisitionLoop's
  // own body can execute a single statement, not merely before its first
  // await -- `Promise.resolve().then(...)` always defers its callback to
  // a fresh microtask, even though the source promise is already
  // resolved, so `acquisitionPromise` here is assigned a genuinely
  // PENDING Promise synchronously and handed to the coordinator BEFORE
  // runAcquisitionLoop itself (including its own first, un-awaited
  // claimRoleOwner call for a single-role or first-role claim) ever runs.
  // Without this, a same-tick synchronous burst (no await before the
  // first claim, since `claimed.length > 0` is false on the first
  // iteration) could in principle claim an owner before the coordinator
  // even knows this task exists.
  const acquisitionPromise = Promise.resolve().then(() => runAcquisitionLoop());
  coordinator.registerAcquisitionTask(acquisitionPromise);
  await acquisitionPromise;
  // A concurrent stop (signal/deadline/claim-conflict) already requested
  // and is running/ran through the SAME memoized coordinator, which itself
  // joined this exact acquisitionPromise before releasing whatever this
  // invocation had claimed -- nothing further for this real invocation to
  // admit or start.
  if (state.phase !== 'READY') return;

  // SUPERVISOR_STARTUP_BUDGET correction (PLAN item 53/58, 2026-09-12): from this exact line
  // onward, the one-use execution claim has ALREADY been consumed and every role owner has
  // ALREADY been durably, atomically (no-clobber) claimed -- both still gated above by the
  // ORIGINAL, UNCHANGED actionExpiryMs bound (min(ready_timeout_seconds, 120s)). A tampered or
  // replayed action can never reach this line: it would first have to re-pass claim consumption
  // (TTL-02) and full role-owner acquisition (SUP-RDV-16/START-DEADLINE-01) under that same short
  // window, neither of which this correction touches. Only now does the post-claim app-server
  // startup pipeline (spawn+initialize+login+threadStart+a REAL bootstrap model turn, per role --
  // network+inference bound, unlike the local admin actions actionExpiryMs was sized for) get its
  // OWN bounded deadline, derived from the ALREADY-AUTHENTICATED retained session/service
  // authority rather than by widening actionExpiryMs itself -- which is exactly what item 40's
  // reverted correction did wrong, and exactly what TTL-02 requires stay short.
  const startupDeadlineMs = computeSupervisorStartupLeaseDeadlineMs(sessionExpiryMs, Date.now());
  scheduleStartupExpiration(coordinator.requestStop, startupDeadlineMs);

  scheduleOwnedExpiration(coordinator.requestStop, sessionExpiryMs);

  const handle = startOwnedAppServerSupervisorEngine({
    p, repoDescriptor, action, coordinationRootReal, projectRoot,
    pidIdentity, credentialSource, rendezvousInstanceId, supervisorInstanceId,
    ownedChildRef, state, shutdown: coordinator.requestStop, startupDeadlineMs, sessionExpiryMs, waveActivation,
    onHandleReady: (readyHandle) => { engineBox.handle = readyHandle; },
    // P1-A / sequence144 correction (finding P1A-143-01): the SAME physical
    // cache cell the coordinator itself reads/writes -- see its own creation
    // comment above. Never set by a direct-engine test harness (which
    // constructs no coordinator at all), matching ownsBatchLifecycle's own
    // established real-batch-only convention.
    sharedStopCache,
    // P1-A: this is the SAME action this real process's own pre-engine
    // acquisition loop already claimed -- the coordinator's own stop
    // timeline may safely terminalize it. Never set by a direct-engine test
    // harness (see runOwnedStopTimeline's own comment on this flag).
    ownsBatchLifecycle: true,
  });
  await handle.readyPromise.catch(() => {});
}

  return Object.freeze({
    cmdSessionRun,
  });
}

module.exports = Object.freeze({ createCmdSessionRun });
