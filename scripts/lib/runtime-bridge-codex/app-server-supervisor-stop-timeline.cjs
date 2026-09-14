'use strict';

// Extracted behaviorally from runtime-bridge-codex.cjs's
// startOwnedAppServerSupervisorEngine: the owned stop timeline's process/
// root teardown stages (1-5: child stop, admitted-job join, root cleanup,
// owner release, batch terminalize) -- section5's "absolute maximum 32s
// from t0 with stage ceilings 4+12+4+10+2". Receipt assembly/publish is
// deliberately NOT here (see app-server-supervisor-stop-receipt.cjs);
// this module only computes the facts a receipt reports and hands them off.
// Never requires the facade or either sibling facade, directly or
// transitively.

function createSupervisorStopTimeline({
  ledger, retainedWorkers, observerJobs, pendingRawMcpPromises, bornVerificationPending,
  getPollInFlight, getPollTicketPromise, getDeterministicMcpControl,
  getAdmissionClosed, getStartupJoinSettled, setStartupJoinSettled, getFirstStopReason,
  clearKeepAliveHandle, getStartupTask, ownedChildrenSnapshot,
  cleanupLedgerRoot, preservedLedgerRootReceipt,
  stopOwnedAppServerChildBounded, sessionRunTermConfirmTimeoutMs, sessionRunKillConfirmTimeoutMs,
  raceAgainstBound, asyncSleep,
  p, repoDescriptor, coordinationRootReal, rendezvousInstanceId, supervisorInstanceId, pidIdentity, action,
  computeCoordinationRootId, roleOwnerPathFor, releaseOwnedRoleOwner, terminalizeSupervisorStartAction,
  getBatchReady, getPhase, ownsBatchLifecycle, buildAndPublishStopReceipt,
}) {
  const STOP_STAGE1_CHILD_STOP_MS = 4000;
  const STOP_STAGE2_JOIN_MS = 12000;
  const STOP_STAGE3_DELTA_STOP_MS = 4000;
  const STOP_STAGE4_CLEANUP_MS = 10000;
  const STOP_STAGE5_RECEIPT_MS = 2000;
  const STOP_TIMELINE_ABSOLUTE_MAX_MS = STOP_STAGE1_CHILD_STOP_MS + STOP_STAGE2_JOIN_MS
    + STOP_STAGE3_DELTA_STOP_MS + STOP_STAGE4_CLEANUP_MS + STOP_STAGE5_RECEIPT_MS;
  const STREAM_CLOSE_CONFIRM_TIMEOUT_MS = 1000;

  async function runOwnedStopTimeline(reason) {
    const t0 = Date.now();
    const deadlineAbsolute = t0 + STOP_TIMELINE_ABSOLUTE_MAX_MS;
    // Every stage below is bounded by the LESSER of its own ceiling and
    // whatever remains of the single absolute deadline, applied end-to-end
    // -- an earlier stage's own overrun can only ever shrink a later
    // stage's budget, never silently borrow time from it.
    const stageBoundMs = (ownCeilingMs) => Math.max(0, Math.min(ownCeilingMs, deadlineAbsolute - Date.now()));

    const stoppedChildHandles = new Set();
    const unsettledChildStops = new Set();
    const unconfirmedChildren = new Set();
    let anyUnconfirmed = false;
    let anyEscalated = false;
    let observedCount = 0;
    let exitConfirmedCount = 0;
    let streamsClosedCount = 0;

    // A confirmed process exit alone does not prove its stdio pipes have
    // genuinely finished draining/closing; wait for the real 'close' event
    // on each, bounded, never inferred from the exit alone.
    function waitForOwnedStreamsClosed(child, boundMs) {
      const streams = [child.stdout, child.stderr].filter(Boolean);
      if (streams.length === 0) return Promise.resolve(true);
      return new Promise((resolve) => {
        let remaining = streams.length;
        let settled = false;
        const timer = setTimeout(() => { if (!settled) { settled = true; resolve(false); } }, Math.max(0, boundMs));
        function onOneClosed() {
          remaining -= 1;
          if (remaining <= 0 && !settled) { settled = true; clearTimeout(timer); resolve(true); }
        }
        for (const s of streams) {
          if (s.destroyed || s.closed) { onOneClosed(); continue; }
          s.once('close', onOneClosed);
        }
      });
    }

    function ledgerInstanceIdForChild(child) {
      for (const entry of ledger.values()) {
        if (entry.child === child) return entry.instanceId;
      }
      return null;
    }
    async function stopChild(child) {
      if (stoppedChildHandles.has(child)) return;
      stoppedChildHandles.add(child);
      observedCount += 1;
      unsettledChildStops.add(child);
      try {
        const result = await stopOwnedAppServerChildBounded(child, sessionRunTermConfirmTimeoutMs, sessionRunKillConfirmTimeoutMs);
        if (result.stopped) {
          exitConfirmedCount += 1;
          for (const entry of ledger.values()) {
            if (entry.child === child) { entry.stopConfirmed = true; break; }
          }
          const streamsClosed = await waitForOwnedStreamsClosed(child, STREAM_CLOSE_CONFIRM_TIMEOUT_MS);
          if (streamsClosed) streamsClosedCount += 1;
        } else {
          anyUnconfirmed = true;
          unconfirmedChildren.add(child);
        }
        if (result.escalated) anyEscalated = true;
      } finally {
        unsettledChildStops.delete(child);
      }
    }

    // Stage 1: first exact-owned child stop, parallel, <=4s total. A child
    // whose pid is still in bornVerificationPending is deliberately SKIPPED
    // -- stage3's own delta pass below re-snapshots and stops anything
    // stage1 skipped (stopChild's own stoppedChildHandles guard makes it
    // idempotent either way).
    await raceAgainstBound(
      Promise.all(ownedChildrenSnapshot().filter((child) => !bornVerificationPending.has(child.pid)).map(stopChild)),
      stageBoundMs(STOP_STAGE1_CHILD_STOP_MS),
    );

    // Stage 2: join every admitted pre-engine acquisition/startup/poll/
    // request/activePromise/raw-MCP/observer/waiter/capture job -- the
    // ACTUAL underlying promise, never a counter -- each with its own
    // settlement callback attached unconditionally.
    const joinEntries = [{ name: 'startup', instanceId: null, promise: getStartupTask() }];
    for (const worker of retainedWorkers) {
      if (worker.activePromise) joinEntries.push({ name: 'request:' + worker.role, instanceId: null, promise: worker.activePromise });
    }
    for (const rawMcpPromise of pendingRawMcpPromises) {
      joinEntries.push({ name: 'raw-mcp', instanceId: null, promise: rawMcpPromise });
    }
    for (const observerChild of observerJobs) {
      joinEntries.push({
        name: 'observer', instanceId: null,
        promise: new Promise((resolve) => {
          if (observerChild.exitCode !== null || observerChild.signalCode !== null) { resolve(); return; }
          observerChild.once('exit', () => resolve());
          observerChild.once('error', () => resolve());
        }),
      });
    }
    const pollTicketPromise = getPollTicketPromise();
    if (pollTicketPromise) joinEntries.push({ name: 'poll', instanceId: null, promise: pollTicketPromise });
    const deterministicMcpControl = getDeterministicMcpControl();
    if (deterministicMcpControl) {
      joinEntries.push({ name: 'deterministic-mcp-listener', instanceId: null, promise: deterministicMcpControl.beginClose() });
    }
    const joinSettledFlags = joinEntries.map(() => false);
    joinEntries.forEach((entry, i) => {
      entry.promise.then(() => { joinSettledFlags[i] = true; }, () => { joinSettledFlags[i] = true; });
    });
    await raceAgainstBound(
      Promise.all(joinEntries.map((entry) => entry.promise.catch(() => {}))),
      stageBoundMs(STOP_STAGE2_JOIN_MS),
    );
    let unsettledJoins = joinEntries.filter((_, i) => !joinSettledFlags[i]);
    setStartupJoinSettled(unsettledJoins.length === 0);
    // An ALREADY in-flight poll tick still needs to genuinely finish (its
    // own finally{} clears pollInFlight) -- bounded-poll the STAGE2
    // ceiling's OWN residual window here, never the full absolute deadline.
    const stage2AbsoluteDeadline = Math.min(deadlineAbsolute, t0 + STOP_STAGE2_JOIN_MS);
    while (getPollInFlight() && Date.now() < stage2AbsoluteDeadline) {
      await asyncSleep(10);
    }
    if (getPollInFlight()) setStartupJoinSettled(false);

    // Stage 3: clear/null polling again (idempotent), snapshot the final
    // child delta, stop each new handle once, parallel, bounded to its own
    // 4s ceiling. Already-stopped handles are never resignalled.
    clearKeepAliveHandle();
    await raceAgainstBound(
      Promise.all(ownedChildrenSnapshot().filter((child) => !stoppedChildHandles.has(child)).map(stopChild)),
      stageBoundMs(STOP_STAGE3_DELTA_STOP_MS),
    );

    const stopped = !anyUnconfirmed;
    const escalated = anyEscalated;

    // A final child-delta integrity check, strictly AFTER stage3's own
    // delta pass: any child neither stage1 nor stage3 ever even attempted
    // to stop means the batch is NOT provably quiescent, regardless of
    // every other predicate below -- defense-in-depth, never merely an
    // assumption a future change could silently invalidate.
    const finalChildDelta = ownedChildrenSnapshot().filter((child) => !stoppedChildHandles.has(child));
    const anyChildAppearedAfterFinalDelta = finalChildDelta.length > 0;

    // Stage 4: only if every admitted writer/job and child is confirmed
    // quiescent -- authorized cleanup/retirement/reap for every actually
    // created root, stable instanceId order, bounded to its own 10s
    // ceiling (re-checked per root).
    const stage4Deadline = Date.now() + stageBoundMs(STOP_STAGE4_CLEANUP_MS);
    const quiescent = stopped && getStartupJoinSettled() && !getPollInFlight() && unsettledChildStops.size === 0
      && observerJobs.size === 0 && pendingRawMcpPromises.size === 0
      && streamsClosedCount === observedCount && !anyChildAppearedAfterFinalDelta
      && retainedWorkers.every((worker) => !worker.activePromise) && unsettledJoins.length === 0
      && (!deterministicMcpControl || deterministicMcpControl.isClosed());
    const rootReceipts = [];
    let anyRootFailure = false;
    const rootFailureEntries = [];
    for (const instanceId of Array.from(ledger.keys()).sort()) {
      const entry = ledger.get(instanceId);
      const withinStage4Deadline = Date.now() < stage4Deadline;
      const rootReceipt = (quiescent && withinStage4Deadline) ? cleanupLedgerRoot(entry, stage4Deadline) : preservedLedgerRootReceipt(entry, 'DEADLINE_EXCEEDED');
      if (rootReceipt.disposition !== 'REAPED') {
        anyRootFailure = true;
        const stageForCode = rootReceipt.reason === 'REAP_FAILED' ? 'reap' : (rootReceipt.reason === 'CLEANUP_REJECTED' ? 'cleanup' : 'delta');
        rootFailureEntries.push({
          stage: stageForCode, instance_id: instanceId,
          code: rootReceipt.reason || 'DEADLINE_EXCEEDED',
          detail: rootReceipt.reason_detail || null,
        });
      }
      rootReceipts.push(rootReceipt);
    }

    // Stage 5: release only actually claimed owners, terminalize the
    // actual consumed batch, bounded to its own 2s ceiling. releaseOwnedRoleOwner
    // itself is idempotent/no-op-safe for an owner that no longer exists or
    // was never this coordinator's own -- never a fabricated release.
    const stage5Deadline = Date.now() + stageBoundMs(STOP_STAGE5_RECEIPT_MS);
    const coordinationRootId = computeCoordinationRootId(coordinationRootReal);
    let claimsReleased = true;
    const ownerFailureEntries = [];
    for (const role of p.roles) {
      if (Date.now() >= stage5Deadline) {
        claimsReleased = false;
        ownerFailureEntries.push({ stage: 'terminal', instance_id: null, code: 'DEADLINE_EXCEEDED' });
        continue;
      }
      try {
        const ownerPath = roleOwnerPathFor(repoDescriptor, coordinationRootId, role);
        const released = releaseOwnedRoleOwner(ownerPath, supervisorInstanceId, rendezvousInstanceId, role, coordinationRootId, pidIdentity);
        if (!released || !released.ok) { claimsReleased = false; ownerFailureEntries.push({ stage: 'terminal', instance_id: null, code: 'OWNER_MISMATCH' }); }
      } catch (err) {
        claimsReleased = false;
        ownerFailureEntries.push({ stage: 'terminal', instance_id: null, code: 'OWNER_MISMATCH' });
      }
    }
    // R3-ENGINE-* frozen contract: a direct-engine-harness requestStop()
    // never terminalizes the action -- that is the real outer cmdSessionRun
    // coordinator's own job. ownsBatchLifecycle is set ONLY by cmdSessionRun's
    // own real construction, never by any test fixture.
    const hasRealAction = !!(
      ownsBatchLifecycle === true
      && action && action.payload && Array.isArray(action.payload.bridge_argv)
    );
    let batchTerminalized = true;
    const terminalFailureEntries = [];
    const firstStopReason = getFirstStopReason();
    if (hasRealAction) {
      if (Date.now() >= stage5Deadline) {
        batchTerminalized = false;
        terminalFailureEntries.push({ stage: 'terminal', instance_id: null, code: 'DEADLINE_EXCEEDED' });
      } else {
        const effectiveReasonForTerm = String(firstStopReason || reason || '');
        const termReason = (effectiveReasonForTerm === 'EXPIRY' || effectiveReasonForTerm === 'START_DEADLINE') ? 'deadline' : 'native-tool-error';
        const disposition = getBatchReady() ? (effectiveReasonForTerm === 'EXPIRY' ? 'session-expiry' : 'premature-loss') : 'startup-failure';
        try {
          const termResult = terminalizeSupervisorStartAction(action, termReason, disposition);
          batchTerminalized = !!(termResult && termResult.ok);
          if (!batchTerminalized) terminalFailureEntries.push({ stage: 'terminal', instance_id: null, code: 'RETIREMENT_FAILED' });
        } catch (err) {
          batchTerminalized = false;
          terminalFailureEntries.push({ stage: 'terminal', instance_id: null, code: 'RETIREMENT_FAILED' });
        }
      }
    }
    const stage5DeadlineExceeded = Date.now() >= stage5Deadline;

    // Every failure entry below is derived from an ACTUAL observed problem,
    // never a single synthesized catch-all row.
    const joinFailureEntries = unsettledJoins.map((entry) => ({ stage: 'join', instance_id: entry.instanceId, code: 'WRITER_UNSETTLED' }));
    const affectedStopChildren = new Set([...unconfirmedChildren, ...unsettledChildStops]);
    const stopFailureEntries = Array.from(affectedStopChildren).map((child) => ({
      stage: 'stop', instance_id: ledgerInstanceIdForChild(child), code: 'CHILD_UNCONFIRMED',
    }));
    const stage5FailureEntries = stage5DeadlineExceeded ? [{ stage: 'terminal', instance_id: null, code: 'DEADLINE_EXCEEDED' }] : [];
    const failures = [].concat(stopFailureEntries, joinFailureEntries, rootFailureEntries, ownerFailureEntries, terminalFailureEntries, stage5FailureEntries);

    const resourceUncertain = !quiescent || anyRootFailure || !claimsReleased || !batchTerminalized || stage5DeadlineExceeded;
    const outcome = resourceUncertain ? 'PRESERVED' : 'CLEAN';
    const code = resourceUncertain ? 7 : 0;
    const effectiveReason = String(firstStopReason || reason || 'REQUEST_STOP');
    const pendingWaitersCount = unsettledJoins.filter((entry) => entry.name === 'startup' || entry.name.indexOf('request:') === 0).length;

    const facts = {
      t0, stopped, escalated, quiescent,
      admissionClosed: getAdmissionClosed(), startupJoinSettled: getStartupJoinSettled(), pollInFlight: getPollInFlight(),
      retainedWorkersPendingCount: retainedWorkers.filter((worker) => worker.activePromise).length,
      pendingRawMcpSize: pendingRawMcpPromises.size, pendingWaitersCount, observerJobsSize: observerJobs.size,
      observedCount, exitConfirmedCount, streamsClosedCount,
      rootReceipts, claimsReleased, batchTerminalized, failures,
      resourceUncertain, outcome, code, effectiveReason, stage5Deadline,
    };
    const ctx = {
      action, supervisorInstanceId, repoDescriptor, phase: getPhase(), ownsBatchLifecycle, batchReady: getBatchReady(),
    };
    return buildAndPublishStopReceipt(facts, ctx);
  }

  return Object.freeze({ runOwnedStopTimeline });
}

module.exports = Object.freeze({ createSupervisorStopTimeline });
