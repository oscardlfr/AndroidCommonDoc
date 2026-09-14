'use strict';

// Starts and awaits exactly one retained-worker turn: worker-presence replace, turn/start + validated completion wait, and the accepted-child startup wait.

function createWorkerTurnExecution({
  RETAINED_WORKER_HEARTBEAT_INTERVAL_MS,
  RETAINED_WORKER_POLL_INTERVAL_MS,
  STOP_SIGNAL_INTERRUPT_BOUND_MS,
  WORKER_PRESENCE_KEYS,
  WORKER_PRESENCE_LEASE_MS,
  WORKER_PRESENCE_SCHEMA,
  appendHostProjectedP2SourceEvidence,
  asyncSleep,
  buildTurnReadProjection,
  canonicalJSONStringify,
  closeTurnReadProjection,
  hasExactKeys,
  rc,
  readRegistryRecord,
  rll,
  validateTurnReadProjection,
  workerPresencePathFor,
}) {
function replaceOwnedWorkerPresence(repoDescriptor, worker, threadId) {
  const presencePath = workerPresencePathFor(repoDescriptor, worker.role, worker.workerSessionId);
  const read = readRegistryRecord(presencePath);
  if (!read.ok || read.absent || !read.obj) return { ok: false, reason: 'worker-presence-not-owned' };
  const existing = read.obj;
  if (
    !hasExactKeys(existing, WORKER_PRESENCE_KEYS)
    || existing.schema !== WORKER_PRESENCE_SCHEMA
    || existing.role !== worker.role
    || existing.worker_session_id !== worker.workerSessionId
    || existing.worktree_id !== worker.worktreeId
    || existing.role_profile_digest !== worker.profileDigest
    || existing.pid !== process.pid
    || existing.started_at !== worker.presenceStartedAt
  ) return { ok: false, reason: 'worker-presence-ownership-mismatch' };
  const now = new Date().toISOString();
  const record = {
    schema: WORKER_PRESENCE_SCHEMA,
    role: worker.role,
    worker_session_id: worker.workerSessionId,
    worktree_id: worker.worktreeId,
    thread_id: threadId,
    role_profile_digest: worker.profileDigest,
    pid: process.pid,
    started_at: worker.presenceStartedAt,
    lease_expiry: new Date(Date.now() + WORKER_PRESENCE_LEASE_MS).toISOString(),
    heartbeat_at: now,
  };
  const written = rll.writeRegistryRecordReplace(
    presencePath, Buffer.from(canonicalJSONStringify(record), 'utf8'),
  );
  if (!written.ok) return written;
  worker.lastPresenceHeartbeatMs = Date.now();
  worker.threadId = threadId;
  return { ok: true, presencePath, record };
}

function waitForValidatedTurnCompletion(connection, threadId, turnId, expectedResultKind, allowedChildRoles, deadlineMs, onHeartbeat, executionContext, stopSignal) {
  return new Promise((resolve) => {
    let settled = false;
    let heartbeatTimer = null;
    const remainingMs = deadlineMs - Date.now();
    if (remainingMs <= 0) {
      resolve({ ok: false, reason: 'backend-deadline-non-positive' });
      return;
    }
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      connection.turnInterrupt(threadId, turnId, { backendDeadlineMs: deadlineMs })
        .then((interrupted) => finish({
          ok: false,
          reason: interrupted && interrupted.ok ? 'backend-deadline-interrupted' : 'backend-deadline-interrupt-unconfirmed',
        }))
        .catch(() => finish({ ok: false, reason: 'backend-deadline-interrupt-failed' }));
    }, remainingMs);
    connection.onTurnCompleted(
      threadId, turnId, expectedResultKind, allowedChildRoles,
      (result) => finish(result), executionContext,
    );
    if (!settled && typeof onHeartbeat === 'function') {
      heartbeatTimer = setInterval(() => {
        if (settled) return;
        try {
          const heartbeat = onHeartbeat();
          if (heartbeat && heartbeat.ok === false) {
            finish({ ok: false, reason: heartbeat.reason || 'worker-heartbeat-failed' });
          }
        } catch (err) {
          finish({ ok: false, reason: 'worker-heartbeat-failed:' + String((err && err.message) || err) });
        }
      }, RETAINED_WORKER_HEARTBEAT_INTERVAL_MS);
    }
    // P1-A (section5 "one shared stop timeline"): "Connection stop must
    // resolve/reject the real current-turn waiter, not simply discard it."
    // A generic connection-level STOP (malformed frame, EOF, transport
    // error) deliberately never auto-delivers a still-pending handler
    // (C2-STOP-01's own frozen invariant) -- this is the ONE, explicit,
    // coordinator-driven cancellation channel instead: when the owning
    // engine's own stop timeline begins, race the SAME real
    // connection.turnInterrupt() the natural backend-deadline path above
    // already uses (never a detached Promise.race loser -- finish() is
    // driven by turnInterrupt's OWN settlement, exactly like the deadline
    // branch), bounded well inside the stop timeline's own join budget.
    if (!settled && stopSignal && typeof stopSignal.promise === 'object' && stopSignal.promise) {
      stopSignal.promise.then(() => {
        if (settled) return;
        connection.turnInterrupt(threadId, turnId, { backendDeadlineMs: Date.now() + STOP_SIGNAL_INTERRUPT_BOUND_MS })
          .then((interrupted) => finish({
            ok: false,
            reason: interrupted && interrupted.ok ? 'owned-shutdown-interrupted' : 'owned-shutdown-interrupt-unconfirmed',
          }))
          .catch(() => finish({ ok: false, reason: 'owned-shutdown-interrupt-failed' }));
      });
    }
  });
}

function backendDeadlineForRequest(request) {
  const expiryMs = Date.parse(request.expiry);
  return Number.isFinite(expiryMs) ? expiryMs - 20000 : NaN;
}
async function startAndAwaitWorkerTurn(worker, item, inputText, allowedChildRoles, deadlineMs, acceptedChildren, executionContext, turnOptions) {
  const projection = buildTurnReadProjection(worker, item, acceptedChildren || []);
  if (!projection.ok) {
    const closed = closeTurnReadProjection(worker);
    return closed.ok ? projection : { ok: false, reason: projection.reason + ';' + closed.reason };
  }
  const projectionPreflight = validateTurnReadProjection(worker, projection);
  if (!projectionPreflight.ok) {
    const closed = closeTurnReadProjection(worker);
    return closed.ok ? projectionPreflight : { ok: false, reason: projectionPreflight.reason + ';' + closed.reason };
  }
  let effectiveInputText;
  try {
    effectiveInputText = appendHostProjectedP2SourceEvidence(worker, item, inputText, projection);
  } catch (err) {
    const closed = closeTurnReadProjection(worker);
    const failure = { ok: false, reason: (err && err.message) || 'host-source-evidence-failed' };
    return closed.ok ? failure : { ok: false, reason: failure.reason + ';' + closed.reason };
  }
  const turn = await worker.connection.turnStart({
    threadId: worker.threadId,
    inputText: effectiveInputText,
    expectedResultKind: item.expectedResultKind,
    allowedChildRoles,
    executionContext,
    cwd: worker.cwd,
  }, { backendDeadlineMs: deadlineMs });
  if (!turn || turn.ok !== true) {
    const failure = { ok: false, reason: (turn && turn.reason) || 'turn-start-failed' };
    const closed = closeTurnReadProjection(worker);
    return closed.ok ? failure : { ok: false, reason: failure.reason + ';' + closed.reason };
  }
  // The delivery commit point is the app-server's accepted `turn/start`
  // response, not the later model completion.  Publish it immediately after
  // that response and before waiting; otherwise a slow turn would remain
  // falsely pre-commit and could be treated as safely retryable.
  if (!item.deliveryRecorded) {
    rc.hostBridgeRecordTurnStartAccepted(
      worker.capability, worker.coordinationRoot, item.requestPath, item.claimPath, turn.turnId,
    );
    item.deliveryRecorded = true;
  }
  const completion = await waitForValidatedTurnCompletion(
    worker.connection, worker.threadId, turn.turnId,
    item.expectedResultKind, allowedChildRoles, deadlineMs,
    () => {
      if (!turnOptions || turnOptions.requestLeaseHeartbeat !== false) {
        rc.hostBridgeLeaseHeartbeat(
          worker.capability, worker.coordinationRoot, item.requestPath, item.claimPath,
        );
        item.lastLeaseHeartbeatMs = Date.now();
        worker.lastLeaseHeartbeatMs = item.lastLeaseHeartbeatMs;
      }
      const presence = replaceOwnedWorkerPresence(worker.repoDescriptor, worker, worker.threadId);
      if (!presence.ok) return presence;
      return { ok: true };
    }, executionContext, worker.stopSignal,
  );
  if (!completion.ok) {
    const closed = closeTurnReadProjection(worker);
    return closed.ok ? completion : { ok: false, reason: completion.reason + ';' + closed.reason };
  }
  const projectionValidation = validateTurnReadProjection(worker, projection);
  if (!projectionValidation.ok) {
    const closed = closeTurnReadProjection(worker);
    return closed.ok ? projectionValidation : { ok: false, reason: projectionValidation.reason + ';' + closed.reason };
  }
  return Object.assign({}, completion, { turnId: turn.turnId });
}

async function waitForAcceptedChild(worker, item, childRequestPath, deadlineMs) {
  for (;;) {
    if (Date.now() >= deadlineMs) return { ok: false, reason: 'child-consultation-deadline' };
    // A sibling context-provider may be serving this exact child through a
    // raw MCP stdio round trip.  Observing the child result performs secure
    // synchronous registry reads (native DACL proofs on Windows), so defer
    // those reads while the coordinator reports raw MCP in flight.  The
    // absolute child deadline remains authoritative and is checked on every
    // pass; this only yields event-loop capacity to already-admitted work.
    if (typeof worker.hasPendingRawMcpPromise === 'function' && worker.hasPendingRawMcpPromise()) {
      await asyncSleep(RETAINED_WORKER_POLL_INTERVAL_MS);
      continue;
    }
    const observed = rc.hostBridgeObserveChildResult(
      worker.capability, worker.coordinationRoot, childRequestPath,
    );
    if (observed.ready) {
      if (observed.status !== 'ANSWERED') return { ok: false, reason: 'child-consultation-blocked' };
      return observed;
    }
    if (Date.now() - worker.lastLeaseHeartbeatMs >= RETAINED_WORKER_HEARTBEAT_INTERVAL_MS) {
      rc.hostBridgeLeaseHeartbeat(
        worker.capability, worker.coordinationRoot, item.requestPath, item.claimPath,
      );
      worker.lastLeaseHeartbeatMs = Date.now();
    }
    if (Date.now() - worker.lastPresenceHeartbeatMs >= RETAINED_WORKER_HEARTBEAT_INTERVAL_MS) {
      const heartbeat = replaceOwnedWorkerPresence(worker.repoDescriptor, worker, worker.threadId);
      if (!heartbeat.ok) return { ok: false, reason: heartbeat.reason };
    }
    await asyncSleep(RETAINED_WORKER_POLL_INTERVAL_MS);
  }
}

  return Object.freeze({
    backendDeadlineForRequest,
    replaceOwnedWorkerPresence,
    startAndAwaitWorkerTurn,
    waitForAcceptedChild,
    waitForValidatedTurnCompletion,
  });
}

module.exports = Object.freeze({ createWorkerTurnExecution });
