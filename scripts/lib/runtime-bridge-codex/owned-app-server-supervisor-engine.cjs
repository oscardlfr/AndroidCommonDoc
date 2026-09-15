'use strict';

// Synchronous start/factory for the owned-app-server supervisor engine: composes the 9 sequence 5-10 supervisor sub-modules, runs the per-role startup pipeline, then the retained-worker poll loop.

function createOwnedAppServerSupervisorEngine({
  BOOTSTRAP_ARCHIVE_TIMEOUT_MS,
  BOOTSTRAP_TURN_TIMEOUT_MS,
  ISOLATED_PATH_POSIX,
  RC,
  REGISTRY_RECORD_MAX_BYTES,
  RETAINED_WORKER_HEARTBEAT_INTERVAL_MS,
  RETAINED_WORKER_POLL_INTERVAL_MS,
  SESSION_RUN_KILL_CONFIRM_TIMEOUT_MS,
  SESSION_RUN_TERM_CONFIRM_TIMEOUT_MS,
  SUPERVISOR_BASE_INSTRUCTIONS,
  SUPERVISOR_BOOTSTRAP_DEVELOPER_INSTRUCTIONS,
  asyncSleep,
  canonicalJSONStringify,
  captureRegistryTailText,
  classifyStopReasonRc,
  collectPendingMixedReviewRequest,
  computeCoordinationRootId,
  createAppServerConnection,
  createCaptureRegistry,
  createIsolationProvider,
  createSessionRunReadViewAuthority,
  createSupervisorEngineState,
  createSupervisorLedgerCleanup,
  createSupervisorOwnedChildRegistry,
  createSupervisorRetainedPolling,
  createSupervisorRoleBootstrap,
  createSupervisorStartupPreflight,
  ensureSecureRegistryDir,
  createSupervisorStopReceipt,
  createSupervisorStopRequest,
  createSupervisorStopTimeline,
  createSupervisorWorkerSpawn,
  crypto,
  deepFreeze,
  describeBornProvenanceFailure,
  describeInitializeFailure,
  describeOwnedChildExit,
  describeOwnedChildState,
  describeThreadStartFailure,
  executeP2RetainedArchitectReview,
  executeRetainedWorkerRequest,
  fs,
  isHexActionId,
  loadP2CompletedRootReviewContext,
  path,
  publishBridgeRegistryRecord,
  publishWorkerPresenceReady,
  raceAgainstBound,
  rc,
  readDurableRegistryRecordFd,
  readRoleBindingState,
  realpathOrSelf,
  reapTombstonedRoot,
  registryRepoDir,
  releaseOwnedRoleOwner,
  replaceOwnedWorkerPresence,
  resolveCanonicalRoleProfile,
  resolveSessionRunBornProvenance,
  resolveSessionRunCredentialSource,
  resolveSessionRunSpawnCommand,
  retainedSessionGenerationStatus,
  roleOwnerPathFor,
  roleProfileDigestFor,
  signalOwnedAppServerChild,
  spawn,
  spawnWithIntent,
  startDeterministicMcpLoopbackServer,
  stopOwnedAppServerChildBounded,
  strictConfigValidatorForSessionRun,
  terminalizeSupervisorStartAction,
  testStartupDelayMs,
  timerState,
  transitionSupervisorBatchToReady,
  waitForValidatedTurnCompletion,
}) {

function startOwnedAppServerSupervisorEngine(engine) {
  const {
    p, repoDescriptor, action, coordinationRootReal, projectRoot,
    pidIdentity, credentialSource, rendezvousInstanceId, supervisorInstanceId,
    ownedChildRef, state, shutdown: injectedShutdown, startupDeadlineMs, sessionExpiryMs, waveActivation,
  } = engine;

  const engineState = createSupervisorEngineState({ getBatchReady: () => state.batchReady, ownedChildRef });

  const supervisorLedgerCleanup = createSupervisorLedgerCleanup({
    path, repoDescriptor, rendezvousInstanceId, registryRepoDir,
    readDurableRegistryRecordFd, REGISTRY_RECORD_MAX_BYTES, sha256Buffer: rc.sha256Buffer,
    getIsolationProvider: () => engineState.getIsolationProvider(), fs, reapTombstonedRoot,
  });
  const { cleanupLedgerRoot, preservedLedgerRootReceipt } = supervisorLedgerCleanup;

  const stopReceipt = createSupervisorStopReceipt({
    fs, path, registryRepoDir, publishBridgeRegistryRecord, canonicalJSONStringify, deepFreeze,
    RC, classifyStopReasonRc,
  });

  // performT0AndRunTimeline's own defensive t0 clearing of the SAME
  // module-shared startup/session-expiry timers the outer coordinator's own
  // requestStop already closes -- this handle's own requestStop can also be
  // reached directly, so a stale timer from either path is never left free
  // to fire later against an already-stopping/already-stopped run. Stage3
  // of the stop timeline clears keepAliveHandle again (idempotent).
  const clearKeepAliveHandle = () => { timerState.clearKeepAliveHandle(); };
  const clearEngineTimers = () => {
    clearKeepAliveHandle();
    timerState.clearExpiryTimer();
    timerState.clearStartupExpiryTimer();
  };

  const stopTimeline = createSupervisorStopTimeline({
    ledger: engineState.ledger, retainedWorkers: engineState.retainedWorkers, observerJobs: engineState.observerJobs,
    pendingRawMcpPromises: engineState.pendingRawMcpPromises, bornVerificationPending: engineState.bornVerificationPending,
    getPollInFlight: engineState.getPollInFlight, getPollTicketPromise: engineState.getPollTicketPromise,
    getDeterministicMcpControl: engineState.getDeterministicMcpControl,
    getAdmissionClosed: engineState.getAdmissionClosed, getStartupJoinSettled: engineState.getStartupJoinSettled,
    setStartupJoinSettled: engineState.setStartupJoinSettled, getFirstStopReason: engineState.getFirstStopReason,
    clearKeepAliveHandle, getStartupTask: () => startupTask, ownedChildrenSnapshot: engineState.ownedChildrenSnapshot,
    cleanupLedgerRoot, preservedLedgerRootReceipt,
    stopOwnedAppServerChildBounded, sessionRunTermConfirmTimeoutMs: SESSION_RUN_TERM_CONFIRM_TIMEOUT_MS,
    sessionRunKillConfirmTimeoutMs: SESSION_RUN_KILL_CONFIRM_TIMEOUT_MS, raceAgainstBound, asyncSleep,
    p, repoDescriptor, coordinationRootReal, rendezvousInstanceId, supervisorInstanceId, pidIdentity, action,
    computeCoordinationRootId, roleOwnerPathFor, releaseOwnedRoleOwner, terminalizeSupervisorStartAction,
    getBatchReady: () => state.batchReady, getPhase: () => state.phase, ownsBatchLifecycle: engine.ownsBatchLifecycle === true,
    buildAndPublishStopReceipt: stopReceipt.buildAndPublishStopReceipt,
  });

  const stopRequest = createSupervisorStopRequest({
    engine, injectedShutdown, settleReadyOnStartupFailure: engineState.settleReadyOnStartupFailure,
    getEngineStopRequested: engineState.getEngineStopRequested, setEngineStopRequested: engineState.setEngineStopRequested,
    getStopPromiseCache: engineState.getStopPromiseCache, setStopPromiseCache: engineState.setStopPromiseCache,
    setAdmissionClosed: engineState.setAdmissionClosed, setFirstStopReasonIfUnset: engineState.setFirstStopReasonIfUnset,
    getDeterministicMcpControl: engineState.getDeterministicMcpControl, resolveStopSignal: engineState.resolveStopSignal,
    clearEngineTimers, runOwnedStopTimeline: stopTimeline.runOwnedStopTimeline,
  });
  const { shutdown, requestStop, runStopTimelineDirect } = stopRequest;
  const isShuttingDown = () => timerState.isShuttingDown();

  const startupPreflight = createSupervisorStartupPreflight({
    createSessionRunReadViewAuthority, createIsolationProvider, strictConfigValidatorForSessionRun,
    createSupervisorOwnedChildRegistry, createCaptureRegistry, resolveSessionRunSpawnCommand,
    shutdown, projectRoot, ledger: engineState.ledger, ensureSecureRegistryDir,
  });
  const workerSpawn = createSupervisorWorkerSpawn({
    spawn, spawnWithIntent, signalOwnedAppServerChild, resolveSessionRunBornProvenance, realpathOrSelf,
    publishBridgeRegistryRecord, canonicalJSONStringify, registryRepoDir, describeBornProvenanceFailure,
    describeOwnedChildState, describeOwnedChildExit, captureRegistryTailText, path, crypto,
    isolatedPathPosix: ISOLATED_PATH_POSIX, shutdown, isShuttingDown, getEngineStopRequested: engineState.getEngineStopRequested,
    bornVerificationPending: engineState.bornVerificationPending, ownedChildRef, observerJobs: engineState.observerJobs,
  });
  const roleBootstrap = createSupervisorRoleBootstrap({
    createAppServerConnection, resolveSessionRunCredentialSource, resolveCanonicalRoleProfile,
    supervisorBootstrapDeveloperInstructions: SUPERVISOR_BOOTSTRAP_DEVELOPER_INSTRUCTIONS,
    supervisorBaseInstructions: SUPERVISOR_BASE_INSTRUCTIONS,
    bootstrapTurnTimeoutMs: BOOTSTRAP_TURN_TIMEOUT_MS, bootstrapArchiveTimeoutMs: BOOTSTRAP_ARCHIVE_TIMEOUT_MS,
    waitForValidatedTurnCompletion, describeThreadStartFailure, describeInitializeFailure, captureRegistryTailText,
    publishWorkerPresenceReady, roleProfileDigestFor,
    isShuttingDown, getEngineStopRequested: engineState.getEngineStopRequested,
    settleReadyOnStartupFailure: engineState.settleReadyOnStartupFailure, shutdown, fs,
  });
  const retainedPolling = createSupervisorRetainedPolling({
    sessionExpiryMs, action, retainedSessionGenerationStatus, shutdown, isShuttingDown,
    getEngineStopRequested: engineState.getEngineStopRequested,
    getPollInFlight: engineState.getPollInFlight, setPollInFlight: engineState.setPollInFlight,
    pendingRawMcpPromises: engineState.pendingRawMcpPromises, retainedWorkers: engineState.retainedWorkers,
    repoDescriptor, coordinationRootReal, rc, loadP2CompletedRootReviewContext, executeP2RetainedArchitectReview,
    collectPendingMixedReviewRequest, executeRetainedWorkerRequest, replaceOwnedWorkerPresence,
    retainedWorkerHeartbeatIntervalMs: RETAINED_WORKER_HEARTBEAT_INTERVAL_MS, asyncSleep,
  });
  const { pollRetainedWorkers, workerFailureSignal } = retainedPolling;

  async function runStartup() {
    const readyEvidence = [];
    const preflightCtx = startupPreflight.buildStartupContext(p.testBackend);
    if (!preflightCtx.ok) return;
    const { readViewAuthority, isolationProvider, childRegistry, stderrCapture, spawnCommand } = preflightCtx;
    engineState.setIsolationProvider(isolationProvider);

    // Group A / C4 slice: one isolated app-server child/connection/root/
    // thread now exists for EVERY role in p.roles (PLAN.md ~L911: "never
    // one child per request") -- the shared isolationProvider/spawnCommand/
    // credentialSource above are reused across roles; each role below mints
    // its OWN fresh instanceId and its OWN root/child/connection/thread.
    for (const role of p.roles) {
      if (isShuttingDown() || engineState.getEngineStopRequested() || Date.now() >= startupDeadlineMs) {
        engineState.settleReadyOnStartupFailure('startup-abandoned-at-checkpoint');
        return;
      }
      // Test-only, timing-only pause, re-checked against startupDeadlineMs
      // immediately below exactly like every other checkpoint in this loop.
      if (testStartupDelayMs() > 0) await asyncSleep(testStartupDelayMs(), (timer) => { timer.unref(); });
      if (isShuttingDown() || engineState.getEngineStopRequested() || Date.now() >= startupDeadlineMs) {
        engineState.settleReadyOnStartupFailure('startup-abandoned-at-checkpoint');
        return;
      }
      const roleInstanceId = crypto.randomBytes(16).toString('hex');
      const provisioned = startupPreflight.provisionRoleRoot({
        role, roleInstanceId, repoDescriptor, rendezvousInstanceId, pidIdentity, isolationProvider, readViewAuthority, fs, path,
      });
      if (!provisioned.ok) return;
      const { roleReadCapability, createRootResult, rootHandle, ledgerEntry, readViewRoot, rootIdentityForSpawn } = provisioned;

      const spawned = await workerSpawn.spawnRoleWorker({
        roleInstanceId, repoDescriptor, rendezvousInstanceId, testBackend: p.testBackend, spawnCommand,
        createRootResult, rootIdentityForSpawn, stderrCapture, ledgerEntry, startupDeadlineMs, childRegistry,
      });
      if (!spawned.ok) return;

      // The ONE cooperative-abandonment checkpoint for this whole BORN
      // sequence, deliberately placed HERE -- strictly AFTER the ledger
      // already durably carries spawnState/child/bornRecord, and strictly
      // BEFORE the pointless extra work of initializing a connection this
      // run is about to tear down anyway.
      if (isShuttingDown() || engineState.getEngineStopRequested() || Date.now() >= startupDeadlineMs) {
        engineState.settleReadyOnStartupFailure('startup-abandoned-at-checkpoint');
        return;
      }

      const bootstrapped = await roleBootstrap.bootstrapRoleWorker({
        role, roleInstanceId, testBackend: p.testBackend, createRootResult, isolationProvider, rootHandle,
        roleReadCapability, readViewRoot, credentialSource, startupDeadlineMs, action, projectRoot,
        supervisorInstanceId, rendezvousInstanceId, waveActivation, coordinationRootReal, repoDescriptor,
        childRegistry, ownedChildRef, stopSignal: engineState.stopSignal, registerRawMcpPromise: engineState.registerRawMcpPromise,
        hasPendingRawMcpPromise: () => engineState.pendingRawMcpPromises.size > 0,
        child: spawned.child, bornRecord: spawned.bornRecord, stderrCapture, p,
      });
      if (!bootstrapped.ok) return;
      engineState.retainedWorkers.push(bootstrapped.retainedWorkerRecord);
      readyEvidence.push(bootstrapped.readyEvidenceEntry);
    }

    // readyPromise's own documented resolution predicate --
    // "BORN+INITIALIZED+LOGIN+THREAD_START+bootstrap-READY+root-finalized...
    // every worker's HostBridgeCapability has been minted" -- is reached
    // HERE for a direct-engine test fixture; a REAL cmdSessionRun batch
    // defers resolveReady past BOTH the registry-level batch-ready
    // transition AND the per-worker capability mint immediately below.
    if (engine.ownsBatchLifecycle !== true) engineState.resolveReady();

    // The ONE atomic admission of this action's COMPLETE batched role set
    // from STARTING/REHYDRATING to READY -- reached here only once EVERY
    // role in p.roles has completed its own loop iteration above without
    // triggering shutdown.
    const batchReadyResult = transitionSupervisorBatchToReady(
      repoDescriptor, action, p.roles, readyEvidence, pidIdentity,
    );
    if (!batchReadyResult.ok) {
      shutdown('APP_SERVER_BATCH_READY_TRANSITION_FAILED:' + (batchReadyResult.reason || 'unknown'));
      return;
    }
    state.batchReady = true;
    timerState.clearStartupExpiryTimer();

    // Mint each opaque HostBridgeCapability only after the complete role
    // batch is READY and its worker presence is durable. The factory
    // independently proves that this exact process owns the one live
    // worker, so an unrelated Node process cannot manufacture authority
    // from public scope values.
    for (const worker of engineState.retainedWorkers) {
      const capabilityResult = rc.createHostBridgeCapability(worker.capabilityScope);
      if (!capabilityResult.ok) {
        shutdown('APP_SERVER_HOST_CAPABILITY_FAILED:' + (capabilityResult.reason || 'unknown'));
        return;
      }
      worker.capability = capabilityResult.capability;
      delete worker.capabilityScope;

      // The retained worker's own durable RoleActorBinding id -- required
      // (READY only) so a later P2 review record can correlate to this
      // exact worker's real binding rather than any caller-supplied value.
      const bindingState = readRoleBindingState(
        worker.repoDescriptor, worker.worktreeId, worker.planDigest, worker.profileDigest, worker.sessionGenerationId, worker.role,
      );
      if (!bindingState.ok || bindingState.state !== 'READY' || !bindingState.record || !isHexActionId(bindingState.record.binding_id)) {
        shutdown('APP_SERVER_ROLE_BINDING_NOT_READY');
        return;
      }
      worker.bindingId = bindingState.record.binding_id;
    }

    if (p.testBackend === 'deterministic-app-server-v1') {
      const deterministicMcpControl = await startDeterministicMcpLoopbackServer({
        workers: engineState.retainedWorkers, coordinationRootReal, sessionExpiry: p.sessionExpiry,
        onFatal: (reason) => { if (!engineState.getEngineStopRequested()) void shutdown(reason); },
      });
      engineState.setDeterministicMcpControl(deterministicMcpControl);
      if (!deterministicMcpControl || deterministicMcpControl.ok !== true) {
        shutdown('DETERMINISTIC_MCP_LISTENER_START_FAILED');
        return;
      }
    }

    // For a real cmdSessionRun batch, only NOW -- after the durable
    // registry-level batch-ready transition AND every worker's
    // HostBridgeCapability mint have BOTH genuinely succeeded -- does
    // readyPromise resolve. resolveReady is idempotent, so this is a
    // harmless no-op for the direct-engine-fixture path.
    if (engine.ownsBatchLifecycle === true) engineState.resolveReady();

    // Retained, disk-driven worker loop. Polling and admission are shared
    // by all role children in this supervisor process, while service
    // remains exclusive per role.
    timerState.setKeepAliveHandle(setInterval(() => {
      engineState.setPollTicketPromise(pollRetainedWorkers().catch((err) => {
        if (!isShuttingDown() && !engineState.getEngineStopRequested()) void shutdown(workerFailureSignal('APP_SERVER_POLL_FAILED', err));
      }));
    }, RETAINED_WORKER_POLL_INTERVAL_MS));
    try {
      await pollRetainedWorkers();
    } catch (err) {
      // This is runStartup's OWN final statement -- awaiting shutdown here
      // is the SAME self-join hazard as pollRetainedWorkers's own internal
      // calls above.
      if (!isShuttingDown() && !engineState.getEngineStopRequested()) void shutdown(workerFailureSignal('APP_SERVER_POLL_FAILED', err));
    }
  }

  // Engine work registers synchronously with this coordinator before
  // startup awaits. requestStop is already a fully-formed closure at this
  // point -- publish the handle to the caller's optional onHandleReady hook
  // HERE, synchronously, strictly BEFORE runStartup() is invoked, so even a
  // startup failure entirely within runStartup's own first synchronous
  // burst is still reachable through the SAME engineBox a real
  // cmdSessionRun signal handler already closes over. runStopTimelineDirect
  // is exposed here ONLY so the coordinator's own pre-engine-to-engine
  // handoff can reach it via engineBox.handle -- never a second documented
  // public stop API.
  const handle = { readyPromise: engineState.readyPromise, requestStop, runStopTimelineDirect };
  if (typeof engine.onHandleReady === 'function') engine.onHandleReady(handle);
  const startupTask = runStartup();
  startupTask.catch((err) => {
    engineState.settleReadyOnStartupFailure((err && err.message) ? err.message : String(err));
  });
  return handle;
}

  return Object.freeze({
    startOwnedAppServerSupervisorEngine,
  });
}

module.exports = Object.freeze({ createOwnedAppServerSupervisorEngine });
