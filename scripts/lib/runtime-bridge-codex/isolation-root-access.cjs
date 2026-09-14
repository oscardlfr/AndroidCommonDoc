'use strict';

function createIsolationRootAccess({
  rootsByRunId, rootHandleInternals, readViewAuthority, handleMatchesSnapshot,
  captureFinalIdentitySnapshot, finalIdentitySnapshotsMatch,
}) {
  function withValidatedReadView(capability, { runId, role }, callback) {
    const resolution = readViewAuthority.resolve(capability, { expectedRunId: runId, expectedRole: role });
    if (!resolution || resolution.ok !== true) {
      return { ok: false, reason: (resolution && resolution.reason) || 'READ_VIEW_CAPABILITY_REJECTED' };
    }
    const rootsForThisRun = rootsByRunId.get(runId);
    let record;
    if (rootsForThisRun) {
      if (rootsForThisRun.roleSpecific.size > 0) {
        record = rootsForThisRun.roleSpecific.get(role);
      } else if (rootsForThisRun.generic.size === 1) {
        record = rootsForThisRun.generic.values().next().value;
      }
    }
    if (!record || record.state !== 'READY') {
      return { ok: false, reason: 'UNKNOWN_OR_NOT_READY_RUN' };
    }
    let before;
    try {
      before = captureFinalIdentitySnapshot(record);
    } catch (err) {
      return { ok: false, reason: 'READ_VIEW_PRECHECK_FAILED' };
    }
    let callbackResult;
    let callbackThrew = false;
    let callbackError;
    try {
      callbackResult = callback({ role, runId });
    } catch (err) {
      callbackThrew = true;
      callbackError = err;
    }
    let after;
    try {
      after = captureFinalIdentitySnapshot(record);
    } catch (err) {
      return { ok: false, reason: 'REBIND_DURING_USE' };
    }
    if (!finalIdentitySnapshotsMatch(before, after)) {
      return { ok: false, reason: 'REBIND_DURING_USE' };
    }
    if (callbackThrew) throw callbackError;
    return callbackResult;
  }

  function withValidatedRoot(sealHandle, { runId, role }, creditedCallback) {
    if (!sealHandle || typeof sealHandle !== 'object') {
      return { ok: false, reason: 'VALIDATED_ROOT_INVALID_HANDLE' };
    }
    const handleSnapshot = rootHandleInternals.get(sealHandle);
    if (!handleSnapshot) {
      return { ok: false, reason: 'VALIDATED_ROOT_UNKNOWN_HANDLE' };
    }
    if (!handleMatchesSnapshot(sealHandle, handleSnapshot)) {
      return { ok: false, reason: 'VALIDATED_ROOT_HANDLE_TAMPERED' };
    }
    if (runId !== undefined && handleSnapshot.runId !== runId) {
      return { ok: false, reason: 'VALIDATED_ROOT_RUN_MISMATCH' };
    }
    if (sealHandle.state !== 'READY') {
      return { ok: false, reason: 'VALIDATED_ROOT_NOT_READY' };
    }
    if (!handleSnapshot.finalIdentitySnapshot) {
      return { ok: false, reason: 'VALIDATED_ROOT_NO_SEALED_SNAPSHOT' };
    }
    let before;
    try {
      before = captureFinalIdentitySnapshot(sealHandle);
    } catch (err) {
      return { ok: false, reason: 'VALIDATED_ROOT_PRECHECK_FAILED' };
    }
    if (!finalIdentitySnapshotsMatch(handleSnapshot.finalIdentitySnapshot, before)) {
      return { ok: false, reason: 'VALIDATED_ROOT_DRIFT_FROM_SEAL' };
    }
    const creditedReader = Object.freeze({
      configPath: handleSnapshot.configPath,
      topologyPaths: Object.freeze(Object.assign({}, handleSnapshot.topologyPaths)),
    });
    let callbackResult;
    let callbackThrew = false;
    let callbackError;
    try {
      callbackResult = creditedCallback(creditedReader);
    } catch (err) {
      callbackThrew = true;
      callbackError = err;
    }
    let after;
    try {
      after = captureFinalIdentitySnapshot(sealHandle);
    } catch (err) {
      return { ok: false, reason: 'REBIND_DURING_USE' };
    }
    if (!finalIdentitySnapshotsMatch(before, after)) {
      return { ok: false, reason: 'REBIND_DURING_USE' };
    }
    if (callbackThrew) throw callbackError;
    return callbackResult;
  }
  return { withValidatedReadView, withValidatedRoot };
}

module.exports = Object.freeze({ createIsolationRootAccess });
