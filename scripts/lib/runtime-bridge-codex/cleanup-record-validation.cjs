'use strict';

function createCleanupRecordValidation({
  path,
  rc,
  registryRepoDir,
  readDurableRegistryRecordFd,
  REGISTRY_RECORD_MAX_BYTES,
  SPAWN_FAILED_REASON_ENUM,
  hasExactKeys,
  isCoreGeneratedIdentifier,
  isCanonicalIsoUtcTimestamp,
  isValidDevInoValue,
  CANONICAL_NONNEGATIVE_DECIMAL_STRING_PATTERN,
  IDENTITY_TUPLE_FIELDS,
  IDENTITY_TUPLE_FIELDS_SORTED,
  FINAL_IDENTITY_SNAPSHOT_KEYS_SORTED,
  OWNER_IDENTITY_KEYS_SORTED,
  ISOLATION_ROOT_TOPOLOGY_LAYOUT,
  ROOT_PROVISION_INTENT_LIFETIME_MS,
}) {

  const SPAWN_INTENT_CLOSED_FIELDS = Object.freeze(new Set(['schema', 'instanceId', 'repoId', 'runId', 'rootIdentity', 'intentAt']));

  const SPAWN_FAILED_CLOSED_FIELDS = Object.freeze(new Set(['schema', 'instanceId', 'repoId', 'runId', 'intentDigest', 'failureReason', 'failedAt']));

  function validateSpawnIntentRecord(text, { repoId, instanceId }) {
    let record;
    try {
      record = JSON.parse(text);
    } catch (err) {
      return { ok: false, reason: 'SPAWN_INTENT_UNREADABLE' };
    }
    if (!record || typeof record !== 'object') {
      return { ok: false, reason: 'SPAWN_INTENT_UNREADABLE' };
    }
    if (record.schema !== 'coordination/spawn-intent/v1') {
      return { ok: false, reason: 'SPAWN_INTENT_SCHEMA_INVALID' };
    }
    if (record.instanceId !== instanceId || record.repoId !== repoId) {
      return { ok: false, reason: 'SPAWN_INTENT_CORRELATION_MISMATCH' };
    }
    // Same schema-and-correlation-first order as validateCleanupIntentRecord's
    // own established precedent -- "is this even the right record, for the
    // right instance" is checked before any other field-level scrutiny.
    const unexpectedKey = Object.keys(record).find((key) => !SPAWN_INTENT_CLOSED_FIELDS.has(key));
    if (unexpectedKey !== undefined) {
      return { ok: false, reason: 'SPAWN_INTENT_FIELD_INVALID' };
    }
    if (!isCoreGeneratedIdentifier(record.runId)) {
      return { ok: false, reason: 'SPAWN_INTENT_FIELD_INVALID' };
    }
    // ROUND 10.1 (P1): exactly {dev,ino}, no additional keys -- previously any
    // extra key on this nested object sailed through unnoticed.
    if (!hasExactKeys(record.rootIdentity, ['dev', 'ino'])
      || !isValidDevInoValue(record.rootIdentity.dev) || !isValidDevInoValue(record.rootIdentity.ino)) {
      return { ok: false, reason: 'SPAWN_INTENT_FIELD_INVALID' };
    }
    if (!isCanonicalIsoUtcTimestamp(record.intentAt)) {
      return { ok: false, reason: 'SPAWN_INTENT_FIELD_INVALID' };
    }
    return { ok: true, record };
  }

  function classifyGenuineNeverSpawnedAbsence({ repoId, instanceId }) {
    const spawnIntentPath = path.join(registryRepoDir({ repoId }), 'spawn-intents', instanceId + '.json');
    const spawnIntentRead = readDurableRegistryRecordFd(spawnIntentPath, REGISTRY_RECORD_MAX_BYTES);
    if (!spawnIntentRead.ok) return { status: 'CHECK_FAILED' };
    if (!spawnIntentRead.exists) return { status: 'NEVER_SPAWNED' };
    // ROUND 10 (Block A): spawn-intent/v1's OWN full content is now validated
    // independently, from THIS SAME fd-bound read -- never a second, separate
    // re-open of the same file, and never deferred until "only if a
    // spawn-failed record also exists".
    const intentValidation = validateSpawnIntentRecord(spawnIntentRead.text, { repoId, instanceId });

    const spawnFailedPath = path.join(registryRepoDir({ repoId }), 'spawn-intents', instanceId + '.failed.json');
    const spawnFailedRead = readDurableRegistryRecordFd(spawnFailedPath, REGISTRY_RECORD_MAX_BYTES);
    if (!spawnFailedRead.ok) return { status: 'CHECK_FAILED' };
    if (!spawnFailedRead.exists) {
      const correlatedRecordBytes = Buffer.from(spawnIntentRead.text, 'utf8');
      const runId = intentValidation.ok ? intentValidation.record.runId : undefined;
      return { status: 'SPAWN_OUTCOME_UNKNOWN', quarantineData: { runId, correlatedRecordBytes } };
    }
    let spawnFailedRecord;
    try {
      spawnFailedRecord = JSON.parse(spawnFailedRead.text);
    } catch (err) {
      return { status: 'MALFORMED_SPAWN_FAILED_RECORD', malformedReason: 'UNREADABLE' };
    }
    if (!spawnFailedRecord || typeof spawnFailedRecord !== 'object') {
      return { status: 'MALFORMED_SPAWN_FAILED_RECORD', malformedReason: 'UNREADABLE' };
    }
    if (spawnFailedRecord.schema !== 'coordination/spawn-failed-before-process/v1') {
      return { status: 'MALFORMED_SPAWN_FAILED_RECORD', malformedReason: 'SCHEMA_INVALID' };
    }
    if (spawnFailedRecord.instanceId !== instanceId || spawnFailedRecord.repoId !== repoId) {
      return { status: 'MALFORMED_SPAWN_FAILED_RECORD', malformedReason: 'CORRELATION_MISMATCH' };
    }
    // ROUND 10 (Block A): closed key set -- an extra, undocumented key
    // previously sailed through this record entirely unnoticed. Checked after
    // schema/correlation, same established order as validateCleanupIntentRecord.
    const spawnFailedUnexpectedKey = Object.keys(spawnFailedRecord).find((key) => !SPAWN_FAILED_CLOSED_FIELDS.has(key));
    if (spawnFailedUnexpectedKey !== undefined) {
      return { status: 'MALFORMED_SPAWN_FAILED_RECORD', malformedReason: 'FIELD_INVALID' };
    }
    // ROUND 10 (Block A): the intent itself must be genuinely valid BEFORE any
    // spawn-failed claim about it can be trusted -- this is the core rule:
    // digest-matching (below) proves byte-identity, never content validity.
    if (!intentValidation.ok) {
      return { status: 'MALFORMED_SPAWN_FAILED_RECORD', malformedReason: 'INTENT_INVALID' };
    }
    // ROUND 10 (Block A): runId must correlate with the NOW-VALIDATED intent
    // specifically -- this function itself receives no external runId to
    // check against (classifyGenuineNeverSpawnedAbsence's own params are just
    // {repoId,instanceId}), so the intent's own already grammar-validated
    // runId is the only ground truth available.
    if (spawnFailedRecord.runId !== intentValidation.record.runId) {
      return { status: 'MALFORMED_SPAWN_FAILED_RECORD', malformedReason: 'CORRELATION_MISMATCH' };
    }
    if (typeof spawnFailedRecord.intentDigest !== 'string' || spawnFailedRecord.intentDigest.length === 0) {
      return { status: 'MALFORMED_SPAWN_FAILED_RECORD', malformedReason: 'FIELD_INVALID' };
    }
    // ROUND 9 (P0-1) / ROUND 10 (Block A, single-read consolidation): reuses
    // the ONE fd-bound read already captured above (spawnIntentRead) -- never
    // a second, separate re-open of the same file just for the digest.
    const recomputedIntentDigest = rc.sha256Buffer(Buffer.from(spawnIntentRead.text, 'utf8'));
    if (spawnFailedRecord.intentDigest !== recomputedIntentDigest) {
      return { status: 'MALFORMED_SPAWN_FAILED_RECORD', malformedReason: 'INTENT_DIGEST_MISMATCH' };
    }
    if (!isCanonicalIsoUtcTimestamp(spawnFailedRecord.failedAt)) {
      return { status: 'MALFORMED_SPAWN_FAILED_RECORD', malformedReason: 'FIELD_INVALID' };
    }
    if (!SPAWN_FAILED_REASON_ENUM.has(spawnFailedRecord.failureReason)) {
      return { status: 'MALFORMED_SPAWN_FAILED_RECORD', malformedReason: 'REASON_INVALID' };
    }
    return { status: 'CONFIRMED_SAFE_SPAWN_FAILURE' };
  }

  const CLEANUP_INTENT_VALID_OUTCOMES = Object.freeze(new Set(['PID_ABSENT', 'NEVER_SPAWNED']));

  const CLEANUP_INTENT_ALL_POSSIBLE_FIELDS = Object.freeze(new Set([
    'schema', 'instanceId', 'repoId', 'runId', 'intendedPath', 'rootInode', 'outcome', 'intentAt',
    'pid', 'birthToken', 'executableIdentity', 'instanceRecordIdentity',
  ]));

  function validateCleanupIntentRecord(text, { repoId, instanceId }) {
    let record;
    try {
      record = JSON.parse(text);
    } catch (err) {
      return { ok: false, reason: 'CLEANUP_INTENT_UNREADABLE' };
    }
    if (!record || typeof record !== 'object') {
      return { ok: false, reason: 'CLEANUP_INTENT_UNREADABLE' };
    }
    if (record.schema !== 'coordination/cleanup-intent/v1') {
      return { ok: false, reason: 'CLEANUP_INTENT_SCHEMA_INVALID' };
    }
    if (record.instanceId !== instanceId || record.repoId !== repoId) {
      return { ok: false, reason: 'CLEANUP_INTENT_CORRELATION_MISMATCH' };
    }
    // ROUND 10 (Block B): closed key set -- an extra, undocumented key
    // previously sailed through entirely unnoticed. Same established order
    // as Block A's spawn-intent/spawn-failed validators: schema+correlation
    // first, then closed-key-set, then remaining field-level checks.
    const cleanupIntentUnexpectedKey = Object.keys(record).find((key) => !CLEANUP_INTENT_ALL_POSSIBLE_FIELDS.has(key));
    if (cleanupIntentUnexpectedKey !== undefined) {
      return { ok: false, reason: 'CLEANUP_INTENT_FIELD_INVALID' };
    }
    // ROUND 10 (Block B): upgraded from shape-only (non-empty string) to the
    // real core-generated-hex grammar, matching every other entry point's own
    // runId discipline (createRunRoot, createRunAuthorities, spawn-intent/v1).
    if (!isCoreGeneratedIdentifier(record.runId)) {
      return { ok: false, reason: 'CLEANUP_INTENT_FIELD_INVALID' };
    }
    if (!CLEANUP_INTENT_VALID_OUTCOMES.has(record.outcome)) {
      return { ok: false, reason: 'CLEANUP_INTENT_OUTCOME_INVALID' };
    }
    // ROUND 10.1 (P1): exactly {dev,ino}; every real writer of this record
    // always stringifies dev/ino (fd-bound identity capture, never a raw
    // number here) -- tightened to the canonical non-negative decimal string
    // format specifically (rejects "-5", "3.14", "007", empty, arbitrary text).
    if (!hasExactKeys(record.rootInode, ['dev', 'ino'])
      || !CANONICAL_NONNEGATIVE_DECIMAL_STRING_PATTERN.test(record.rootInode.dev)
      || !CANONICAL_NONNEGATIVE_DECIMAL_STRING_PATTERN.test(record.rootInode.ino)) {
      return { ok: false, reason: 'CLEANUP_INTENT_FIELD_INVALID' };
    }
    // ROUND 10 (Block B): intendedPath must equal the SAME canonical path
    // createRunRoot itself independently derives for this exact
    // {repoId,instanceId} -- a record whose intendedPath names a foreign
    // directory is never trusted at face value merely because it is a
    // well-formed string.
    const canonicalIntendedPath = path.join(registryRepoDir({ repoId }), 'isolation-roots', instanceId);
    if (record.intendedPath !== canonicalIntendedPath) {
      return { ok: false, reason: 'CLEANUP_INTENT_INTENDED_PATH_MISMATCH' };
    }
    if (!isCanonicalIsoUtcTimestamp(record.intentAt)) {
      return { ok: false, reason: 'CLEANUP_INTENT_FIELD_INVALID' };
    }
    if (record.outcome === 'NEVER_SPAWNED') {
      if ('pid' in record || 'birthToken' in record || 'executableIdentity' in record || 'instanceRecordIdentity' in record) {
        return { ok: false, reason: 'CLEANUP_INTENT_FIELD_INVALID' };
      }
    } else {
      if (typeof record.pid !== 'number' || !Number.isInteger(record.pid) || record.pid <= 0) {
        return { ok: false, reason: 'CLEANUP_INTENT_FIELD_INVALID' };
      }
      if (typeof record.birthToken !== 'string' || record.birthToken.length === 0) {
        return { ok: false, reason: 'CLEANUP_INTENT_FIELD_INVALID' };
      }
      if (typeof record.executableIdentity !== 'string' || record.executableIdentity.length === 0) {
        return { ok: false, reason: 'CLEANUP_INTENT_FIELD_INVALID' };
      }
      // ROUND 10 (Block B) / ROUND 10.1 (P1): exactly {dev,ino,mode,uid}, every
      // field a NON-EMPTY string (an empty-string value previously passed
      // despite being a meaningless identity); dev/ino further tightened to
      // the canonical non-negative decimal string format specifically.
      if (!hasExactKeys(record.instanceRecordIdentity, ['dev', 'ino', 'mode', 'uid'])
        || !CANONICAL_NONNEGATIVE_DECIMAL_STRING_PATTERN.test(record.instanceRecordIdentity.dev)
        || !CANONICAL_NONNEGATIVE_DECIMAL_STRING_PATTERN.test(record.instanceRecordIdentity.ino)
        || typeof record.instanceRecordIdentity.mode !== 'string' || record.instanceRecordIdentity.mode.length === 0
        || typeof record.instanceRecordIdentity.uid !== 'string' || record.instanceRecordIdentity.uid.length === 0) {
        return { ok: false, reason: 'CLEANUP_INTENT_FIELD_INVALID' };
      }
    }
    return { ok: true, record };
  }

  const CLEANUP_COMPLETE_CLOSED_FIELDS = Object.freeze(new Set([
    'schema', 'instanceId', 'repoId', 'runId', 'rootInodeAfter', 'finalPath', 'completedAt',
  ]));

  function isValidIdentityTuple(value) {
    // ROUND 10.1 (P1): exactly the 8 frozen fields, no additional keys; dev/ino
    // specifically tightened to the canonical non-negative decimal string
    // format (every real fdBoundIdentityTuple capture stringifies a real,
    // non-negative stat value) -- the remaining 5 fields stay non-empty-string
    // checked, unchanged in scope from this round's own precision-only remit.
    if (!hasExactKeys(value, IDENTITY_TUPLE_FIELDS_SORTED)) return false;
    if (!CANONICAL_NONNEGATIVE_DECIMAL_STRING_PATTERN.test(value.dev) || !CANONICAL_NONNEGATIVE_DECIMAL_STRING_PATTERN.test(value.ino)) return false;
    return IDENTITY_TUPLE_FIELDS.every((field) => (field === 'dev' || field === 'ino') || (typeof value[field] === 'string' && value[field].length > 0));
  }

  const ROOT_PROVISION_INTENT_CLOSED_FIELDS = Object.freeze(new Set([
    'schema', 'instanceId', 'repoId', 'runId', 'intendedPath', 'ownerIdentity', 'createdAt', 'expiresAt',
  ]));

  const ROOT_PROVISION_COMPLETE_CLOSED_FIELDS = Object.freeze(new Set([
    'schema', 'instanceId', 'repoId', 'runId', 'finalPath', 'writer', 'correlatedIntentDigest', 'finalIdentitySnapshot', 'completedAt',
  ]));

  const ROOT_PROVISION_COMPLETE_WRITER_LITERAL = 'IsolationProvider';

  function isValidFinalIdentitySnapshotShape(snapshot) {
    // ROUND 10.1 (P1): exactly {topologyIdentity,configIdentity,configDigest}
    // at the top level -- an extra field here previously sailed through
    // unnoticed, same class of gap as the partial-record case this shape
    // check already closes.
    if (!hasExactKeys(snapshot, FINAL_IDENTITY_SNAPSHOT_KEYS_SORTED)) return false;
    if (!snapshot.topologyIdentity || typeof snapshot.topologyIdentity !== 'object') return false;
    const expectedLayers = Object.keys(ISOLATION_ROOT_TOPOLOGY_LAYOUT);
    const actualLayers = Object.keys(snapshot.topologyIdentity);
    if (actualLayers.length !== expectedLayers.length || !expectedLayers.every((layer) => actualLayers.includes(layer))) return false;
    if (!expectedLayers.every((layer) => isValidIdentityTuple(snapshot.topologyIdentity[layer]))) return false;
    if (!isValidIdentityTuple(snapshot.configIdentity)) return false;
    if (typeof snapshot.configDigest !== 'string' || !/^[0-9a-f]{64}$/.test(snapshot.configDigest)) return false;
    return true;
  }

  function validateRootProvisionIntentRecord(text, { repoId, instanceId }) {
    let record;
    try {
      record = JSON.parse(text);
    } catch (err) {
      return { ok: false, reason: 'ROOT_PROVISION_INTENT_UNREADABLE' };
    }
    if (!record || typeof record !== 'object') {
      return { ok: false, reason: 'ROOT_PROVISION_INTENT_UNREADABLE' };
    }
    if (record.schema !== 'coordination/root-provision-intent/v1') {
      return { ok: false, reason: 'ROOT_PROVISION_INTENT_SCHEMA_INVALID' };
    }
    if (record.instanceId !== instanceId || record.repoId !== repoId) {
      return { ok: false, reason: 'ROOT_PROVISION_INTENT_CORRELATION_MISMATCH' };
    }
    const unexpectedKey = Object.keys(record).find((key) => !ROOT_PROVISION_INTENT_CLOSED_FIELDS.has(key));
    if (unexpectedKey !== undefined) {
      return { ok: false, reason: 'ROOT_PROVISION_INTENT_FIELD_INVALID' };
    }
    if (!isCoreGeneratedIdentifier(record.runId)) {
      return { ok: false, reason: 'ROOT_PROVISION_INTENT_FIELD_INVALID' };
    }
    const canonicalIntendedPath = path.join(registryRepoDir({ repoId }), 'isolation-roots', instanceId);
    if (record.intendedPath !== canonicalIntendedPath) {
      return { ok: false, reason: 'ROOT_PROVISION_INTENT_INTENDED_PATH_MISMATCH' };
    }
    // ROUND 10.1 (P1): exactly {pid,birthToken,executableIdentity}, no
    // additional keys.
    if (!hasExactKeys(record.ownerIdentity, OWNER_IDENTITY_KEYS_SORTED)
      || typeof record.ownerIdentity.pid !== 'number' || !Number.isInteger(record.ownerIdentity.pid) || record.ownerIdentity.pid <= 0
      || typeof record.ownerIdentity.birthToken !== 'string' || record.ownerIdentity.birthToken.length === 0
      || typeof record.ownerIdentity.executableIdentity !== 'string' || record.ownerIdentity.executableIdentity.length === 0) {
      return { ok: false, reason: 'ROOT_PROVISION_INTENT_FIELD_INVALID' };
    }
    if (!isCanonicalIsoUtcTimestamp(record.createdAt) || !isCanonicalIsoUtcTimestamp(record.expiresAt)) {
      return { ok: false, reason: 'ROOT_PROVISION_INTENT_FIELD_INVALID' };
    }
    // ROUND 10 (Block C): the exact 300-second relationship PLAN.md ~L1161/1192
    // itself freezes -- a genuine writer's own createdAt/expiresAt pair always
    // satisfies this exactly; any other relationship is tamper/corruption
    // evidence, never merely "some later timestamp".
    if (Date.parse(record.expiresAt) - Date.parse(record.createdAt) !== ROOT_PROVISION_INTENT_LIFETIME_MS) {
      return { ok: false, reason: 'ROOT_PROVISION_INTENT_EXPIRY_RELATIONSHIP_INVALID' };
    }
    return { ok: true, record };
  }

  function validateRootProvisionCompleteRecord(text, { repoId, instanceId }, intentRecord, intentBytes) {
    let record;
    try {
      record = JSON.parse(text);
    } catch (err) {
      return { ok: false, reason: 'ROOT_PROVISION_COMPLETE_UNREADABLE' };
    }
    if (!record || typeof record !== 'object') {
      return { ok: false, reason: 'ROOT_PROVISION_COMPLETE_UNREADABLE' };
    }
    if (record.schema !== 'coordination/root-provision-complete/v1') {
      return { ok: false, reason: 'ROOT_PROVISION_COMPLETE_SCHEMA_INVALID' };
    }
    if (record.instanceId !== instanceId || record.repoId !== repoId || record.runId !== intentRecord.runId) {
      return { ok: false, reason: 'ROOT_PROVISION_COMPLETE_CORRELATION_MISMATCH' };
    }
    const unexpectedKey = Object.keys(record).find((key) => !ROOT_PROVISION_COMPLETE_CLOSED_FIELDS.has(key));
    if (unexpectedKey !== undefined) {
      return { ok: false, reason: 'ROOT_PROVISION_COMPLETE_FIELD_INVALID' };
    }
    // ROUND 10 (Block C): finalPath must equal the SAME intent this record
    // claims to complete -- never trusted as an independent, unverified value.
    if (record.finalPath !== intentRecord.intendedPath) {
      return { ok: false, reason: 'ROOT_PROVISION_COMPLETE_FINAL_PATH_MISMATCH' };
    }
    if (record.writer !== ROOT_PROVISION_COMPLETE_WRITER_LITERAL) {
      return { ok: false, reason: 'ROOT_PROVISION_COMPLETE_FIELD_INVALID' };
    }
    if (typeof record.correlatedIntentDigest !== 'string' || record.correlatedIntentDigest.length === 0
      || record.correlatedIntentDigest !== rc.sha256Buffer(intentBytes)) {
      return { ok: false, reason: 'ROOT_PROVISION_COMPLETE_INTENT_DIGEST_MISMATCH' };
    }
    if (!isValidFinalIdentitySnapshotShape(record.finalIdentitySnapshot)) {
      return { ok: false, reason: 'ROOT_PROVISION_COMPLETE_FIELD_INVALID' };
    }
    if (!isCanonicalIsoUtcTimestamp(record.completedAt)) {
      return { ok: false, reason: 'ROOT_PROVISION_COMPLETE_FIELD_INVALID' };
    }
    // ROUND 10 (Block C): ordering -- a genuine completedAt is always stamped
    // AFTER the intent it completes was created.
    if (Date.parse(record.completedAt) < Date.parse(intentRecord.createdAt)) {
      return { ok: false, reason: 'ROOT_PROVISION_COMPLETE_ORDERING_INVALID' };
    }
    return { ok: true, record };
  }

  return Object.freeze({ CLEANUP_COMPLETE_CLOSED_FIELDS, classifyGenuineNeverSpawnedAbsence, validateCleanupIntentRecord, validateRootProvisionIntentRecord, validateRootProvisionCompleteRecord });
}

module.exports = Object.freeze({ createCleanupRecordValidation });
