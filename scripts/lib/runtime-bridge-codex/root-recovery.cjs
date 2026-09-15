'use strict';

function createRootRecovery({
  fs,
  path,
  registryRepoDir,
  isCoreGeneratedIdentifier,
  classifyProvisioningOwner,
  fdBoundRecordExists,
  readDurableRegistryRecordFd,
  REGISTRY_RECORD_MAX_BYTES,
  writeQuarantineRecord,
  fsyncDirSync,
  publishBridgeRegistryRecord,
  canonicalJSONStringify,
}) {

  function createAbandonedRootRecoveryAuthority(deps) {
    const dependencies = deps || {};
    const livenessProbe = dependencies.livenessProbe;

    return function classify({ repoId, instanceId, ownerIdentity, expiresAtIso, now }) {
      // CORRECTION PASS Block C: strict allowlist on every identifier segment
      // destined for a path.join call, BEFORE anything else (even before the
      // livenessProbe classification below) -- mirrors createRunRoot's own
      // requireSafeIdentifierSegments gate. CORRECTION PASS ROUND 5
      // (Finding 8): tightened to the REAL core-generated-id grammar
      // (isCoreGeneratedIdentifier, lowercase hex 32-64 chars) rather than the
      // broader ASCII-safe allowlist -- a genuinely core-generated repoId/
      // instanceId reaching a crash-recovery entry point never legitimately
      // looks like anything else.
      if (!isCoreGeneratedIdentifier(repoId) || !isCoreGeneratedIdentifier(instanceId)) {
        return 'UNSAFE_IDENTIFIER_SEGMENT';
      }
      // Fail closed to INDETERMINATE with zero backing evidence -- PLAN.md's
      // own "never authorizes destruction by itself" semantics.
      const verifiedClassification = typeof livenessProbe === 'function'
        ? classifyProvisioningOwner(
          ownerIdentity || {},
          expiresAtIso || new Date().toISOString(),
          { now: Number.isFinite(now) ? now : Date.now(), livenessProbe },
        )
        : 'INDETERMINATE';
      if (verifiedClassification === 'LIVE') return 'PID_LIVE';
      if (verifiedClassification === 'INDETERMINATE') return 'PID_INDETERMINATE';

      const spawnIntentPath = path.join(registryRepoDir({ repoId }), 'spawn-intents', instanceId + '.json');
      const spawnIntentCheck = fdBoundRecordExists(spawnIntentPath);
      if (!spawnIntentCheck.ok) return 'SPAWN_INTENT_CHECK_FAILED'; // a genuine read failure -- never conflated with durably-confirmed absence.
      if (!spawnIntentCheck.exists) {
        return 'NEVER_SPAWNED'; // DEAD + durable positive proof no spawn-intent/v1 at all.
      }

      const spawnFailedPath = path.join(registryRepoDir({ repoId }), 'spawn-intents', instanceId + '.failed.json');
      const spawnFailedCheck = fdBoundRecordExists(spawnFailedPath);
      if (!spawnFailedCheck.ok) return 'SPAWN_FAILED_RECORD_CHECK_FAILED';
      if (spawnFailedCheck.exists) {
        return 'SPAWN_FAILED_BEFORE_PROCESS'; // explicit precedence over SPAWN_OUTCOME_UNKNOWN (PLAN.md ~L1230).
      }

      const instanceLivePath = path.join(registryRepoDir({ repoId }), 'instances', instanceId + '.json');
      const instanceTombstonePath = path.join(registryRepoDir({ repoId }), 'instances', '.tombstone', instanceId + '.json');
      const instanceLiveCheck = fdBoundRecordExists(instanceLivePath);
      const instanceTombstoneCheck = fdBoundRecordExists(instanceTombstonePath);
      if (!instanceLiveCheck.ok || !instanceTombstoneCheck.ok) return 'INSTANCE_RECORD_CHECK_FAILED';
      if (instanceLiveCheck.exists || instanceTombstoneCheck.exists) {
        return 'SPAWN_OUTCOME_KNOWN'; // a matching instance record exists (live or tombstoned) -- knowable, just not this function's own further concern.
      }

      // spawn-intent/v1 present, no matching instances/<id>.json anywhere -- the
      // system genuinely cannot know the outcome without a PID that never got
      // durably captured (PLAN.md ~L1180).
      const spawnIntentRead = readDurableRegistryRecordFd(spawnIntentPath, REGISTRY_RECORD_MAX_BYTES);
      if (!spawnIntentRead.ok || !spawnIntentRead.exists) return 'SPAWN_INTENT_CHECK_FAILED';
      const intentBytes = Buffer.from(spawnIntentRead.text, 'utf8');
      let intentRunId;
      try { intentRunId = JSON.parse(spawnIntentRead.text).runId; } catch (err) { intentRunId = undefined; }
      writeQuarantineRecord({ repoId, instanceId, runId: intentRunId, reason: 'SPAWN_OUTCOME_UNKNOWN', correlatedRecordBytes: intentBytes });
      return 'SPAWN_OUTCOME_UNKNOWN';
    };
  }

  function createOrphanedProvisioningRecoveryAuthority(deps) {
    const dependencies = deps || {};
    const livenessProbe = dependencies.livenessProbe;

    return function reconcile({ repoId, instanceId }) {
      // CORRECTION PASS Block C: strict allowlist on every identifier segment
      // destined for a path.join call, BEFORE anything else -- mirrors
      // createRunRoot's own requireSafeIdentifierSegments gate. CORRECTION
      // PASS ROUND 5 (Finding 8): tightened to the REAL core-generated-id
      // grammar (isCoreGeneratedIdentifier) -- see classify()'s own sibling
      // comment above (createAbandonedRootRecoveryAuthority) for the full
      // rationale.
      if (!isCoreGeneratedIdentifier(repoId) || !isCoreGeneratedIdentifier(instanceId)) {
        return { action: 'NONE', reason: 'UNSAFE_IDENTIFIER_SEGMENT' };
      }
      const completePath = path.join(registryRepoDir({ repoId }), 'root-provisioning', instanceId + '.complete.json');
      // C08c, checked FIRST, unconditionally: a live/READY root is never
      // touched by this function, no matter what else is true.
      const completeCheck = fdBoundRecordExists(completePath);
      if (!completeCheck.ok) return { action: 'NONE', reason: 'PROVISIONING_RECOVERY_COMPLETE_CHECK_FAILED' };
      if (completeCheck.exists) {
        return { action: 'NONE', reason: 'ALREADY_READY' };
      }

      const intentPath = path.join(registryRepoDir({ repoId }), 'root-provisioning', instanceId + '.intent.json');
      const intentCheck = fdBoundRecordExists(intentPath);
      if (!intentCheck.ok) return { action: 'NONE', reason: 'PROVISIONING_RECOVERY_INTENT_CHECK_FAILED' };
      if (!intentCheck.exists) {
        return { action: 'NONE', reason: 'NOTHING_TO_RECONCILE' };
      }

      const intentRead = readDurableRegistryRecordFd(intentPath, REGISTRY_RECORD_MAX_BYTES);
      if (!intentRead.ok || !intentRead.exists) {
        return { action: 'NONE', reason: 'PROVISIONING_RECOVERY_INTENT_READ_FAILED' };
      }
      let intentRecord;
      try {
        intentRecord = JSON.parse(intentRead.text);
      } catch (err) {
        return { action: 'NONE', reason: 'PROVISIONING_RECOVERY_INTENT_MALFORMED' };
      }
      if (!intentRecord || typeof intentRecord !== 'object' || Array.isArray(intentRecord)) {
        return { action: 'NONE', reason: 'PROVISIONING_RECOVERY_INTENT_MALFORMED' };
      }
      if (intentRecord.schema !== 'coordination/root-provision-intent/v1') {
        return { action: 'NONE', reason: 'PROVISIONING_RECOVERY_INTENT_SCHEMA_INVALID' };
      }
      // Confused-deputy guard, same discipline as every other durable-record
      // reader in this file -- never trust a record for a DIFFERENT
      // repoId/instanceId than the caller's own.
      if (intentRecord.instanceId !== instanceId || intentRecord.repoId !== repoId) {
        return { action: 'NONE', reason: 'PROVISIONING_RECOVERY_INTENT_CORRELATION_MISMATCH' };
      }
      if (typeof intentRecord.intendedPath !== 'string' || intentRecord.intendedPath.length === 0) {
        return { action: 'NONE', reason: 'PROVISIONING_RECOVERY_INTENT_MALFORMED' };
      }
      // ADVERSARIAL RE-AUDIT (HARD NO-GO, 2026-07-21): intentRecord.intendedPath
      // is a bare string field read from a durable JSON file -- correlation
      // (instanceId/repoId matching, just above) proves the record CLAIMS to
      // belong to this instance, never that its own intendedPath field is
      // genuinely the path createRunRoot itself derived for it. createRunRoot
      // computes intendedPath deterministically from {repoId,instanceId} alone
      // (never caller-supplied -- see its own "HARD NO-GO RESPONSE Block C
      // (Group C)" comment, this same file), so this recovery path re-derives
      // that SAME expression and requires exact equality before a destructive
      // rename ever acts on the record's own copy of it -- a tampered,
      // corrupted, or foreign intendedPath value is rejected outright rather
      // than trusted at face value, exactly like every other confused-deputy
      // guard in this file.
      const expectedIntendedPath = path.join(registryRepoDir({ repoId }), 'isolation-roots', instanceId);
      if (intentRecord.intendedPath !== expectedIntendedPath) {
        return { action: 'NONE', reason: 'PROVISIONING_RECOVERY_INTENT_PATH_MISMATCH' };
      }

      const verifiedClassification = typeof livenessProbe === 'function'
        ? classifyProvisioningOwner(
          intentRecord.ownerIdentity || {},
          intentRecord.expiresAt || new Date().toISOString(),
          { now: Date.now(), livenessProbe },
        )
        : 'INDETERMINATE';
      if (verifiedClassification === 'LIVE') return { action: 'NONE', reason: 'PID_LIVE' };
      if (verifiedClassification === 'INDETERMINATE') return { action: 'NONE', reason: 'PID_INDETERMINATE' };
      // DEAD past this point -- destructive action is authorized, PLAN's own
      // "DEAD permits recovery immediately" (classifyProvisioningOwner's own
      // docblock).

      let leafStat;
      try {
        leafStat = fs.lstatSync(intentRecord.intendedPath);
      } catch (err) {
        if (!(err && err.code === 'ENOENT')) {
          return { action: 'NONE', reason: 'PROVISIONING_RECOVERY_LEAF_CHECK_FAILED' };
        }
        leafStat = null;
      }

      if (!leafStat) {
        // C08a: nothing risky ever happened -- retire the stale intent record
        // alone. Fresh fd-bound open(O_NOFOLLOW)+fstat immediately before the
        // unlink, mirroring retireInstanceRecordLocked's own pre-unlink
        // discipline (identity, never content alone, gates a destructive
        // action) -- the single positive condition for unlink is the fresh
        // reopen succeeding AND its identity matching what the earlier
        // readDurableRegistryRecordFd call above already captured; every other
        // outcome is a named STOP with no unlink attempted.
        let recheckFd;
        try {
          recheckFd = fs.openSync(intentPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
        } catch (err) {
          if (err && err.code === 'ENOENT') return { action: 'NONE', reason: 'PROVISIONING_RECOVERY_INTENT_VANISHED' };
          return { action: 'NONE', reason: 'PROVISIONING_RECOVERY_INTENT_CHECK_FAILED' };
        }
        let recheckIdentity;
        try {
          const st = fs.fstatSync(recheckFd, { bigint: true });
          recheckIdentity = { dev: st.dev, ino: st.ino };
        } finally {
          try { fs.closeSync(recheckFd); } catch (e) { /* best-effort */ }
        }
        if (recheckIdentity.dev !== intentRead.identity.dev || recheckIdentity.ino !== intentRead.identity.ino) {
          return { action: 'NONE', reason: 'PROVISIONING_RECOVERY_INTENT_REBIND_DETECTED' };
        }
        try {
          fs.unlinkSync(intentPath);
        } catch (err) {
          return { action: 'NONE', reason: 'PROVISIONING_RECOVERY_INTENT_UNLINK_FAILED' };
        }
        if (!fsyncDirSync(path.dirname(intentPath))) {
          return { action: 'NONE', reason: 'PROVISIONING_RECOVERY_FSYNC_FAILED' };
        }
        return { action: 'RETIRED_INTENT', reason: 'DEAD_NO_LEAF' };
      }

      // C08b: the leaf directory exists -- tombstone it, mirroring cleanupRoot's
      // own sequence (re-read fully before writing this) from containerDir/path
      // computation through post-rename inode verification and
      // cleanup-complete/v1/cleanup-integrity-failure/v1 publication. SAME
      // schemas, SAME field shapes, SAME fd-bound pre-rename/recheck/
      // post-rename-verify discipline -- an independent implementation, not
      // shared code (see this function's own docblock above).
      const runId = intentRecord.runId;
      const intendedPath = intentRecord.intendedPath;
      const containerDir = path.join(registryRepoDir({ repoId }), '.tombstone', instanceId);
      const cleanupIntentPath = path.join(containerDir, 'intent.json');
      const cleanupCompletePath = path.join(containerDir, 'complete.json');
      const integrityFailurePath = path.join(containerDir, 'integrity-failure.json');
      const destinationPath = path.join(containerDir, 'root');

      // ROUND 8 (Finding 3): same reorder as cleanupRoot's own fix -- rootInode
      // (below) must be a genuine pre-rename snapshot EMBEDDED in the
      // published intent record, so it must be captured BEFORE
      // cleanupIntentRecord is constructed/published.
      let preRenameFd;
      try {
        preRenameFd = fs.openSync(intendedPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      } catch (err) {
        return { action: 'NONE', reason: 'CLEANUP_ROOT_MISSING_BEFORE_RENAME' };
      }
      let preRenameIdentity;
      try {
        const st = fs.fstatSync(preRenameFd, { bigint: true });
        preRenameIdentity = { dev: st.dev, ino: st.ino };
      } finally {
        try { fs.closeSync(preRenameFd); } catch (e) { /* best-effort */ }
      }

      // ROUND 8 (Finding 3) / ROUND 9 (P1-1): brought up to the SAME full R4
      // §7 shape as cleanupRoot's own cleanup-intent/v1 (confirmed directly
      // against the design doc, not paraphrased) -- this path is
      // PROVISIONING-crash recovery specifically (this function's own
      // C08a/C08b framing: nothing was ever spawned), so outcome is
      // 'NEVER_SPAWNED'. ROUND 9 correction: the design doc's
      // PreSpawnAbandonmentDescriptor shape for NEVER_SPAWNED omits
      // pid/birthToken/executableIdentity/instanceRecordIdentity ENTIRELY,
      // never present-as-null (same fix as cleanupRoot's own intentRecord,
      // above) -- this path always takes that branch since it is always
      // NEVER_SPAWNED. Field renamed createdAt -> intentAt, matching the
      // design doc's own literal name.
      const cleanupIntentRecord = {
        schema: 'coordination/cleanup-intent/v1',
        instanceId, repoId, runId,
        intendedPath,
        rootInode: { dev: preRenameIdentity.dev.toString(), ino: preRenameIdentity.ino.toString() },
        outcome: 'NEVER_SPAWNED',
        intentAt: new Date().toISOString(),
      };
      try {
        publishBridgeRegistryRecord(cleanupIntentPath, Buffer.from(canonicalJSONStringify(cleanupIntentRecord), 'utf8'));
      } catch (err) {
        return { action: 'NONE', reason: (err && err.detailCode) || 'CLEANUP_INTENT_PUBLISH_FAILED' };
      }

      // Immediate fd-bound re-check, directly adjacent to the rename call --
      // identity (dev+ino), never path/content alone, gates the rename.
      let preRenameRecheckFd;
      try {
        preRenameRecheckFd = fs.openSync(intendedPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      } catch (err) {
        return { action: 'NONE', reason: 'CLEANUP_ROOT_VANISHED_BEFORE_RENAME' };
      }
      let preRenameRecheckIdentity;
      try {
        const st = fs.fstatSync(preRenameRecheckFd, { bigint: true });
        preRenameRecheckIdentity = { dev: st.dev, ino: st.ino };
      } finally {
        try { fs.closeSync(preRenameRecheckFd); } catch (e) { /* best-effort */ }
      }
      if (preRenameRecheckIdentity.dev !== preRenameIdentity.dev || preRenameRecheckIdentity.ino !== preRenameIdentity.ino) {
        return { action: 'NONE', reason: 'CLEANUP_ROOT_REBIND_DETECTED' };
      }

      const originalParentDir = path.dirname(intendedPath);
      try {
        fs.renameSync(intendedPath, destinationPath);
      } catch (err) {
        return { action: 'NONE', reason: 'CLEANUP_RENAME_FAILED' };
      }
      if (!fsyncDirSync(originalParentDir) || !fsyncDirSync(containerDir)) {
        return { action: 'NONE', reason: 'CLEANUP_FSYNC_FAILED' };
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
          instanceId, repoId, runId,
          expectedInode: preRenameIdentity.ino.toString(),
          observedInode: postRenameStat ? postRenameStat.ino.toString() : null,
          detectedAt: new Date().toISOString(),
        };
        try {
          publishBridgeRegistryRecord(integrityFailurePath, Buffer.from(canonicalJSONStringify(failureRecord), 'utf8'));
        } catch (err) { /* best-effort -- the STOP (never publishing cleanup-complete/v1) is the primary contract */ }
        return { action: 'NONE', reason: 'CLEANUP_INTEGRITY_FAILURE' };
      }

      // ROUND 8 (Finding 3): rootInodeAfter added, same as cleanupRoot's own
      // fix -- postRenameStat is guaranteed non-null here (inodeMatches, just
      // checked above, requires it).
      const cleanupCompleteRecord = {
        schema: 'coordination/cleanup-complete/v1',
        instanceId, repoId, runId,
        finalPath: destinationPath,
        rootInodeAfter: { dev: postRenameStat.dev.toString(), ino: postRenameStat.ino.toString() },
        completedAt: new Date().toISOString(),
      };
      try {
        publishBridgeRegistryRecord(cleanupCompletePath, Buffer.from(canonicalJSONStringify(cleanupCompleteRecord), 'utf8'));
      } catch (err) {
        return { action: 'NONE', reason: (err && err.detailCode) || 'CLEANUP_COMPLETE_PUBLISH_FAILED' };
      }
      return { action: 'TOMBSTONED', reason: 'DEAD_WITH_LEAF', finalPath: destinationPath };
    };
  }

  return Object.freeze({ createAbandonedRootRecoveryAuthority, createOrphanedProvisioningRecoveryAuthority });
}

module.exports = Object.freeze({ createRootRecovery });
