'use strict';

function createAuthorityProtocol(deps) {
  const {
    path,
    DRIVER_ENUM,
    planRootFromArtifact,
    transactionDir,
    takeoverPathFor,
    readJsonDurable,
    readJsonDurableOptional,
    readClosedRecord,
    withLock,
    assertLockedScopeIdentity,
    readCanonicalRequestRecord,
    validateTakeoverBinding,
    assertClosedShape,
    isHexId,
    isHex64,
    isNonEmptyString,
    isNonNegativeInteger,
    isIsoTimestamp,
    isEnum,
    orNull,
    isBoolean,
    CliError,
  } = deps;

// `activation` (record #2b) -- field table PLAN.md ~L318-336. Written first-
// writer-wins BEFORE claim (#3) and initial `inbox-ref/v1` exposure (Ordered
// Runtime Loop step 6).
// ─────────────────────────────────────────────────────────────────────────────

const ACTIVATION_V1_FIELDS = {
  schema: { check: (v) => v === 'coordination/activation/v1' },
  version: { check: (v) => v === 1 },
  request_id: { check: isHexId },
  request_digest: { check: isHex64 },
  attempt_id: { check: isHexId },
  lease_epoch: { check: isNonNegativeInteger },
  target_role_profile_digest: { check: isHex64 },
  routing_policy_version: { check: isNonEmptyString },
  routing_policy_digest: { check: isHex64 },
  selected_driver: { check: isEnum(DRIVER_ENUM) },
  native_target_binding_id: { check: orNull(isNonEmptyString) },
  native_spawn_action_id: { check: orNull(isNonEmptyString) },
  created_at: { check: isIsoTimestamp },
  activation_liveness_expiry: { check: isIsoTimestamp },
};

function validateActivationV1(artifactPath) {
  const obj = readJsonDurable(artifactPath);
  assertClosedShape(obj, ACTIVATION_V1_FIELDS);
  // DUR-J item 4: durability + fd-bound identity are proven inside readJsonDurable(artifactPath)
  // above; the old path-based `assertDurable` after a by-path read was a TOCTOU and is gone.
  return obj;
}

// ─────────────────────────────────────────────────────────────────────────────
// Attempt Authority resolution (PLAN.md ~L700-704) -- shared by validate + state ops
// ─────────────────────────────────────────────────────────────────────────────

function readRequestForTxnOrCorrelationInvalid(txnDir) {
  // DUR-J: fd-bound durable read -- a genuinely absent request stays CORRELATION_INVALID;
  // an nlink==2 window / symlink / foreign-owner / malformed request now STOPs
  // (DURABILITY_UNPROVEN / SECURITY_INVALID / SCHEMA_INVALID), never read raw.
  // Codex P1-2: closed-shape (CONSULT_V2_FIELDS) is enforced HERE, the single choke
  // point every caller (claim, lease-heartbeat, takeover, cancel, record-delivery,
  // worker-stop, await-result, ...) shares. Round 3 (blocker 1): routed through
  // readCanonicalRequestRecord -- the request's OWN embedded request_id must equal
  // this transaction directory's own name (the canonical identity its storage
  // location implies), not merely be well-formed CONSULT_V2_FIELDS JSON.
  return readCanonicalRequestRecord(path.join(txnDir, 'request.json'), path.basename(txnDir), {
    absentDetail: 'CORRELATION_INVALID',
    absentMessage: 'referenced request.json does not resolve',
  }).obj;
}

function readTakeoverIfValid(txnDir, reqObj) {
  const takeoverPath = takeoverPathFor(txnDir);
  // DUR-J: fd-bound durable read. A genuinely ABSENT takeover (ENOENT) returns null
  // -> the initial attempt is authoritative (the one legitimate fallback). The
  // nlink==2 in-flight window, a symlink swap, a foreign-owner/other-writable plant,
  // an oversize file, or malformed JSON is NEVER silently downgraded to "absent":
  // readJsonDurableOptional THROWS (DURABILITY_UNPROVEN / SECURITY_INVALID /
  // SCHEMA_INVALID) and that STOP propagates -- an in-flight/tampered takeover can no
  // longer masquerade as "no takeover" and let a superseded attempt keep authority.
  const to = readJsonDurableOptional(takeoverPath);
  if (to === null) return null;
  // AUTH-01/02/03 correction: a DURABLE takeover.json is no longer trusted on a
  // partial shape-only check. The full binding validator (shared with the explicit
  // `validate --kind takeover-v1` path) is called here and THROWS (STOP) on ANY
  // mismatch -- wrong shape, cross-request, wrong superseded attempt/epoch, or an
  // inconsistent reason/eligibility_kind pairing. PLAN.md ~L702 ("otherwise invalid
  // (STOP)") is now the ACTUAL behavior, not merely a DUR-J-deferred boundary note:
  // an invalid takeover can neither supersede the initial attempt NOR be silently
  // ignored as if it never existed.
  return validateTakeoverBinding(to, reqObj);
}

/**
 * Authoritative-attempt resolution, exact rule (PLAN.md ~L702): if a schema-valid
 * `takeover.json` exists for this transaction, its `new_attempt_id`/`new_lease_epoch`
 * are authoritative; otherwise the request's frozen `initial_attempt_id`/
 * `initial_lease_epoch` are authoritative.
 */
function resolveAuthoritativeAttempt(reqObj, txnDir) {
  const to = readTakeoverIfValid(txnDir, reqObj);
  if (to) {
    return { attemptId: to.new_attempt_id, leaseEpoch: to.new_lease_epoch, takeover: to };
  }
  return { attemptId: reqObj.initial_attempt_id, leaseEpoch: reqObj.initial_lease_epoch, takeover: null };
}

// ─────────────────────────────────────────────────────────────────────────────
// `claim` (record #3) -- field table PLAN.md ~L338-354
// ─────────────────────────────────────────────────────────────────────────────

const CLAIM_V1_FIELDS = {
  schema: { check: (v) => v === 'coordination/claim/v1' },
  request_id: { check: isHexId },
  attempt_id: { check: isHexId },
  lease_epoch: { check: isNonNegativeInteger },
  claimant_role: { check: isNonEmptyString },
  claimant_worktree_id: { check: isNonEmptyString },
  claimant_instance_id: { check: isNonEmptyString },
  worker_session_id: { required: false, check: orNull(isNonEmptyString) },
  target_role_profile_digest: { check: isHex64 },
  driver: { check: isNonEmptyString },
  created_at: { check: isIsoTimestamp },
};

function validateClaimV1(artifactPath, coordRoot) {
  const obj = readJsonDurable(artifactPath);
  assertClosedShape(obj, CLAIM_V1_FIELDS);
  // DUR-J item 4: durability + fd-bound identity are proven inside readJsonDurable(artifactPath)
  // above; the old path-based `assertDurable` after a by-path read was a TOCTOU and is gone.
  const planRoot = planRootFromArtifact(coordRoot, artifactPath);
  const txnDir = transactionDir(planRoot, obj.request_id);
  const reqObj = readRequestForTxnOrCorrelationInvalid(txnDir);
  const auth = resolveAuthoritativeAttempt(reqObj, txnDir);
  if (obj.attempt_id !== auth.attemptId || obj.lease_epoch !== auth.leaseEpoch) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'claim attempt/epoch is not the current authoritative pair');
  }
  return obj;
}

// ─────────────────────────────────────────────────────────────────────────────
// `active-lease` (record #4) -- field table PLAN.md ~L358-373
// ─────────────────────────────────────────────────────────────────────────────

const ACTIVE_LEASE_V1_FIELDS = {
  schema: { check: (v) => v === 'coordination/active-lease/v1' },
  attempt_id: { check: isHexId },
  lease_epoch: { check: isNonNegativeInteger },
  holder_role: { check: isNonEmptyString },
  claimant_instance_id: { check: isNonEmptyString },
  worker_session_id: { required: false, check: orNull(isNonEmptyString) },
  claim_digest: { check: isHex64 },
  ttl_seconds: { check: isNonNegativeInteger },
  heartbeat_interval_seconds: { check: isNonNegativeInteger },
  last_heartbeat_at: { check: isIsoTimestamp },
  lease_expiry: { check: isIsoTimestamp },
  created_at: { check: isIsoTimestamp },
};

/**
 * Section 4: active-lease is the ONE mutable record (replaced in place via
 * publishReplace, never no-clobber-published) -- reading it durably requires the
 * SAME transition lock a writer holds, exactly like cmdLeaseHeartbeat's own
 * immutablePath:false read. An orphaned or poisoned lock (a writer crashed or
 * hung mid-replace) must timeout+STOP here too: the visible bytes alone -- even
 * a clean nlink==1 regular file -- are never sufficient proof, since a writer
 * that reached POST_RENAME_UNPROVEN can leave EXACTLY that shape behind with
 * the lock still held as the honest "unproven" signal. This validator must
 * never read past that signal and accept the visible lease as durable.
 */
function validateActiveLeaseV1(artifactPath, coordRoot) {
  const txnDir = path.dirname(path.dirname(artifactPath));
  return withLock(txnDir, coordRoot, (lockToken) => {
    // Codex NO-GO round 15 ("el lector mutable de lease" / "los cinco callers
    // del lock"): withLock's own entry/exit checks bracket this ENTIRE
    // callback, which cannot catch an ABA -- txnDir swapped away, this read
    // happening against the substitute, txnDir swapped back before withLock's
    // own post-fn check runs. A fresh scope check immediately before the read
    // shrinks that window to the minimum (the same discipline every other
    // hardened caller in this file now applies at its own sensitive
    // operation, not just at withLock's own bracket).
    assertLockedScopeIdentity(lockToken);
    const rec = readClosedRecord(artifactPath, ACTIVE_LEASE_V1_FIELDS, { immutablePath: false, lockToken: lockToken });
    return rec.obj;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// `activation-intent` WAL (record #5b) -- field table PLAN.md ~L394-408
// ─────────────────────────────────────────────────────────────────────────────

const ACTIVATION_INTENT_V1_FIELDS = {
  schema: { check: (v) => v === 'coordination/activation-intent/v1' },
  request_digest: { check: isHex64 },
  attempt_id: { check: isHexId },
  lease_epoch: { check: isNonNegativeInteger },
  driver: { check: isNonEmptyString },
  commit_point_pending: { check: (v) => v === true },
  created_at: { check: isIsoTimestamp },
};

function validateActivationIntentV1(artifactPath) {
  const obj = readJsonDurable(artifactPath);
  assertClosedShape(obj, ACTIVATION_INTENT_V1_FIELDS);
  return obj;
}

// ─────────────────────────────────────────────────────────────────────────────
// `delivery` (record #5) -- field table PLAN.md ~L375-392 (shape-only, WP1 subset)
// ─────────────────────────────────────────────────────────────────────────────

const DELIVERY_V1_FIELDS = {
  schema: { check: (v) => v === 'coordination/delivery/v1' },
  request_id: { check: isHexId },
  attempt_id: { check: isHexId },
  lease_epoch: { check: isNonNegativeInteger },
  driver: { check: isNonEmptyString },
  claim_digest: { check: orNull(isHex64) },
  commit_point: { check: orNull(isNonEmptyString) },
  commit_point_at: { check: orNull(isIsoTimestamp) },
  created_at: { check: isIsoTimestamp },
  delivered: { check: isBoolean },
  outcome: { check: orNull(isEnum(['possibly-delivered', 'confirmed-failed-before-commit'])) },
  detail_code: { check: isEnum(['NONE', 'CONFIRMED_PRECOMMIT_FAILURE', 'AMBIGUOUS_BEFORE_COMMIT']) },
};

function validateDeliveryV1(artifactPath) {
  const obj = readJsonDurable(artifactPath);
  assertClosedShape(obj, DELIVERY_V1_FIELDS);
  return obj;
}

// ─────────────────────────────────────────────────────────────────────────────

  return {
    ACTIVATION_V1_FIELDS,
    validateActivationV1,
    readRequestForTxnOrCorrelationInvalid,
    readTakeoverIfValid,
    resolveAuthoritativeAttempt,
    CLAIM_V1_FIELDS,
    validateClaimV1,
    ACTIVE_LEASE_V1_FIELDS,
    validateActiveLeaseV1,
    ACTIVATION_INTENT_V1_FIELDS,
    validateActivationIntentV1,
    DELIVERY_V1_FIELDS,
    validateDeliveryV1,
  };
}

module.exports = { createAuthorityProtocol };
