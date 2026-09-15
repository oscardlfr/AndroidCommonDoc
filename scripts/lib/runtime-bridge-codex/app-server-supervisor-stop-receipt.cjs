'use strict';

// Extracted behaviorally from runtime-bridge-codex.cjs's
// startOwnedAppServerSupervisorEngine/runOwnedStopTimeline: the pure
// receipt-assembly, durable publish (with a corrected-record retry on
// failure) and terminal-report steps -- deliberately separated from the
// process/root teardown stages themselves (app-server-supervisor-stop-
// timeline.cjs), which compute every fact this module only assembles and
// reports. Never requires the facade or either sibling facade, directly or
// transitively.

function createSupervisorStopReceipt({
  fs, path, registryRepoDir, publishBridgeRegistryRecord, canonicalJSONStringify, deepFreeze,
  RC, classifyStopReasonRc,
}) {
  /**
   * `facts` carries every value runOwnedStopTimeline's own stages already
   * computed (never recomputed here): stopped, escalated, quiescent,
   * admissionClosed, startupJoinSettled, pollInFlight, retainedWorkersPendingCount,
   * pendingRawMcpSize, pendingWaitersCount, observerJobsSize, observedCount,
   * exitConfirmedCount, streamsClosedCount, rootReceipts, claimsReleased,
   * batchTerminalized, failures, resourceUncertain, outcome, code,
   * effectiveReason, t0, stage5Deadline. `ctx` carries the engine's own
   * fixed identity: action, supervisorInstanceId, repoDescriptor, phase,
   * ownsBatchLifecycle.
   */
  function buildAndPublishStopReceipt(facts, ctx) {
    const receipt = {
      schema: 'runtime/owned-shutdown-receipt/v1',
      action_id: (ctx.action && ctx.action.action_id) || null,
      supervisor_instance_id: ctx.supervisorInstanceId || null,
      repo_id: ctx.repoDescriptor.repoId,
      worktree_id: (ctx.action && ctx.action.worktree_id) || null,
      plan_digest: (ctx.action && ctx.action.plan_digest) || null,
      phase: ctx.phase,
      reason: facts.effectiveReason.slice(0, 128),
      started_at: new Date(facts.t0).toISOString(),
      finished_at: new Date().toISOString(),
      stopped: facts.stopped,
      escalated: facts.escalated,
      quiescence: {
        admission_closed: facts.admissionClosed,
        startup_settled: facts.startupJoinSettled,
        pending_admissions: 0,
        pending_polls: facts.pollInFlight ? 1 : 0,
        pending_requests: facts.retainedWorkersPendingCount,
        pending_raw_mcp: facts.pendingRawMcpSize,
        pending_waiters: facts.pendingWaitersCount,
        pending_observers: facts.observerJobsSize,
        pending_captures: Math.max(0, facts.observedCount - facts.streamsClosedCount),
      },
      children: {
        observed: facts.observedCount,
        exit_confirmed: facts.exitConfirmedCount,
        streams_closed: facts.streamsClosedCount,
        unconfirmed: facts.observedCount - facts.exitConfirmedCount,
      },
      roots: facts.rootReceipts,
      ownership: { claims_released: facts.claimsReleased, batch_terminalized: facts.batchTerminalized },
      outcome: facts.outcome, code: facts.code,
      failures: facts.failures,
    };
    deepFreeze(receipt);

    // Durable, canonical no-clobber shutdown-receipts/<action_id>.json, in
    // the SAME private repository registry every other durable record
    // family resolves through. Same-process replay is the only same-process
    // idempotent replay; this write is attempted exactly once (twice only
    // on the corrected-receipt retry below) per coordinator lifetime.
    function attemptPublish(candidateReceipt) {
      if (!(ctx.action && ctx.action.action_id)) return null;
      // Deterministic resource-failure seam for the conformance harness --
      // inert unless BOTH test gates are explicit, evaluated only at the
      // real terminal publication point after owned work has drained.
      if (
        process.env.NODE_ENV === 'test'
        && process.env.RUNTIME_BRIDGE_CODEX_TEST_CAPABILITY === 'x'
      ) {
        const failImmediately = process.env.RUNTIME_BRIDGE_CODEX_TEST_FAIL_SHUTDOWN_RECEIPT === '1';
        const failAfterPath = process.env.RUNTIME_BRIDGE_CODEX_TEST_FAIL_SHUTDOWN_RECEIPT_AFTER_FILE;
        const failAfterObserved = typeof failAfterPath === 'string' && failAfterPath.length > 0
          && fs.existsSync(failAfterPath);
        if (failImmediately || failAfterObserved) return null;
      }
      const candidatePath = path.join(registryRepoDir({ repoId: ctx.repoDescriptor.repoId }), 'shutdown-receipts', ctx.action.action_id + '.json');
      try {
        publishBridgeRegistryRecord(candidatePath, Buffer.from(canonicalJSONStringify(candidateReceipt), 'utf8'));
        return candidatePath;
      } catch (err) {
        return null;
      }
    }
    // The FIRST publish attempt is also gated on the same stage5 deadline
    // every other stage5-scoped item respects -- never started after its
    // applicable deadline. A skipped attempt still yields a truthful
    // publishFailed/resourceUncertain outcome below, the same honest shape
    // an actual write failure already produces.
    let receiptPath = (Date.now() < facts.stage5Deadline) ? attemptPublish(receipt) : null;
    const publishFailed = !receiptPath && !!(ctx.action && ctx.action.action_id);

    // This engine owns terminal reporting itself for a real cmdSessionRun
    // batch (ownsBatchLifecycle===true) -- exactly one memoized Promise and
    // one report path shared by pre-engine, engine, signals, expiry/errors
    // and the public engine requestStop alike. A direct-engine test fixture
    // (ownsBatchLifecycle unset) never reaches this printing/exitCode side
    // effect, exactly as before.
    function finalizeStopResult(stopResultBase) {
      if (ctx.ownsBatchLifecycle !== true) return Object.freeze(Object.assign({}, stopResultBase, { reported: false }));
      const childStopConfirmed = stopResultBase.stopped;
      const confirmedCleanReason = stopResultBase.escalated ? 'owned-shutdown-forced' : 'owned-shutdown';
      let rcOut;
      let reasonOut;
      if (!childStopConfirmed || stopResultBase.resourceUncertain) {
        rcOut = RC.CLEANUP_INTERNAL;
        reasonOut = childStopConfirmed ? 'cleanup-failed' : 'child-stop-unconfirmed';
      } else {
        rcOut = classifyStopReasonRc(stopResultBase.firstStopReason, ctx.batchReady);
        reasonOut = rcOut === RC.OK ? confirmedCleanReason : stopResultBase.firstStopReason;
      }
      // scheduleStartupExpiration/scheduleOwnedExpiration both raise the
      // SAME outer 'EXPIRY' trigger, preserved byte-for-byte in the
      // envelope's own "signal" field; the coordinator's own requestStop
      // translates a pre-batchReady EXPIRY into the internal
      // 'START_DEADLINE' reason before ever calling this handle's own
      // requestStop, so 'START_DEADLINE' reaching here can only ever have
      // originated from that exact translation -- reverse-mapped here for
      // the envelope alone, never for rc classification above.
      const signalOut = stopResultBase.firstStopReason === 'START_DEADLINE' ? 'EXPIRY' : stopResultBase.firstStopReason;
      const envelope = Object.freeze({
        schema: 'coordination/bridge-result/v1', command: 'session-run', ok: rcOut === RC.OK,
        action_id: ctx.action.action_id, reason: reasonOut, signal: signalOut, phase: ctx.phase,
      });
      process.stdout.write(JSON.stringify(envelope) + '\n');
      // Natural drain, never process.exit -- every owned handle this SAME
      // timeline is responsible for is already genuinely closed (or
      // truthfully reported as resourceUncertain otherwise).
      process.exitCode = rcOut;
      return Object.freeze(Object.assign({}, stopResultBase, { reported: true }));
    }

    if (publishFailed) {
      // Make terminal receipt publication failure itself produce in-memory
      // PRESERVED/code7, exact TERMINAL_PUBLICATION_FAILED, and CLI
      // override: rebuild the receipt truthfully reflecting THIS exact
      // failure and re-attempt to publish the CORRECTED record (best-effort).
      const correctedReceipt = Object.assign({}, receipt, {
        outcome: 'PRESERVED', code: 7,
        failures: receipt.failures.concat([{ stage: 'terminal', instance_id: null, code: 'TERMINAL_PUBLICATION_FAILED' }]),
      });
      deepFreeze(correctedReceipt);
      // The retry publish attempt is gated on the SAME stage5Deadline the
      // first attempt above uses -- once genuinely exhausted, this skips
      // the retry (resourceUncertain is already unconditionally true on
      // this branch regardless) rather than attempting more potentially-
      // blocking I/O past a deadline this coordinator already knows is lost.
      receiptPath = (Date.now() < facts.stage5Deadline) ? attemptPublish(correctedReceipt) : null;
      return finalizeStopResult({
        stopped: facts.stopped, escalated: facts.escalated, firstStopReason: facts.effectiveReason,
        receiptPath, resourceUncertain: true, receipt: correctedReceipt,
      });
    }

    return finalizeStopResult({
      stopped: facts.stopped, escalated: facts.escalated, firstStopReason: facts.effectiveReason,
      receiptPath, resourceUncertain: facts.resourceUncertain, receipt,
    });
  }

  return Object.freeze({ buildAndPublishStopReceipt });
}

module.exports = Object.freeze({ createSupervisorStopReceipt });
