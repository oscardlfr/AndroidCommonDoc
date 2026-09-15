'use strict';

// Extracted behaviorally from runtime-bridge-codex.cjs's
// startOwnedAppServerSupervisorEngine/runStartup: the retained, disk-driven
// worker poll loop -- session-generation retirement re-checks, per-worker
// transport/presence/root-consult/inbox-claim/lease/queue advancement, and
// worker-failure signal classification. Never requires the facade or
// either sibling facade, directly or transitively.

function createSupervisorRetainedPolling({
  sessionExpiryMs, action, retainedSessionGenerationStatus, shutdown, isShuttingDown, getEngineStopRequested,
  getPollInFlight, setPollInFlight, pendingRawMcpPromises, retainedWorkers, repoDescriptor, coordinationRootReal,
  rc, loadP2CompletedRootReviewContext, executeP2RetainedArchitectReview, collectPendingMixedReviewRequest,
  executeRetainedWorkerRequest, replaceOwnedWorkerPresence, retainedWorkerHeartbeatIntervalMs, asyncSleep,
}) {
  const workerFailureSignal = (prefix, err) => (
    Date.now() >= sessionExpiryMs
      ? 'EXPIRY'
      : prefix + ':' + String((err && err.message) || err)
  );
  // Last time this supervisor re-proved its own session generation. Seeded
  // at engine start: the action validation that admitted this run has just
  // proven it live.
  let lastGenerationCheckMs = Date.now();
  const generationRetired = () => {
    const observed = retainedSessionGenerationStatus(action, lastGenerationCheckMs, Date.now());
    if (!observed.due) return false;
    lastGenerationCheckMs = observed.checkedAtMs;
    return observed.retired;
  };

  const pollRetainedWorkers = async () => {
    if (getPollInFlight() || isShuttingDown() || getEngineStopRequested()) return;
    // Checked before anything is admitted: once shutdown is requested this
    // same entry guard refuses every later tick, so a retirement observed
    // here stops new work immediately while the ordinary owned stop
    // timeline settles whatever this supervisor already owns.
    if (generationRetired()) {
      void shutdown('SESSION_GENERATION_RETIRED');
      return;
    }
    if (Date.now() >= sessionExpiryMs) {
      // Internal admitted jobs request stop without awaiting their own
      // coordinator; no self-join. pollRetainedWorkers is invoked as
      // runStartup's OWN final synchronous statement -- AWAITING shutdown
      // from here would block THIS SAME call from ever returning, which
      // would block startupTask from ever settling, which the stop
      // timeline's own stage2 is simultaneously waiting on. Kick the
      // timeline off and return immediately.
      void shutdown('EXPIRY');
      return;
    }
    // A raw MCP/Context7 operation is already admitted and independently
    // tracked by the coordinator. Do not begin another registry poll while
    // its stdio I/O is in flight: several registry operations below are
    // deliberately synchronous, so polling here can starve the MCP child's
    // event-loop callbacks past the frozen 10s end-to-end deadline. This is
    // an admission deferral, never a security cache or a timeout relaxation.
    if (pendingRawMcpPromises.size > 0) return;
    setPollInFlight(true);
    try {
      for (const worker of retainedWorkers) {
        if (getEngineStopRequested()) return;
        // An active request can reach raw MCP while this tick is yielding
        // between workers. Re-check the same admission fence here.
        if (pendingRawMcpPromises.size > 0) return;
        if (Date.now() >= sessionExpiryMs) {
          void shutdown('EXPIRY');
          return;
        }
        // Re-checked per worker: a scan across every retained role can
        // outlive the moment the batch stopped being wanted.
        if (generationRetired()) {
          void shutdown('SESSION_GENERATION_RETIRED');
          return;
        }
        if (!worker.connection || worker.connection.isStopped()) {
          // A diagnostic must never change the outcome it is describing.
          try {
            const why = worker.connection && typeof worker.connection.stopReason === 'function'
              ? worker.connection.stopReason()
              : 'connection-absent';
            process.stderr.write('[session-run] transport stopped: role='
              + String(worker.role) + ' reason=' + String(why === null || why === undefined ? 'none' : why) + '\n');
          } catch (ignored) { /* diagnostics only */ }
          void shutdown('APP_SERVER_CHILD_TRANSPORT_STOPPED');
          return;
        }
        const nowMs = Date.now();
        if (nowMs - worker.lastPresenceHeartbeatMs >= retainedWorkerHeartbeatIntervalMs) {
          const heartbeat = replaceOwnedWorkerPresence(repoDescriptor, worker, worker.threadId);
          if (!heartbeat.ok) throw new Error(heartbeat.reason);
        }

        // Requester-side work for the exact retained worker actor, never a
        // target scheduler item and never a noop-capable dispatch path.
        // Consultation owns all host-registry discovery/WAL/transaction
        // mechanics; the bridge supplies only its in-memory capability.
        const rootConsultIntents = rc.hostBridgeListRootConsultIntents(
          worker.capability, coordinationRootReal,
        );
        // Validate every completed P2 source-evidence root against the
        // same canonical context before selecting any one of them. Zero is
        // idle; more than one is an authority ambiguity.
        const completedP2Contexts = [];
        const collectCompletedP2Context = (rootIntent, completedResult) => {
          if (!completedResult || !completedResult.item) {
            throw new Error('root-consult-completed-item-absent');
          }
          if (worker.role === 'context-provider') return;
          const reviewContext = loadP2CompletedRootReviewContext(
            worker, rootIntent, coordinationRootReal, completedResult.item,
          );
          if (reviewContext.eligible === true) completedP2Contexts.push(reviewContext);
        };

        for (const rootIntent of rootConsultIntents) {
          let advanced;
          try {
            advanced = rc.hostBridgeAdvanceRootConsult(
              worker.capability, coordinationRootReal, rootIntent.intentPath,
            );
          } catch (error) {
            // Post-intent loss of the required live target is one
            // ordinary, bounded BLOCKED operation -- never terminate the
            // healthy requester worker or invent a marker/completion/
            // delivery/evidence/result/noop activation. DURABILITY_UNPROVEN
            // means exactly that -- not yet provably durable, never a
            // permanent defect -- so it is retried on the next tick the same
            // way, rather than rejecting this poll (which the caller's own
            // setInterval handler would turn into a full engine shutdown).
            if (error && (error.detailCode === 'DRIVER_UNAVAILABLE' || error.detailCode === 'DURABILITY_UNPROVEN')) continue;
            throw error;
          }
          if (!advanced || advanced.ok !== true) throw new Error('root-consult-advance-invalid');
          if (advanced.status === 'blocked') continue;
          if (advanced.status === 'completed') {
            collectCompletedP2Context(rootIntent, advanced);
            continue;
          }
          if (advanced.status !== 'pending' && advanced.status !== 'ready') {
            throw new Error('root-consult-advance-status-invalid');
          }
          const observed = rc.hostBridgeObserveAndCompleteRootConsult(
            worker.capability, coordinationRootReal, rootIntent.intentPath,
          );
          if (!observed || observed.ok !== true) throw new Error('root-consult-observe-invalid');
          if (!['pending', 'ready', 'blocked', 'completed'].includes(observed.status)) {
            throw new Error('root-consult-observe-status-invalid');
          }
          if (observed.status === 'completed') collectCompletedP2Context(rootIntent, observed);
        }

        if (completedP2Contexts.length > 1) throw new Error('p2-review-root-ambiguous');
        if (completedP2Contexts.length === 1 && worker.activePromise === null) {
          const selected = completedP2Contexts[0];
          worker.activePromise = executeP2RetainedArchitectReview(
            worker, selected.rootIntent, coordinationRootReal, selected.observed,
          )
            .catch((err) => {
              if (!isShuttingDown() && !getEngineStopRequested()) {
                void shutdown(workerFailureSignal('APP_SERVER_WORKER_LOOP_FAILED', err));
              }
            })
            .finally(() => {
              worker.activePromise = null;
              worker.activeRequestId = null;
            });
        }

        // Sibling to the P2 block immediately above -- alongside it, never
        // replacing it. Placed after so a P2 review already dispatched
        // this same tick naturally defers this worker's mixed-review turn
        // (if any) to a later tick via the SAME worker.activePromise===null
        // single-flight guard; never a double-dispatch on the same worker
        // within one tick.
        collectPendingMixedReviewRequest(worker, coordinationRootReal, (err) => {
          if (!isShuttingDown() && !getEngineStopRequested()) {
            void shutdown(workerFailureSignal('APP_SERVER_WORKER_LOOP_FAILED', err));
          }
        });

        // Dispatching a NEW item is already gated behind
        // `!worker.activePromise` below, so for a worker already mid-turn,
        // scanning/claiming its inbox, sorting its queue and heartbeating
        // queued leases can select or change nothing this tick -- skipping
        // this block loses no correctness, only defers bookkeeping for
        // requests that are neither active nor queued to a later, idle tick.
        if (!worker.activePromise && worker.threadId === null) {
          let inbox;
          try {
            inbox = rc.hostBridgeListInbox(worker.capability, coordinationRootReal);
          } catch (error) {
            // A no-clobber publisher deliberately exposes one tiny,
            // explicitly classified nlink==2 window before its temp link
            // is removed. This retained loop has a bounded next poll, so
            // that ONE state means "not durable yet" rather than worker
            // failure.
            if (error && error.durablePending === true) continue;
            throw error;
          }
          const visible = new Set(inbox.map((item) => item.requestId));
          for (const item of inbox) {
            if (worker.knownRequests.has(item.requestId)) continue;
            const claimedRequest = rc.hostBridgeClaim(
              worker.capability, coordinationRootReal, item.requestPath,
            );
            worker.knownRequests.add(item.requestId);
            worker.queue.push(Object.assign({}, item, {
              claimPath: claimedRequest.artifact_ref,
              lastLeaseHeartbeatMs: Date.now(),
            }));
          }
          worker.queue.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.requestId.localeCompare(b.requestId));

          for (let i = worker.queue.length - 1; i >= 0; i -= 1) {
            const item = worker.queue[i];
            if (!visible.has(item.requestId)) {
              worker.queue.splice(i, 1);
              worker.knownRequests.delete(item.requestId);
              continue;
            }
            if (Date.now() - item.lastLeaseHeartbeatMs >= retainedWorkerHeartbeatIntervalMs) {
              rc.hostBridgeLeaseHeartbeat(
                worker.capability, coordinationRootReal, item.requestPath, item.claimPath,
              );
              item.lastLeaseHeartbeatMs = Date.now();
            }
          }

          if (worker.queue.length > 0) {
            const item = worker.queue.shift();
            worker.activeRequestId = item.requestId;
            worker.lastLeaseHeartbeatMs = item.lastLeaseHeartbeatMs;
            worker.activePromise = executeRetainedWorkerRequest(worker, item)
              .catch((err) => {
                if (!isShuttingDown() && !getEngineStopRequested()) {
                  void shutdown(workerFailureSignal('APP_SERVER_WORKER_LOOP_FAILED', err));
                }
              })
              .finally(() => {
                worker.activePromise = null;
                worker.activeRequestId = null;
              });
          }

          for (const knownId of Array.from(worker.knownRequests)) {
            const stillQueued = worker.queue.some((item) => item.requestId === knownId);
            if (!visible.has(knownId) && worker.activeRequestId !== knownId && !stillQueued) {
              worker.knownRequests.delete(knownId);
            }
          }
        }

        // Yield to the event loop between workers so a pending I/O
        // completion for a DIFFERENT worker's in-flight activePromise gets
        // a chance to resume before this synchronous scan continues into
        // the next worker, rather than only after the entire loop returns.
        await asyncSleep(0);
      }
    } finally {
      setPollInFlight(false);
    }
  };

  return Object.freeze({ workerFailureSignal, generationRetired, pollRetainedWorkers });
}

module.exports = Object.freeze({ createSupervisorRetainedPolling });
