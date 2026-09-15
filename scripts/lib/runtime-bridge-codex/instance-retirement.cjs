'use strict';

function createInstanceRetirement({
  fs,
  path,
  registryRepoDir,
  withRegistryLock,
  isCoreGeneratedIdentifier,
  readDurableRegistryRecordFd,
  REGISTRY_RECORD_MAX_BYTES,
  isCanonicalIsoUtcTimestamp,
  isTestCapability,
  isToctouSwapFaultActive,
  publishBridgeRegistryRecord,
  fsyncDirSync,
  swapPathWithProvenFreshInode,
}) {

  function retireInstanceRecord({ repoId, instanceId }, testHooks) {
    // CORRECTION PASS ROUND 6 (Finding F, entrypoint sweep): same
    // isCoreGeneratedIdentifier grammar as createRunRoot/spawnWithIntent/
    // classify()/reconcile() -- this exported entrypoint had zero validation
    // before reaching registryRepoDir's path.join below.
    // retireInstanceRecordLocked is NOT separately exported (confirmed
    // against module.exports directly) -- its own repoId/instanceId are
    // always whatever this function already validated, so checking here once
    // covers both.
    if (!isCoreGeneratedIdentifier(repoId) || !isCoreGeneratedIdentifier(instanceId)) {
      return { ok: false, reason: 'UNSAFE_IDENTIFIER_SEGMENT:core-generated-grammar' };
    }
    const lockDir = path.join(registryRepoDir({ repoId }), 'instances', '.retirement-lock', instanceId);
    const lockResult = withRegistryLock(lockDir, () => retireInstanceRecordLocked({ repoId, instanceId }, testHooks));
    if (!lockResult.ok) return { ok: false, reason: lockResult.reason || 'RETIREMENT_LOCK_FAILED' };
    return lockResult.value;
  }

  const INSTANCE_RECORD_REQUIRED_STRING_FIELDS = Object.freeze([
    'driver', 'process_kind', 'ephemeral_home_path', 'worker_nonce', 'executable_path', 'os_birth_token',
  ]);

  const INSTANCE_RECORD_CLOSED_FIELDS = Object.freeze(new Set([
    'instance_id', 'driver', 'process_kind', 'ephemeral_home_path', 'worker_session_id',
    'worker_nonce', 'pid', 'executable_path', 'os_birth_token', 'pgid', 'created_at',
  ]));

  function validateRetiredInstanceRecord(record, { instanceId, requireCorrelation = true }) {
    if (!record || typeof record !== 'object') {
      return { ok: false, reason: 'INSTANCE_RECORD_UNREADABLE' };
    }
    if (requireCorrelation && record.instance_id !== instanceId) {
      return { ok: false, reason: 'INSTANCE_RECORD_CORRELATION_MISMATCH' };
    }
    // requireCorrelation:false callers (retirement's own NORMAL/source-path
    // validation below) still require SOME genuine, non-empty instance_id --
    // just not that it match the caller's own instanceId parameter -- the
    // source record already lives at a path this SAME function's caller
    // derived from instanceId, so path/content correlation is a SEPARATE,
    // pre-existing concern (P1A's own scope is completeness, not this).
    if (!requireCorrelation && (typeof record.instance_id !== 'string' || record.instance_id.length === 0)) {
      return { ok: false, reason: 'INSTANCE_RECORD_INCOMPLETE' };
    }
    // ROUND 10 (Block D): exact closed key set -- an extra, undocumented key
    // previously sailed through unnoticed at BOTH call sites.
    const unexpectedKey = Object.keys(record).find((key) => !INSTANCE_RECORD_CLOSED_FIELDS.has(key));
    if (unexpectedKey !== undefined) {
      return { ok: false, reason: 'INSTANCE_RECORD_INCOMPLETE' };
    }
    const hasRequiredStringFields = INSTANCE_RECORD_REQUIRED_STRING_FIELDS.every((field) => typeof record[field] === 'string' && record[field].length > 0);
    // ROUND 10.1 (P1): null OR a genuinely non-empty string -- an empty string
    // previously satisfied `typeof === 'string'` despite PLAN.md's own
    // "nullable" exception explicitly meaning the null sentinel, never an
    // empty-but-present value.
    const hasValidWorkerSessionId = record.worker_session_id === null || (typeof record.worker_session_id === 'string' && record.worker_session_id.length > 0);
    const hasValidCreatedAt = isCanonicalIsoUtcTimestamp(record.created_at);
    const hasValidPid = typeof record.pid === 'number' && Number.isInteger(record.pid) && record.pid > 0;
    const hasValidPgid = typeof record.pgid === 'number' && Number.isInteger(record.pgid) && record.pgid > 0;
    if (!hasRequiredStringFields || !hasValidWorkerSessionId || !hasValidCreatedAt || !hasValidPid || !hasValidPgid) {
      return { ok: false, reason: 'INSTANCE_RECORD_INCOMPLETE' };
    }
    return { ok: true, record };
  }

  function retireInstanceRecordLocked({ repoId, instanceId }, testHooks) {
    // C3-CLEANUP-E24: per-call (never module-level), test-capability-gated
    // full-sequence step recording -- same shape/justification as cleanupRoot's
    // own fsyncOrderHook and createRunAuthorities's testConstructionOrder.
    const stepHook = (isTestCapability() && testHooks && typeof testHooks.onRetirementStep === 'function') ? testHooks.onRetirementStep : null;
    function recordStep(name) { if (stepHook) stepHook(name); }
    const sourcePath = path.join(registryRepoDir({ repoId }), 'instances', instanceId + '.json');
    const tombstonePath = path.join(registryRepoDir({ repoId }), 'instances', '.tombstone', instanceId + '.json');

    // fd-bound initial read: open (O_NOFOLLOW), fstat for identity (dev+ino),
    // read bytes -- all from the SAME already-open fd, never a second re-open.
    let sourceFd;
    try {
      sourceFd = fs.openSync(sourcePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    } catch (err) {
      if (err && err.code === 'ENOENT') {
        // Crash-recovery re-derivation, never trusting a belief about which
        // crash point occurred: source already gone -- if a tombstone already
        // exists, this MAY be an already-completed retirement (idempotent
        // no-op).
        // ROUND 8 (Finding 6): bare fs.existsSync previously treated ANY file
        // at tombstonePath as automatic proof of a genuine prior success --
        // no verification the tombstone is even a real, non-symlinked regular
        // file, let alone genuinely THIS instanceId's own record. The
        // source's own original bytes are gone at this point (ENOENT), so a
        // byte-identical comparison (this file's own publishNoClobber
        // allowIdenticalIdempotent pattern team-lead cited) is not literally
        // reproducible here -- the strongest verification actually possible
        // is fd-bound identity (genuinely present, non-symlinked, a regular
        // file) PLUS instance_id correlation, mirroring the SAME "found at
        // the expected path is not, by itself, proof of correlation"
        // discipline just applied elsewhere this round (Finding 4 item 3).
        const tombstoneRecheck = readDurableRegistryRecordFd(tombstonePath, REGISTRY_RECORD_MAX_BYTES);
        if (!tombstoneRecheck.ok) return { ok: false, reason: 'TOMBSTONE_RECHECK_FAILED' };
        if (tombstoneRecheck.exists) {
          let tombstoneRecord;
          try {
            tombstoneRecord = JSON.parse(tombstoneRecheck.text);
          } catch (parseErr) {
            return { ok: false, reason: 'TOMBSTONE_RECHECK_UNREADABLE' };
          }
          if (!tombstoneRecord || typeof tombstoneRecord !== 'object') {
            return { ok: false, reason: 'TOMBSTONE_RECHECK_CORRELATION_MISMATCH' };
          }
          // ROUND 9 (P1-2) / ROUND 10 (Block D): now the SAME shared
          // validateRetiredInstanceRecord reapTombstonedRoot itself uses --
          // instance_id correlation alone was insufficient (PLAN.md's own
          // frozen instance-record shape has 11 required fields; a record
          // correctly correlated but otherwise incomplete is still not genuine
          // proof of a real, complete prior retirement). Byte-identity isn't
          // achievable here (the source's own original bytes are already
          // gone), so full shape accreditation is the strongest verification
          // actually achievable -- an incomplete record is ambiguous and
          // fails closed rather than being trusted.
          const tombstoneValidation = validateRetiredInstanceRecord(tombstoneRecord, { instanceId });
          if (!tombstoneValidation.ok) {
            return { ok: false, reason: tombstoneValidation.reason === 'INSTANCE_RECORD_CORRELATION_MISMATCH' ? 'TOMBSTONE_RECHECK_CORRELATION_MISMATCH' : 'TOMBSTONE_RECORD_INCOMPLETE' };
          }
          return { ok: true, alreadyRetired: true };
        }
        return { ok: false, reason: 'SOURCE_VANISHED_DURING_RECOVERY' };
      }
      return { ok: false, reason: 'SOURCE_CHECK_FAILED' };
    }
    let sourceBytes;
    let sourceIdentity;
    try {
      const st = fs.fstatSync(sourceFd, { bigint: true });
      sourceIdentity = { dev: st.dev, ino: st.ino };
      sourceBytes = fs.readFileSync(sourceFd);
    } catch (err) {
      try { fs.closeSync(sourceFd); } catch (e) { /* best-effort */ }
      return { ok: false, reason: 'SOURCE_CHECK_FAILED' };
    }
    try { fs.closeSync(sourceFd); } catch (e) { /* best-effort */ }
    recordStep('source-read');

    // P1-A (section5 "Ownership and BORN"): "Validate full 11-field shape at
    // cleanup authorization and both normal/resumed retirement, not only the
    // reaper." The crash-recovery branch above (source already ENOENT)
    // already holds a rediscovered tombstone to this SAME
    // validateRetiredInstanceRecord standard (with correlation, since a
    // tombstone found at a path is not by itself proof of which instanceId
    // it belongs to); the NORMAL (source-still-present) path never validated
    // shape completeness at all -- an incomplete record sailed straight
    // through to publishNoClobber below, tombstoning it forward byte-for-
    // byte. requireCorrelation is deliberately false here (unlike the
    // crash-recovery/reap call sites): this exact source path is ALREADY
    // instanceId-derived (instances/<instanceId>.json) by this same
    // function's own caller, immediately above -- genuinely reading a
    // DIFFERENT instance's record from under a foreign instanceId would
    // require an attacker to already control this host-private path
    // structure itself, a materially different threat this check was never
    // meant to cover, and retrofitting it here is never required by any
    // frozen contract (P1A-COMPLETE11FIELD-OWNER-RECORD-01's own fixture
    // already carries a correctly-correlated instance_id; only SHAPE
    // completeness is its actual scope). Deliberately NOT its own named
    // recordStep: C3-CLEANUP-E24's own frozen 7-step order assertion
    // (source-read, tombstone-publish, tombstone-revalidate,
    // pre-unlink-recheck, unlink, fsync-source-parent, fsync-tombstone-parent)
    // is a closed, exact sequence for the SUCCESS path -- this is a pure
    // precondition gate before that sequence's second step, never a new step
    // in it.
    let sourceRecord;
    try {
      sourceRecord = JSON.parse(sourceBytes.toString('utf8'));
    } catch (err) {
      return { ok: false, reason: 'SOURCE_RECORD_UNREADABLE' };
    }
    const sourceValidation = validateRetiredInstanceRecord(sourceRecord, { instanceId, requireCorrelation: false });
    if (!sourceValidation.ok) {
      return { ok: false, reason: sourceValidation.reason };
    }

    // publishNoClobber's own allowIdenticalIdempotent handles exactly PLAN's
    // 3-way destination outcome: absent -> proceeds; byte-identical -> resumes
    // idempotently; different -> hard STOP (no unlink ever attempted below).
    try {
      publishBridgeRegistryRecord(tombstonePath, sourceBytes, { allowIdenticalIdempotent: true });
    } catch (err) {
      return { ok: false, reason: (err && err.detailCode) || 'TOMBSTONE_PUBLISH_FAILED' };
    }
    recordStep('tombstone-publish');

    let tombstoneBytes;
    try {
      tombstoneBytes = fs.readFileSync(tombstonePath);
    } catch (err) {
      return { ok: false, reason: 'TOMBSTONE_REVALIDATION_FAILED' };
    }
    if (!tombstoneBytes.equals(sourceBytes)) {
      return { ok: false, reason: 'TOMBSTONE_REVALIDATION_MISMATCH' };
    }
    recordStep('tombstone-revalidate');

    // CORRECTION ROUND Section D: test-only fault seam -- simulate a same-
    // bytes-different-inode substitution of the source, immediately before the
    // fd-bound pre-unlink re-check.
    if (isToctouSwapFaultActive('retirement-pre-unlink')) {
      try {
        swapPathWithProvenFreshInode(sourcePath, (siblingPath) => fs.writeFileSync(siblingPath, sourceBytes, { mode: 0o600 })); // same bytes, a PROVEN fresh inode.
      } catch (err) { /* best-effort test seam */ }
    }

    // Immediate FD-BOUND re-check of the source, directly adjacent to the
    // unlink call (PLAN.md ~L1176) -- identity (dev+ino), never byte-content
    // alone, gates the unlink. The single closed positive condition for unlink
    // is recheck.ok && recheck.present && identityMatches (now INCLUDING
    // inode identity, not merely byte-equality); every other outcome is an
    // individually named STOP with no unlink attempted, source/tombstone left
    // exactly as found.
    let recheckFd;
    try {
      recheckFd = fs.openSync(sourcePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    } catch (err) {
      if (err && err.code === 'ENOENT') return { ok: false, reason: 'SOURCE_VANISHED_DURING_RECOVERY' };
      return { ok: false, reason: 'SOURCE_CHECK_FAILED' };
    }
    let recheckIdentity;
    let recheckBytes;
    try {
      const st = fs.fstatSync(recheckFd, { bigint: true });
      recheckIdentity = { dev: st.dev, ino: st.ino };
      recheckBytes = fs.readFileSync(recheckFd);
    } catch (err) {
      try { fs.closeSync(recheckFd); } catch (e) { /* best-effort */ }
      return { ok: false, reason: 'SOURCE_CHECK_FAILED' };
    }
    try { fs.closeSync(recheckFd); } catch (e) { /* best-effort */ }

    const identityMatches = recheckIdentity.dev === sourceIdentity.dev
      && recheckIdentity.ino === sourceIdentity.ino
      && recheckBytes.equals(sourceBytes);
    if (!identityMatches) {
      return { ok: false, reason: 'SOURCE_REBIND_DETECTED' };
    }
    recordStep('pre-unlink-recheck');

    try {
      fs.unlinkSync(sourcePath);
    } catch (err) {
      return { ok: false, reason: 'SOURCE_UNLINK_FAILED' };
    }
    recordStep('unlink');

    // C3-CLEANUP-E24: split from the original single `||`-chained condition so
    // a test can observe fsync call order -- short-circuit semantics unchanged
    // (the tombstone-parent dir is never fsync'd if the source-parent fsync
    // already failed).
    const sourceParentFsyncOk = fsyncDirSync(path.dirname(sourcePath));
    recordStep('fsync-source-parent');
    if (!sourceParentFsyncOk) {
      return { ok: false, reason: 'RETIREMENT_FSYNC_FAILED' };
    }
    const tombstoneParentFsyncOk = fsyncDirSync(path.dirname(tombstonePath));
    recordStep('fsync-tombstone-parent');
    if (!tombstoneParentFsyncOk) {
      return { ok: false, reason: 'RETIREMENT_FSYNC_FAILED' };
    }

    return { ok: true };
  }

  return Object.freeze({ retireInstanceRecord, validateRetiredInstanceRecord });
}

module.exports = Object.freeze({ createInstanceRetirement });
