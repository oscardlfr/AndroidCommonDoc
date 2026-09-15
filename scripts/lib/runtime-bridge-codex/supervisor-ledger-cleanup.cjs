'use strict';

// Extracted verbatim from runtime-bridge-codex.cjs's startOwnedAppServerSupervisorEngine:
// per-root cleanup authorization, provision-state classification, artifact-ref
// resolution and reap/receipt building for the owned-shutdown stop timeline.
// Narrow factory inputs only -- never requires the facade or either sibling
// facade, directly or transitively. `getIsolationProvider` is a zero-arg
// accessor because the real isolation provider instance is created later, by
// the SAME engine's own runStartup, than this module's own construction.

function createSupervisorLedgerCleanup({
  path, repoDescriptor, rendezvousInstanceId, registryRepoDir,
  readDurableRegistryRecordFd, REGISTRY_RECORD_MAX_BYTES, sha256Buffer,
  getIsolationProvider, fs, reapTombstonedRoot,
}) {
  /**
   * P1-A (section5 "Ownership and BORN"): builds the exact CleanupAuthorization
   * this coordinator's OWN ledger entry can genuinely prove -- PID_ABSENT
   * (backed by the published BORN record plus a fresh fd-bound read of its
   * own instanceRecordIdentity) for a role that reached BORN, NEVER_SPAWNED
   * (backed by createRunRoot's own genuine no-spawn evidence) for a role
   * whose root was created but never reached spawnWithIntent at all. Returns
   * null when neither is genuinely provable (never fabricates an
   * authorization).
   */
  function ledgerCleanupAuthorization(entry) {
    const rootHandle = entry.rootHandle;
    if (entry.spawnState === 'BORN' && entry.bornRecord) {
      const instanceRecordPath = path.join(registryRepoDir({ repoId: repoDescriptor.repoId }), 'instances', entry.instanceId + '.json');
      const instanceRecordRead = readDurableRegistryRecordFd(instanceRecordPath, REGISTRY_RECORD_MAX_BYTES);
      if (!instanceRecordRead.ok || !instanceRecordRead.exists) return null;
      return {
        outcome: 'PID_ABSENT',
        pid: entry.bornRecord.pid,
        birthToken: entry.bornRecord.os_birth_token,
        executableIdentity: entry.bornRecord.executable_path,
        instanceRecordIdentity: {
          dev: instanceRecordRead.identity.dev.toString(), ino: instanceRecordRead.identity.ino.toString(),
          mode: instanceRecordRead.identity.mode.toString(), uid: instanceRecordRead.identity.uid.toString(),
        },
        repoId: repoDescriptor.repoId, instanceId: entry.instanceId, runId: rendezvousInstanceId,
        ownerToken: entry.ownerToken,
        allowPendingAbandonment: rootHandle.state === 'PROFILE_PENDING',
      };
    }
    // P1-A / sequence144-145 correction (findings P1A-143-02/P1A-144-02):
    // NEVER_SPAWNED is authorized ONLY for a role that GENUINELY never even
    // attempted a spawn -- entry.spawnState==='NOT_ATTEMPTED' is the sole
    // value that proves this. IN_FLIGHT/BORN (with no bornRecord)/
    // spawnWithIntent's own non-BORN classifications (e.g. STOPPED,
    // UNKNOWN_OWNED, FAILED_BEFORE_PROCESS) all mean a REAL process existed
    // at some point, or its own settlement is still genuinely unknown;
    // authorizing NEVER_SPAWNED for any of them would fabricate false
    // no-spawn evidence. They fall through to returning null
    // (CLEANUP_REJECTED/PRESERVED/rc7) instead -- matching section5's own
    // "never NOT_ATTEMPTED, NEVER_SPAWNED, or a lost child/root
    // association" requirement.
    if (entry.spawnState === 'NOT_ATTEMPTED' && rootHandle.state === 'PROFILE_PENDING') {
      return {
        outcome: 'NEVER_SPAWNED', pid: null, birthToken: null, executableIdentity: null,
        instanceRecordIdentity: null,
        repoId: repoDescriptor.repoId, instanceId: entry.instanceId, runId: rendezvousInstanceId,
        ownerToken: entry.ownerToken, allowPendingAbandonment: true,
      };
    }
    return null;
  }

  function ledgerRootProvisionState(rootHandle) {
    if (rootHandle.state === 'READY') return 'READY';
    if (rootHandle.state === 'FAILED_FINALIZE_DRIFT') return 'FAILED_FINALIZE_DRIFT';
    return 'PROFILE_PENDING';
  }

  /**
   * P1-A (section5): a typed ArtifactRef {ref,digest} for a durable
   * registry artifact this SAME cleanup pass just produced/validated --
   * `ref` is the canonical path relative to this repo's own registry root
   * (registryRepoDir({repoId})), `digest` is the exact sha256 of the
   * artifact's own real bytes, read back fd-bound-adjacent (never a
   * fabricated/copied value). Returns null (never throws, never invents a
   * placeholder) if the artifact cannot actually be read back.
   */
  function ledgerArtifactRef(relPath) {
    const absPath = path.join(registryRepoDir({ repoId: repoDescriptor.repoId }), relPath);
    const read = readDurableRegistryRecordFd(absPath, REGISTRY_RECORD_MAX_BYTES);
    if (!read.ok || !read.exists) return null;
    return { ref: relPath, digest: sha256Buffer(Buffer.from(read.text, 'utf8')) };
  }

  /**
   * P1-A (section5 "One shared stop timeline", stage4): authorized
   * cleanup/retirement/reap for ONE ledger-owned root, using the SAME
   * provider instance/handle/token retained since createRunRoot. Never
   * throws -- an internal failure is reported as a PRESERVED RootReceipt,
   * never an uncaught rejection of the whole stop timeline.
   * @returns {object} RootReceipt
   */
  function cleanupLedgerRoot(entry, hardDeadlineMs) {
    const rootHandle = entry.rootHandle;
    // P1-A / sequence146-147 correction (findings P1A-145-01/P1A-146-01): a
    // COMPLETE BORN row (genuine bornRecord present, proving full
    // identity/provenance was captured) maps to 'STOPPED' ONLY once this
    // SAME exact child has ALSO been genuinely confirmed stopped
    // (entry.stopConfirmed). identity_complete stays its own independent,
    // truthful signal -- never gated on stop confirmation.
    const identityComplete = entry.spawnState === 'BORN' && !!entry.bornRecord;
    const genuinelyStopped = identityComplete && !!entry.stopConfirmed;
    const base = {
      instance_id: entry.instanceId,
      run_id: rendezvousInstanceId,
      spawn: genuinelyStopped ? 'STOPPED' : entry.spawnState,
      identity_complete: identityComplete,
      creation_complete: !!entry.creationComplete,
      provision: ledgerRootProvisionState(rootHandle),
    };
    let authorization;
    try {
      authorization = ledgerCleanupAuthorization(entry);
    } catch (err) {
      authorization = null;
    }
    if (!authorization) {
      return Object.assign({}, base, {
        cleanup_outcome: null, instance_digest: null, cleanup_intent: null, cleanup_complete: null, retired_instance: null,
        disposition: 'PRESERVED', original_root_absent: false, tombstone_root_absent: false,
        reason: 'CLEANUP_REJECTED', reason_detail: 'authorization-declined',
      });
    }
    if (Date.now() >= hardDeadlineMs) {
      return Object.assign({}, base, {
        cleanup_outcome: authorization.outcome, instance_digest: null, cleanup_intent: null, cleanup_complete: null, retired_instance: null,
        disposition: 'PRESERVED', original_root_absent: false, tombstone_root_absent: false,
        reason: 'DEADLINE_EXCEEDED',
      });
    }
    let cleanupResult;
    try {
      cleanupResult = getIsolationProvider().cleanupRoot(rootHandle, authorization);
    } catch (err) {
      cleanupResult = { ok: false, reason: 'CLEANUP_THREW' };
    }
    if (!cleanupResult || !cleanupResult.ok) {
      return Object.assign({}, base, {
        cleanup_outcome: authorization.outcome, instance_digest: null, cleanup_intent: null, cleanup_complete: null, retired_instance: null,
        disposition: 'PRESERVED', original_root_absent: false, tombstone_root_absent: false,
        reason: 'CLEANUP_REJECTED',
        reason_detail: String((cleanupResult && cleanupResult.reason) || 'no-reason-reported'),
      });
    }
    if (Date.now() >= hardDeadlineMs) {
      return Object.assign({}, base, {
        cleanup_outcome: authorization.outcome, instance_digest: null, cleanup_intent: null, cleanup_complete: null, retired_instance: null,
        disposition: 'PRESERVED', original_root_absent: false, tombstone_root_absent: false,
        reason: 'DEADLINE_EXCEEDED',
      });
    }
    let reapResult = { ok: false };
    try {
      reapResult = reapTombstonedRoot({ repoId: repoDescriptor.repoId, instanceId: entry.instanceId });
    } catch (err) {
      reapResult = { ok: false, reason: 'CLEANUP_THREW' };
    }
    let originalRootAbsent = false;
    try { originalRootAbsent = !fs.existsSync(rootHandle.intendedPath); } catch (err) { originalRootAbsent = false; }
    let tombstoneRootAbsent = false;
    try {
      const containerRootPath = path.join(registryRepoDir({ repoId: repoDescriptor.repoId }), '.tombstone', entry.instanceId, 'root');
      tombstoneRootAbsent = !fs.existsSync(containerRootPath);
    } catch (err) {
      tombstoneRootAbsent = false;
    }
    const reaped = !!(reapResult && reapResult.ok);
    const cleanupIntentRef = reaped ? ledgerArtifactRef(path.join('.tombstone', entry.instanceId, 'intent.json')) : null;
    const cleanupCompleteRef = reaped ? ledgerArtifactRef(path.join('.tombstone', entry.instanceId, 'complete.json')) : null;
    const retiredInstanceRef = (reaped && authorization.outcome === 'PID_ABSENT')
      ? ledgerArtifactRef(path.join('instances', '.tombstone', entry.instanceId + '.json'))
      : null;
    const artifactsComplete = authorization.outcome === 'PID_ABSENT'
      ? !!(cleanupIntentRef && cleanupCompleteRef && retiredInstanceRef)
      : !!(cleanupIntentRef && cleanupCompleteRef);
    const fullyReaped = reaped && artifactsComplete;
    return Object.assign({}, base, {
      cleanup_outcome: authorization.outcome,
      instance_digest: retiredInstanceRef ? retiredInstanceRef.digest : null,
      cleanup_intent: cleanupIntentRef,
      cleanup_complete: cleanupCompleteRef,
      retired_instance: retiredInstanceRef,
      disposition: fullyReaped ? 'REAPED' : 'PRESERVED',
      original_root_absent: originalRootAbsent,
      tombstone_root_absent: tombstoneRootAbsent,
      reason: fullyReaped ? null : 'REAP_FAILED',
    });
  }

  function preservedLedgerRootReceipt(entry, reasonCode) {
    const rootHandle = entry.rootHandle;
    const identityComplete = entry.spawnState === 'BORN' && !!entry.bornRecord;
    const genuinelyStopped = identityComplete && !!entry.stopConfirmed;
    return {
      instance_id: entry.instanceId,
      run_id: rendezvousInstanceId,
      spawn: genuinelyStopped ? 'STOPPED' : entry.spawnState,
      identity_complete: identityComplete,
      creation_complete: !!entry.creationComplete,
      provision: ledgerRootProvisionState(rootHandle),
      cleanup_outcome: null, instance_digest: null, cleanup_intent: null, cleanup_complete: null, retired_instance: null,
      disposition: 'PRESERVED', original_root_absent: false, tombstone_root_absent: false,
      reason: reasonCode,
    };
  }

  return Object.freeze({
    ledgerCleanupAuthorization, ledgerRootProvisionState, ledgerArtifactRef,
    cleanupLedgerRoot, preservedLedgerRootReceipt,
  });
}

module.exports = Object.freeze({ createSupervisorLedgerCleanup });
