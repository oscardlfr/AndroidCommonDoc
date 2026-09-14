'use strict';

function createIsolationRootCleanup({
  fs, path, registryRepoDir, rootHandleInternals, handleMatchesSnapshot,
  CLEANUP_AUTHORIZATION_CLOSED_FIELDS, CLEANUP_AUTHORIZATION_OUTCOME_ENUM,
  fdBoundRecordExists, classifyGenuineNeverSpawnedAbsence,
  readDurableRegistryRecordFd, REGISTRY_RECORD_MAX_BYTES, isTestCapability,
  rootIdentityKeyFor, liveChildRootIdentityKeys, livenessProbe,
  publishBridgeRegistryRecord, canonicalJSONStringify, isToctouSwapFaultActive,
  fsyncDirSync, isCleanupCrashFaultActive, retireInstanceRecord,
}) {
  function isValidCleanupAuthorization(authorization, handle, snapshot, allowSpawnedOutcomes) {
    if (!authorization || typeof authorization !== 'object') return false;
    const unexpectedKey = Object.keys(authorization).find((key) => !CLEANUP_AUTHORIZATION_CLOSED_FIELDS.has(key));
    if (unexpectedKey !== undefined) return false;
    if (!CLEANUP_AUTHORIZATION_OUTCOME_ENUM.has(authorization.outcome)) return false;
    if (!allowSpawnedOutcomes && authorization.outcome !== 'NEVER_SPAWNED') return false;
    if (authorization.outcome === 'PID_LIVE' || authorization.outcome === 'PID_INDETERMINATE') return false;
    const isNeverSpawned = authorization.outcome === 'NEVER_SPAWNED';
    if (isNeverSpawned) {
      if (authorization.pid !== null || authorization.birthToken !== null || authorization.executableIdentity !== null) return false;
      if (authorization.instanceRecordIdentity !== null) return false; // nothing was ever spawned, so no instance record identity to correlate either.
      const neverSpawnedLivePath = path.join(registryRepoDir({ repoId: handle.repoId }), 'instances', handle.instanceId + '.json');
      const neverSpawnedLiveCheck = fdBoundRecordExists(neverSpawnedLivePath);
      if (!neverSpawnedLiveCheck.ok) return false;
      if (neverSpawnedLiveCheck.exists) return false;
      const neverSpawnedTombstonePath = path.join(registryRepoDir({ repoId: handle.repoId }), 'instances', '.tombstone', handle.instanceId + '.json');
      const neverSpawnedTombstoneCheck = fdBoundRecordExists(neverSpawnedTombstonePath);
      if (!neverSpawnedTombstoneCheck.ok) return false;
      if (neverSpawnedTombstoneCheck.exists) return false;
      const spawnClassification = classifyGenuineNeverSpawnedAbsence({ repoId: handle.repoId, instanceId: handle.instanceId });
      if (spawnClassification.status !== 'NEVER_SPAWNED' && spawnClassification.status !== 'CONFIRMED_SAFE_SPAWN_FAILURE') return false;
    } else {
      if (typeof authorization.pid !== 'number' || !Number.isInteger(authorization.pid) || authorization.pid <= 0) return false;
      if (typeof authorization.birthToken !== 'string' || authorization.birthToken.length === 0) return false;
      if (typeof authorization.executableIdentity !== 'string' || authorization.executableIdentity.length === 0) return false;
      const instanceRecordPath = path.join(registryRepoDir({ repoId: handle.repoId }), 'instances', handle.instanceId + '.json');
      const instanceRecordRead = readDurableRegistryRecordFd(instanceRecordPath, REGISTRY_RECORD_MAX_BYTES);
      if (!instanceRecordRead.ok || !instanceRecordRead.exists) return false;
      let instanceRecord;
      try {
        instanceRecord = JSON.parse(instanceRecordRead.text);
      } catch (err) {
        return false;
      }
      if (!instanceRecord || typeof instanceRecord !== 'object') return false;
      if (instanceRecord.instance_id !== handle.instanceId) return false;
      if (authorization.pid !== instanceRecord.pid) return false;
      if (authorization.birthToken !== instanceRecord.os_birth_token) return false;
      if (authorization.executableIdentity !== instanceRecord.executable_path) return false;
      if (!authorization.instanceRecordIdentity || typeof authorization.instanceRecordIdentity !== 'object') return false;
      const instanceRecordFileIdentity = instanceRecordRead.identity;
      if (authorization.instanceRecordIdentity.dev !== instanceRecordFileIdentity.dev.toString()
        || authorization.instanceRecordIdentity.ino !== instanceRecordFileIdentity.ino.toString()
        || authorization.instanceRecordIdentity.mode !== instanceRecordFileIdentity.mode.toString()
        || authorization.instanceRecordIdentity.uid !== instanceRecordFileIdentity.uid.toString()) return false;
    }
    if (authorization.repoId !== handle.repoId || authorization.instanceId !== handle.instanceId || authorization.runId !== handle.runId) return false;
    if (authorization.ownerToken !== snapshot.ownerToken) return false;
    return true;
  }

  function cleanupRoot(handle, authorization, testHooks) {
    const fsyncOrderHook = (isTestCapability() && testHooks && typeof testHooks.onFsyncOrder === 'function') ? testHooks.onFsyncOrder : null;
    if (!handle || typeof handle.intendedPath !== 'string') {
      return { ok: false, reason: 'CLEANUP_INVALID_HANDLE' };
    }
    const snapshot = rootHandleInternals.get(handle);
    if (!snapshot) {
      return { ok: false, reason: 'CLEANUP_UNKNOWN_HANDLE' };
    }
    if (!handleMatchesSnapshot(handle, snapshot)) {
      return { ok: false, reason: 'CLEANUP_HANDLE_TAMPERED' };
    }
    if (handle.state !== 'READY') {
      if (handle.state !== 'PROFILE_PENDING' || !authorization || authorization.allowPendingAbandonment !== true) {
        return { ok: false, reason: 'CLEANUP_ROOT_NOT_READY' };
      }
      if (!isValidCleanupAuthorization(authorization, handle, snapshot, true)) {
        return { ok: false, reason: 'CLEANUP_AUTHORIZATION_INVALID' };
      }
      if (authorization.outcome === 'PID_ABSENT') {
        const bornRecordPath = path.join(registryRepoDir({ repoId: handle.repoId }), 'instances', handle.instanceId + '.json');
        const bornRecordRead = readDurableRegistryRecordFd(bornRecordPath, REGISTRY_RECORD_MAX_BYTES);
        let bornRecord = null;
        if (bornRecordRead.ok && bornRecordRead.exists) {
          try { bornRecord = JSON.parse(bornRecordRead.text); } catch (err) { bornRecord = null; }
        }
        if (
          !bornRecord || bornRecord.driver !== 'codex-app-server' || bornRecord.process_kind !== 'app-server-worker'
        ) {
          return { ok: false, reason: 'CLEANUP_UNSEALED_PID_ABSENT_REQUIRES_OWNED_APP_SERVER_RECORD' };
        }
      }
    } else {
      if (!isValidCleanupAuthorization(authorization, handle, snapshot, true)) {
        return { ok: false, reason: 'CLEANUP_AUTHORIZATION_INVALID' };
      }
    }
    try {
      const currentStat = fs.statSync(handle.intendedPath, { bigint: true });
      const liveKey = rootIdentityKeyFor({ dev: currentStat.dev, ino: currentStat.ino });
      if (liveKey && liveChildRootIdentityKeys.has(liveKey)) {
        return { ok: false, reason: 'CLEANUP_LIVE_CHILD_PRESENT' };
      }
    } catch (err) {
    }
    if (authorization && typeof authorization.pid === 'number' && Number.isInteger(authorization.pid) && authorization.pid > 0) {
      if (livenessProbe(authorization.pid) !== 'DEAD') {
        return { ok: false, reason: 'CLEANUP_LIVE_CHILD_PRESENT' };
      }
    }

    const container = handle.instanceId;
    const containerDir = path.join(registryRepoDir({ repoId: handle.repoId }), '.tombstone', container);
    const intentPath = path.join(containerDir, 'intent.json');
    const completePath = path.join(containerDir, 'complete.json');
    const integrityFailurePath = path.join(containerDir, 'integrity-failure.json');
    const destinationPath = path.join(containerDir, 'root');

    let preRenameFd;
    try {
      preRenameFd = fs.openSync(handle.intendedPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    } catch (err) {
      return { ok: false, reason: 'CLEANUP_ROOT_MISSING_BEFORE_RENAME' };
    }
    let preRenameIdentity;
    try {
      const st = fs.fstatSync(preRenameFd, { bigint: true });
      preRenameIdentity = { dev: st.dev, ino: st.ino };
    } finally {
      try { fs.closeSync(preRenameFd); } catch (e) { /* best-effort */ }
    }

    const intentRecordBase = {
      schema: 'coordination/cleanup-intent/v1',
      instanceId: handle.instanceId, repoId: handle.repoId, runId: handle.runId,
      intendedPath: handle.intendedPath,
      rootInode: { dev: preRenameIdentity.dev.toString(), ino: preRenameIdentity.ino.toString() },
      outcome: authorization.outcome,
      intentAt: new Date().toISOString(),
    };
    const intentRecord = authorization.outcome === 'NEVER_SPAWNED'
      ? intentRecordBase
      : Object.assign({}, intentRecordBase, {
        pid: authorization.pid, birthToken: authorization.birthToken, executableIdentity: authorization.executableIdentity,
        instanceRecordIdentity: authorization.instanceRecordIdentity,
      });
    try {
      publishBridgeRegistryRecord(intentPath, Buffer.from(canonicalJSONStringify(intentRecord), 'utf8'));
    } catch (err) {
      return { ok: false, reason: (err && err.detailCode) || 'CLEANUP_INTENT_PUBLISH_FAILED' };
    }

    const expectedRootIdentity = handle.state === 'READY'
      ? (snapshot.finalIdentitySnapshot && snapshot.finalIdentitySnapshot.topologyIdentity && snapshot.finalIdentitySnapshot.topologyIdentity.root)
      : snapshot.originalLeafIdentity;
    if (!expectedRootIdentity || String(preRenameIdentity.dev) !== expectedRootIdentity.dev || String(preRenameIdentity.ino) !== expectedRootIdentity.ino) {
      return { ok: false, reason: 'CLEANUP_ROOT_IDENTITY_DRIFT' };
    }

    if (isToctouSwapFaultActive('cleanup-pre-rename')) {
      try {
        fs.rmSync(handle.intendedPath, { recursive: true, force: true });
        fs.mkdirSync(handle.intendedPath, { recursive: true, mode: 0o700 });
      } catch (err) { /* best-effort test seam */ }
    }

    let preRenameRecheckFd;
    try {
      preRenameRecheckFd = fs.openSync(handle.intendedPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    } catch (err) {
      return { ok: false, reason: 'CLEANUP_ROOT_VANISHED_BEFORE_RENAME' };
    }
    let preRenameRecheckIdentity;
    try {
      const st = fs.fstatSync(preRenameRecheckFd, { bigint: true });
      preRenameRecheckIdentity = { dev: st.dev, ino: st.ino };
    } finally {
      try { fs.closeSync(preRenameRecheckFd); } catch (e) { /* best-effort */ }
    }
    if (preRenameRecheckIdentity.dev !== preRenameIdentity.dev || preRenameRecheckIdentity.ino !== preRenameIdentity.ino) {
      return { ok: false, reason: 'CLEANUP_ROOT_REBIND_DETECTED' };
    }

    const originalParentDir = path.dirname(handle.intendedPath);
    try {
      fs.renameSync(handle.intendedPath, destinationPath);
    } catch (err) {
      return { ok: false, reason: 'CLEANUP_RENAME_FAILED' };
    }
    const parentFsyncOk = fsyncDirSync(originalParentDir);
    if (fsyncOrderHook) fsyncOrderHook('parent');
    if (!parentFsyncOk) {
      return { ok: false, reason: 'CLEANUP_FSYNC_FAILED' };
    }
    const containerFsyncOk = fsyncDirSync(containerDir);
    if (fsyncOrderHook) fsyncOrderHook('container');
    if (!containerFsyncOk) {
      return { ok: false, reason: 'CLEANUP_FSYNC_FAILED' };
    }

    if (isToctouSwapFaultActive('cleanup-post-rename')) {
      try {
        fs.rmSync(destinationPath, { recursive: true, force: true });
        fs.mkdirSync(destinationPath, { recursive: true, mode: 0o700 });
      } catch (err) { /* best-effort test seam */ }
    }

    let postRenameStat;
    try {
      postRenameStat = fs.statSync(destinationPath, { bigint: true });
    } catch (err) {
      postRenameStat = null;
    }
    const inodeMatches = !!postRenameStat && postRenameStat.dev === preRenameIdentity.dev && postRenameStat.ino === preRenameIdentity.ino;
    if (!inodeMatches) {
      const failureRecord = {
        schema: 'coordination/cleanup-integrity-failure/v1',
        instanceId: handle.instanceId, repoId: handle.repoId, runId: handle.runId,
        expectedInode: preRenameIdentity.ino.toString(),
        observedInode: postRenameStat ? postRenameStat.ino.toString() : null,
        detectedAt: new Date().toISOString(),
      };
      try {
        publishBridgeRegistryRecord(integrityFailurePath, Buffer.from(canonicalJSONStringify(failureRecord), 'utf8'));
      } catch (err) { /* best-effort -- the STOP (never publishing cleanup-complete/v1) is the primary contract */ }
      return { ok: false, reason: 'CLEANUP_INTEGRITY_FAILURE' };
    }

    if (isCleanupCrashFaultActive('post-fsync-pre-complete')) {
      return { ok: false, reason: 'TEST_ONLY_SIMULATED_CRASH_POST_FSYNC_PRE_COMPLETE' };
    }

    const completeRecord = {
      schema: 'coordination/cleanup-complete/v1',
      instanceId: handle.instanceId, repoId: handle.repoId, runId: handle.runId,
      finalPath: destinationPath,
      rootInodeAfter: { dev: postRenameStat.dev.toString(), ino: postRenameStat.ino.toString() },
      completedAt: new Date().toISOString(),
    };
    try {
      publishBridgeRegistryRecord(completePath, Buffer.from(canonicalJSONStringify(completeRecord), 'utf8'));
    } catch (err) {
      return { ok: false, reason: (err && err.detailCode) || 'CLEANUP_COMPLETE_PUBLISH_FAILED' };
    }
    const instanceRecordPath = path.join(registryRepoDir({ repoId: handle.repoId }), 'instances', handle.instanceId + '.json');
    const instanceRecordCheck = fdBoundRecordExists(instanceRecordPath);
    if (!instanceRecordCheck.ok) {
      return { ok: false, reason: 'CLEANUP_RETIREMENT_CHECK_FAILED', finalPath: destinationPath };
    }
    if (instanceRecordCheck.exists) {
      const retirementResult = retireInstanceRecord({ repoId: handle.repoId, instanceId: handle.instanceId });
      if (!retirementResult.ok) {
        return { ok: false, reason: 'CLEANUP_RETIREMENT_FAILED', finalPath: destinationPath };
      }
    }
    return { ok: true, finalPath: destinationPath };
  }
  return cleanupRoot;
}

module.exports = Object.freeze({ createIsolationRootCleanup });
