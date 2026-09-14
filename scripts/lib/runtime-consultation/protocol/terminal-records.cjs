'use strict';

function createTerminalRecordsProtocol(deps) {
  const {
    path,
    CliError,
    readJsonDurable,
    readRequestForTxnOrCorrelationInvalid,
    assertClosedShape,
    isHexId,
    isIsoTimestamp,
    isNonEmptyString,
    isNonNegativeInteger,
    isPlainObject,
    isEnum,
    orNull,
  } = deps;

// `conflict` diagnostic (record #10, `conflict/v1`) -- field table PLAN.md ~L478-482
// ─────────────────────────────────────────────────────────────────────────────

const CONFLICT_V1_FIELDS = {
  schema: { check: (v) => v === 'coordination/conflict/v1' },
  attempt_id: { check: isHexId },
  other_attempt_id: { check: isHexId },
  detected_at: { check: isIsoTimestamp },
};

function validateConflictV1(artifactPath) {
  const obj = readJsonDurable(artifactPath);
  assertClosedShape(obj, CONFLICT_V1_FIELDS);
  // DUR-J item 4: durability + fd-bound identity are proven inside readJsonDurable(artifactPath)
  // above; the old path-based `assertDurable` after a by-path read was a TOCTOU and is gone.
  return obj;
}

// ─────────────────────────────────────────────────────────────────────────────
// `takeover` (record #11) -- field table PLAN.md ~L486-502
// ─────────────────────────────────────────────────────────────────────────────

const TAKEOVER_V1_FIELDS = {
  schema: { check: (v) => v === 'coordination/takeover/v1' },
  request_id: { check: isHexId },
  new_attempt_id: { check: isHexId },
  new_lease_epoch: { check: isNonNegativeInteger },
  superseded_attempt_id: { check: isHexId },
  reason: { check: isEnum(['lease-expired', 'confirmed-failed-before-commit']) },
  eligibility_kind: {
    check: isEnum(['activation-liveness-expired', 'claim-no-lease-expired', 'active-lease-expired', 'confirmed-failed-before-commit']),
  },
  eligibility_snapshot: { check: isPlainObject },
  eligibility_deadline: { check: orNull(isIsoTimestamp) },
  eligibility_observed_at: { check: isIsoTimestamp },
  takeover_at: { check: isIsoTimestamp },
};

/**
 * Full takeover binding validation (PLAN.md ~L700-712, WP3 AUTH-01/02/03
 * correction: "otherwise invalid (STOP)"). Shared by the explicit `validate
 * --kind takeover-v1` entry point (validateTakeoverV1 below) AND the implicit
 * authority-resolution trust path (readTakeoverIfValid) so neither can silently
 * drift from the other's rules -- a durable-but-invalid takeover.json is REJECTED
 * here, never downgraded to "no takeover" by either caller.
 *
 * Checks, in order: closed shape; request correlation; new_attempt_id differs
 * from superseded_attempt_id; epoch strictly increases from the request-frozen
 * baseline (SCHEMA_INVALID, pre-existing SCHEMA-TAKEOVER-01 contract, unchanged);
 * THEN the AUTH-03/04 binding layer this correction adds -- superseded_attempt_id
 * must be the request's OWN initial_attempt_id (not merely "a" prior attempt),
 * and new_lease_epoch must be EXACTLY initial_lease_epoch+1, never merely
 * "greater than" -- there is exactly one legitimate takeover per transaction
 * (computeTakeoverEligibility's own no-clobber existence check enforces this),
 * so no other epoch value is ever correct; finally reason/eligibility_kind must
 * be an internally consistent pairing (cmdTakeover itself never produces any
 * other combination).
 */
function validateTakeoverBinding(obj, reqObj) {
  assertClosedShape(obj, TAKEOVER_V1_FIELDS);
  if (obj.request_id !== reqObj.request_id) {
    throw new CliError('INVALID', 'CORRELATION_INVALID', 'takeover request_id does not match this transaction');
  }
  if (obj.new_attempt_id === obj.superseded_attempt_id) {
    throw new CliError('INVALID', 'SCHEMA_INVALID', 'new_attempt_id must differ from superseded_attempt_id');
  }
  if (!(obj.new_lease_epoch > reqObj.initial_lease_epoch)) {
    throw new CliError('INVALID', 'SCHEMA_INVALID', 'new_lease_epoch must be strictly greater than the superseded epoch');
  }
  if (obj.superseded_attempt_id !== reqObj.initial_attempt_id) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', "takeover superseded_attempt_id does not match the request's own initial_attempt_id");
  }
  if (obj.new_lease_epoch !== reqObj.initial_lease_epoch + 1) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'takeover new_lease_epoch is not exactly the one legitimate successor epoch');
  }
  const expectedReason = obj.eligibility_kind === 'confirmed-failed-before-commit' ? 'confirmed-failed-before-commit' : 'lease-expired';
  if (obj.reason !== expectedReason) {
    throw new CliError('INVALID', 'SCHEMA_INVALID', 'takeover reason does not match its own eligibility_kind');
  }
  return obj;
}

function validateTakeoverV1(artifactPath) {
  const obj = readJsonDurable(artifactPath);
  // DUR-J item 4: durability + fd-bound identity are proven inside readJsonDurable(artifactPath)
  // above; the old path-based `assertDurable` after a by-path read was a TOCTOU and is gone.
  const txnDir = path.dirname(artifactPath);
  const reqObj = readRequestForTxnOrCorrelationInvalid(txnDir);
  return validateTakeoverBinding(obj, reqObj);
}

// ─────────────────────────────────────────────────────────────────────────────
// `stop` (record #12, `stop/v2`) + `stop-ack/v1` -- field tables PLAN.md ~L506-519
// ─────────────────────────────────────────────────────────────────────────────

const HEX128_RE = /^[a-f0-9]{32}$/;

const STOP_V2_FIELDS = {
  schema: { check: (v) => v === 'coordination/stop/v2' },
  stop_id: { check: (v) => typeof v === 'string' && HEX128_RE.test(v) },
  kind: { check: isEnum(['transaction', 'session-shutdown']) },
  target_role: { check: isNonEmptyString },
  worker_session_id: { check: isNonEmptyString },
  request_id: { check: orNull(isHexId) },
  attempt_id: { check: orNull(isHexId) },
  lease_epoch: { check: orNull(isNonNegativeInteger) },
  expiry: { check: isIsoTimestamp },
  requested_at: { check: isIsoTimestamp },
};

/**
 * Whole-object cross-field rule (PLAN.md ~L515): request_id/attempt_id/lease_epoch
 * are all required (non-null) for `kind:"transaction"` and all null for
 * `kind:"session-shutdown"` -- epoch alone is never sufficient.
 */
function assertStopCorrelationTriple(obj) {
  const allNull = obj.request_id === null && obj.attempt_id === null && obj.lease_epoch === null;
  const allSet = obj.request_id !== null && obj.attempt_id !== null && obj.lease_epoch !== null;
  if (obj.kind === 'transaction' && !allSet) {
    throw new CliError('INVALID', 'SCHEMA_INVALID', 'transaction stop requires request_id/attempt_id/lease_epoch all set');
  }
  if (obj.kind === 'session-shutdown' && !allNull) {
    throw new CliError('INVALID', 'SCHEMA_INVALID', 'session-shutdown stop requires request_id/attempt_id/lease_epoch all null');
  }
}

function validateStopV2(artifactPath) {
  const obj = readJsonDurable(artifactPath);
  assertClosedShape(obj, STOP_V2_FIELDS);
  assertStopCorrelationTriple(obj);
  // DUR-J item 4: durability + fd-bound identity are proven inside readJsonDurable(artifactPath)
  // above; the old path-based `assertDurable` after a by-path read was a TOCTOU and is gone.
  return obj;
}

const STOP_ACK_V1_FIELDS = {
  schema: { check: (v) => v === 'coordination/stop-ack/v1' },
  stop_id: { check: (v) => typeof v === 'string' && HEX128_RE.test(v) },
  worker_session_id: { check: isNonEmptyString },
  disposition: { check: isEnum(['exact-transaction', 'stale', 'unrelated', 'session-shutdown']) },
  acked_at: { check: isIsoTimestamp },
};


  return {
    CONFLICT_V1_FIELDS,
    validateConflictV1,
    TAKEOVER_V1_FIELDS,
    validateTakeoverBinding,
    validateTakeoverV1,
    HEX128_RE,
    STOP_V2_FIELDS,
    assertStopCorrelationTriple,
    validateStopV2,
    STOP_ACK_V1_FIELDS,
  };
}

module.exports = { createTerminalRecordsProtocol };
