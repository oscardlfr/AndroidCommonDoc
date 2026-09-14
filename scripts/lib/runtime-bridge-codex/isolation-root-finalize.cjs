'use strict';

function createIsolationRootFinalize({
  fs, crypto, rc, strictConfigValidator, safeValidatedScope,
  rootHandleInternals, handleMatchesSnapshot, isSafeIdentifierSegment,
  fdBoundConfigIdentityAndDigest, fsyncFileAndParentDir,
  captureFinalIdentitySnapshot, finalIdentitySnapshotsMatch,
  isRootFinalizeFaultActive, cleanupRoot, readDurableRegistryRecordFd,
  REGISTRY_RECORD_MAX_BYTES, publishBridgeRegistryRecord,
  canonicalJSONStringify,
}) {
  function finalizeRunRoot(handle, { role, capability }) {
    const record = handle;
    if (!record || typeof record !== 'object') {
      return { ok: false, reason: 'ROOT_FINALIZE_INVALID_HANDLE' };
    }
    const handleSnapshot = rootHandleInternals.get(record);
    if (!handleSnapshot) {
      return { ok: false, reason: 'ROOT_FINALIZE_UNKNOWN_HANDLE' };
    }
    if (!handleMatchesSnapshot(record, handleSnapshot)) {
      return { ok: false, reason: 'ROOT_FINALIZE_HANDLE_TAMPERED' };
    }
    if (record.state !== 'PROFILE_PENDING') {
      return { ok: false, reason: 'ROOT_NOT_PROFILE_PENDING' };
    }
    if (typeof role !== 'string' || role.length === 0 || !isSafeIdentifierSegment(role)) {
      return { ok: false, reason: 'ROOT_FINALIZE_ROLE_REQUIRED' };
    }
    if (!capability) {
      return { ok: false, reason: 'ROOT_FINALIZE_CAPABILITY_REQUIRED' };
    }
    const scopeResult = safeValidatedScope(capability, { runId: record.runId, role }, (workspaceRoots) => {
      let configReadResult;
      try {
        configReadResult = fdBoundConfigIdentityAndDigest(record.configPath);
      } catch (err) {
        return { ok: false, reason: 'ROOT_FINALIZE_CONFIG_READ_FAILED' };
      }
      const existingConfigText = configReadResult.text;
      const roleProfileName = role + '-profile';
      const firstTableHeaderIdx = existingConfigText.indexOf('[');
      const topLevelInsertion = 'default_permissions = ' + JSON.stringify(roleProfileName) + '\n\n';
      const reorderedConfigText = firstTableHeaderIdx === -1
        ? topLevelInsertion + existingConfigText
        : existingConfigText.slice(0, firstTableHeaderIdx) + topLevelInsertion + existingConfigText.slice(firstTableHeaderIdx);
      const workspaceRootsToml = 'workspace_roots = { read = false, write = false }\n';
      const filesystemToml = 'filesystem = { '
        + workspaceRoots.map((p) => JSON.stringify(p) + ' = "read"').join(', ')
        + ' }\n';
      const finalConfigText = reorderedConfigText
        + '\n[permissions.' + roleProfileName + ']\n'
        + workspaceRootsToml
        + filesystemToml
        + 'network.enabled = false\n';
      const configTempPath = record.configPath + '.tmp-' + process.pid + '-' + crypto.randomBytes(6).toString('hex');
      try {
        fs.writeFileSync(configTempPath, finalConfigText, { mode: 0o600 });
        const tempFd = fs.openSync(configTempPath, process.platform === 'win32' ? 'r+' : 'r');
        try { fs.fsyncSync(tempFd); } finally { fs.closeSync(tempFd); }
        fs.renameSync(configTempPath, record.configPath);
      } catch (err) {
        try { fs.unlinkSync(configTempPath); } catch (cleanupErr) { /* best-effort */ }
        return {
          ok: false,
          reason: 'ROOT_FINALIZE_CONFIG_WRITE_FAILED:'
            + String((err && err.code) || 'unknown')
            + ':' + String((err && err.syscall) || 'unknown'),
        };
      }

      const strictResult = strictConfigValidator(record.configPath);
      if (!strictResult || strictResult.ok !== true) {
        return { ok: false, reason: 'ROOT_FINALIZE_STRICT_CONFIG_INVALID' };
      }

      if (!fsyncFileAndParentDir(record.configPath)) {
        return { ok: false, reason: 'ROOT_FINALIZE_DURABILITY_UNPROVEN' };
      }
      return { ok: true };
    });
    if (!scopeResult || scopeResult.ok !== true) {
      return { ok: false, reason: (scopeResult && scopeResult.reason) || 'ROOT_FINALIZE_VALIDATED_SCOPE_REJECTED' };
    }

    let snapshot;
    try {
      snapshot = captureFinalIdentitySnapshot(record);
    } catch (err) {
      return { ok: false, reason: 'ROOT_FINALIZE_IDENTITY_CAPTURE_FAILED' };
    }

    if (isRootFinalizeFaultActive('post-snapshot-mutate')) {
      try {
        fs.appendFileSync(record.configPath, '\n# test-only fault-injection: simulated post-snapshot tamper, never a real credential\n');
      } catch (err) { /* best-effort test seam */ }
    }

    let rederived;
    try {
      rederived = captureFinalIdentitySnapshot(record);
    } catch (err) {
      return { ok: false, reason: 'ROOT_FINALIZE_IDENTITY_CAPTURE_FAILED' };
    }
    if (!finalIdentitySnapshotsMatch(snapshot, rederived)) {
      const tombstoneResult = cleanupRoot(record, {
        allowPendingAbandonment: true,
        outcome: 'NEVER_SPAWNED',
        pid: null, birthToken: null, executableIdentity: null, instanceRecordIdentity: null,
        repoId: record.repoId, instanceId: record.instanceId, runId: record.runId,
        ownerToken: handleSnapshot.ownerToken,
      });
      record.state = 'FAILED_FINALIZE_DRIFT';
      if (!tombstoneResult.ok) {
        return { ok: false, reason: 'ROOT_FINALIZE_IDENTITY_DRIFT_TOMBSTONE_FAILED' };
      }
      return { ok: false, reason: 'ROOT_FINALIZE_IDENTITY_DRIFT' };
    }

    const intentReadResult = readDurableRegistryRecordFd(record.intentPath, REGISTRY_RECORD_MAX_BYTES);
    if (!intentReadResult.ok || !intentReadResult.exists) {
      return {
        ok: false,
        reason: 'ROOT_FINALIZE_INTENT_READ_FAILED:'
          + String((intentReadResult && intentReadResult.reason) || 'absent'),
      };
    }
    const intentBytes = Buffer.from(intentReadResult.text, 'utf8');
    const completeRecord = {
      schema: 'coordination/root-provision-complete/v1',
      instanceId: record.instanceId,
      repoId: record.repoId,
      runId: record.runId,
      finalPath: record.intendedPath,
      writer: 'IsolationProvider',
      correlatedIntentDigest: rc.sha256Buffer(intentBytes),
      finalIdentitySnapshot: snapshot,
      completedAt: new Date().toISOString(),
    };
    try {
      publishBridgeRegistryRecord(record.completePath, Buffer.from(canonicalJSONStringify(completeRecord), 'utf8'));
    } catch (err) {
      return { ok: false, reason: (err && err.detailCode) || 'ROOT_FINALIZE_COMPLETE_PUBLISH_FAILED' };
    }

    record.state = 'READY';
    record.finalIdentitySnapshot = snapshot;
    rootHandleInternals.set(record, Object.assign({}, handleSnapshot, { state: 'READY', finalIdentitySnapshot: snapshot }));
    return { ok: true, finalPath: record.intendedPath, finalIdentitySnapshot: snapshot };
  }
  return finalizeRunRoot;
}

module.exports = Object.freeze({ createIsolationRootFinalize });
