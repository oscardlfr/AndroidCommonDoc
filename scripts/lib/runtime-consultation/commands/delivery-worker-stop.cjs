'use strict';

// `record-delivery`/`worker-stop`/`worker-stop-ack` command controllers.

function createDeliveryWorkerStopCommands({
  CliError,
  DELIVERY_V1_FIELDS,
  DRIVER_ENUM,
  STOP_ACK_V1_FIELDS,
  STOP_V2_FIELDS,
  assertClosedShape,
  assertHexId,
  assertSafeSegment,
  assertStopCorrelationTriple,
  canonicalJSONStringify,
  deliveryPathFor,
  genId128,
  isoPlusSeconds,
  nowIso,
  path,
  planRootFromArtifact,
  publishNoClobber,
  readRequestForTxnOrCorrelationInvalid,
  requireFlags,
  resolveAbsolute,
  resolveAuthoritativeAttempt,
  stopAckPathFor,
  stopPathFor,
  validateStopV2,
}) {
// ─────────────────────────────────────────────────────────────────────────────
// `record-delivery` (PLAN.md ~L763, ~L870-881) -- publish the branch-owned
// `delivery/v1` record; enforce the driver/commit-point/outcome compatibility
// table. Rejected for either Codex branch or `noop` (PLAN.md ~L779): only
// requester-owned accelerators may call this CLI themselves.
// ─────────────────────────────────────────────────────────────────────────────

const REQUESTER_OWNED_DRIVERS = new Set(['claude-sendmessage', 'claude-agent', 'runtime-spawn']);

/** Driver -> its own "crossed the commit point" token (PLAN.md ~L872-881). */
const DRIVER_CROSSED_COMMIT_POINT = {
  'claude-sendmessage': 'sendmessage-returned',
  'claude-agent': 'agent-start-observed',
  'codex-app-server': 'turn-start-accepted',
  'codex-mcp': 'turn-start-accepted',
  'runtime-spawn': 'wake-helper-returned',
};

const COMMIT_POINT_ENUM = [
  'sendmessage-returned', 'agent-start-observed', 'turn-start-accepted', 'wake-helper-returned', 'none',
];
// The CLI token `noop` is legal argv shape only for the noop driver (PLAN.md
// ~L881) -- which is itself rejected below before this enum's 'noop' member
// could ever reach the compatibility-table mapping.
const RECORD_DELIVERY_OUTCOME_ENUM = ['possibly-delivered', 'confirmed-failed-before-commit', 'noop'];

function cmdRecordDelivery(flags) {
  requireFlags(flags, ['coordination-root', 'request', 'attempt', 'epoch', 'driver', 'outcome', 'commit-point']);
  const requestPath = resolveAbsolute(flags.request);
  const txnDir = path.dirname(requestPath);
  const reqObj = readRequestForTxnOrCorrelationInvalid(txnDir);

  if (!DRIVER_ENUM.includes(flags.driver)) {
    throw new CliError('USAGE_ERROR', 'INVALID_ARGUMENT', 'invalid --driver: ' + flags.driver);
  }
  if (!RECORD_DELIVERY_OUTCOME_ENUM.includes(flags.outcome)) {
    throw new CliError('USAGE_ERROR', 'INVALID_ARGUMENT', 'invalid --outcome: ' + flags.outcome);
  }
  if (!COMMIT_POINT_ENUM.includes(flags['commit-point'])) {
    throw new CliError('USAGE_ERROR', 'INVALID_ARGUMENT', 'invalid --commit-point: ' + flags['commit-point']);
  }
  const epoch = Number.parseInt(flags.epoch, 10);
  if (!Number.isInteger(epoch) || epoch < 0 || String(epoch) !== flags.epoch) {
    throw new CliError('USAGE_ERROR', 'INVALID_ARGUMENT', '--epoch must be a non-negative integer');
  }
  assertHexId(flags.attempt, '--attempt');

  // Requester `record-delivery` is rejected for either Codex branch or noop
  // (PLAN.md ~L779) -- only requester-owned accelerators may call this CLI
  // themselves; the trusted bridge/core write those branches' own delivery.
  if (!REQUESTER_OWNED_DRIVERS.has(flags.driver)) {
    throw new CliError('INVALID', 'INVALID_ARGUMENT', 'record-delivery is rejected for driver: ' + flags.driver);
  }

  const auth = resolveAuthoritativeAttempt(reqObj, txnDir);
  if (flags.attempt !== auth.attemptId || epoch !== auth.leaseEpoch) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'record-delivery attempt/epoch is not the current authoritative pair');
  }

  const crossedToken = DRIVER_CROSSED_COMMIT_POINT[flags.driver];
  const commitPointCli = flags['commit-point'];
  const outcomeCli = flags.outcome;
  let commitPointJson;
  let outcomeJson;
  let delivered;
  if (commitPointCli === crossedToken) {
    if (outcomeCli !== 'possibly-delivered') {
      throw new CliError('INVALID', 'CORRELATION_INVALID', 'driver/commit-point/outcome tuple does not match the frozen compatibility table');
    }
    commitPointJson = crossedToken;
    outcomeJson = 'possibly-delivered';
    delivered = true;
  } else if (commitPointCli === 'none') {
    if (outcomeCli !== 'possibly-delivered' && outcomeCli !== 'confirmed-failed-before-commit') {
      throw new CliError('INVALID', 'CORRELATION_INVALID', 'driver/commit-point/outcome tuple does not match the frozen compatibility table');
    }
    commitPointJson = null;
    outcomeJson = outcomeCli;
    delivered = false;
  } else {
    throw new CliError('INVALID', 'CORRELATION_INVALID', 'commit-point is not valid for driver: ' + flags.driver);
  }

  // detail_code inference (no PLAN range read for this task pins this field's
  // exact CLI-argv mapping): confirmed-failure carries its own named diagnostic;
  // an uncrossed ("none") possibly-delivered outcome is the ambiguous-before-
  // commit case; a cleanly-crossed possibly-delivered outcome carries no
  // diagnostic (NONE).
  let deliveryDetailCode;
  if (outcomeJson === 'confirmed-failed-before-commit') {
    deliveryDetailCode = 'CONFIRMED_PRECOMMIT_FAILURE';
  } else if (outcomeJson === 'possibly-delivered' && commitPointJson === null) {
    deliveryDetailCode = 'AMBIGUOUS_BEFORE_COMMIT';
  } else {
    deliveryDetailCode = 'NONE';
  }

  const now = nowIso();
  const deliveryObj = {
    schema: 'coordination/delivery/v1',
    request_id: reqObj.request_id,
    attempt_id: flags.attempt,
    lease_epoch: epoch,
    driver: flags.driver,
    claim_digest: null,
    commit_point: commitPointJson,
    commit_point_at: commitPointJson === null ? null : now,
    created_at: now,
    delivered,
    outcome: outcomeJson,
    detail_code: deliveryDetailCode,
  };
  assertClosedShape(deliveryObj, DELIVERY_V1_FIELDS);
  const deliveryPath = deliveryPathFor(txnDir, flags.attempt);
  publishNoClobber(deliveryPath, Buffer.from(canonicalJSONStringify(deliveryObj), 'utf8'), { allowIdenticalIdempotent: true });
  return { request_id: reqObj.request_id, artifact_ref: deliveryPath };
}

// ─────────────────────────────────────────────────────────────────────────────
// `worker-stop` (PLAN.md ~L772, record #12 `stop/v2` field table ~L506-519) --
// mint a new stop_id and publish exact stop correlation.
// ─────────────────────────────────────────────────────────────────────────────

function cmdWorkerStop(flags) {
  requireFlags(flags, ['coordination-root', 'role', 'worker-session', 'kind']);
  const coordRoot = resolveAbsolute(flags['coordination-root']);
  const kind = flags.kind;
  if (kind !== 'transaction' && kind !== 'session-shutdown') {
    throw new CliError('USAGE_ERROR', 'INVALID_ARGUMENT', 'invalid --kind: ' + kind);
  }
  if (kind === 'transaction' && !('request' in flags)) {
    throw new CliError('USAGE_ERROR', 'MISSING_ARGUMENT', '--request is required for --kind transaction');
  }
  if (kind === 'session-shutdown' && ('request' in flags)) {
    throw new CliError('USAGE_ERROR', 'INVALID_ARGUMENT', '--request is not valid for --kind session-shutdown');
  }
  assertSafeSegment(flags.role, '--role');
  assertSafeSegment(flags['worker-session'], '--worker-session');

  const now = nowIso();
  const stopId = genId128();
  let base;
  let requestId = null;
  let attemptId = null;
  let leaseEpoch = null;

  if (kind === 'transaction') {
    const requestPath = resolveAbsolute(flags.request);
    const txnDir = path.dirname(requestPath);
    const reqObj = readRequestForTxnOrCorrelationInvalid(txnDir);
    const auth = resolveAuthoritativeAttempt(reqObj, txnDir);
    base = planRootFromArtifact(coordRoot, requestPath);
    requestId = reqObj.request_id;
    attemptId = auth.attemptId;
    leaseEpoch = auth.leaseEpoch;
  } else {
    // session-shutdown carries no request reference at all (Frozen CLI ABI:
    // "--request <path> only for transaction") -- there is no argv-supplied plan
    // identity to derive a plan-root from, and the ABI forbids inventing a new
    // flag ("no WP2 naming latitude"). A session shutdown is not scoped to one
    // plan/wave, so its stop tree lives directly under coordination_root instead
    // of a specific plan-root -- a considered inference, not a literal PLAN quote.
    base = coordRoot;
  }

  const stopObj = {
    schema: 'coordination/stop/v2',
    stop_id: stopId,
    kind,
    target_role: flags.role,
    worker_session_id: flags['worker-session'],
    request_id: requestId,
    attempt_id: attemptId,
    lease_epoch: leaseEpoch,
    expiry: isoPlusSeconds(now, 300),
    requested_at: now,
  };
  assertClosedShape(stopObj, STOP_V2_FIELDS);
  assertStopCorrelationTriple(stopObj);
  const stopPath = stopPathFor(base, flags.role, flags['worker-session'], stopId);
  publishNoClobber(stopPath, Buffer.from(canonicalJSONStringify(stopObj), 'utf8'));
  return { request_id: requestId, artifact_ref: stopPath };
}

// ─────────────────────────────────────────────────────────────────────────────
// `worker-stop-ack` (PLAN.md ~L773, record #12's ack sibling ~L519) -- publish
// one per-stop immutable acknowledgement.
// ─────────────────────────────────────────────────────────────────────────────

const STOP_ACK_DISPOSITION_ENUM = ['exact-transaction', 'stale', 'unrelated', 'session-shutdown'];

function cmdWorkerStopAck(flags) {
  requireFlags(flags, ['coordination-root', 'stop', 'disposition']);
  if (!STOP_ACK_DISPOSITION_ENUM.includes(flags.disposition)) {
    throw new CliError('USAGE_ERROR', 'INVALID_ARGUMENT', 'invalid --disposition: ' + flags.disposition);
  }
  const stopPath = resolveAbsolute(flags.stop);
  const stopObj = validateStopV2(stopPath);

  const ackObj = {
    schema: 'coordination/stop-ack/v1',
    stop_id: stopObj.stop_id,
    worker_session_id: stopObj.worker_session_id,
    disposition: flags.disposition,
    acked_at: nowIso(),
  };
  assertClosedShape(ackObj, STOP_ACK_V1_FIELDS);
  const ackPath = stopAckPathFor(stopPath, stopObj.stop_id);
  publishNoClobber(ackPath, Buffer.from(canonicalJSONStringify(ackObj), 'utf8'));
  return { request_id: stopObj.request_id, artifact_ref: ackPath };
}

  return Object.freeze({
    COMMIT_POINT_ENUM,
    DRIVER_CROSSED_COMMIT_POINT,
    RECORD_DELIVERY_OUTCOME_ENUM,
    REQUESTER_OWNED_DRIVERS,
    STOP_ACK_DISPOSITION_ENUM,
    cmdRecordDelivery,
    cmdWorkerStop,
    cmdWorkerStopAck,
  });
}

module.exports = { createDeliveryWorkerStopCommands };
