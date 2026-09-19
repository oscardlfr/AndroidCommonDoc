'use strict';

function createRegistryRecordIo({
  fs,
  path,
  publishNoClobber,
  ensureSecureRegistryDir,
  registryBaseDir,
  registryRepoDir,
  canonicalJSONStringify,
  rc,
}) {

  /**
   * Publish one immutable bridge record inside the private runtime registry.
   * The durability primitive does not establish Windows ACL ownership, so the
   * authority-bearing parent is secured and validated before publication.
   * Coordination-root artifacts retain their separate confinement contract.
   */
  function publishBridgeRegistryRecord(targetPath, bytes, options) {
    const registryBase = path.resolve(registryBaseDir());
    const target = path.resolve(targetPath);
    const relative = path.relative(registryBase, target);
    if (relative === '' || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
      const error = new Error('bridge registry record path is outside the registry base');
      error.code = 'REGISTRY_RECORD_PATH_OUTSIDE_BASE';
      error.detailCode = 'REGISTRY_RECORD_PATH_OUTSIDE_BASE';
      throw error;
    }
    const secured = ensureSecureRegistryDir(path.dirname(targetPath));
    if (!secured.ok) {
      const error = new Error('bridge registry record directory is insecure: ' + (secured.reason || 'unknown'));
      error.code = 'REGISTRY_RECORD_DIRECTORY_INSECURE';
      error.detailCode = 'REGISTRY_RECORD_DIRECTORY_INSECURE';
      error.registryDirectoryReason = secured.reason || 'unknown';
      throw error;
    }
    return publishNoClobber(targetPath, bytes, options);
  }

  function fsyncDirSync(dirPath) {
    let fd;
    try {
      // libuv's read-only directory handle cannot be flushed on Windows
      // (FlushFileBuffers returns EPERM). A read/write directory handle is
      // flush-capable there; POSIX must retain read-only because O_RDWR on a
      // directory is rejected. This mirrors runtime-consultation.cjs's proven
      // cross-platform durability barrier.
      fd = fs.openSync(dirPath, process.platform === 'win32' ? 'r+' : 'r');
      fs.fsyncSync(fd);
      return true;
    } catch (err) {
      return false;
    } finally {
      if (fd !== undefined) { try { fs.closeSync(fd); } catch (e) { /* best-effort */ } }
    }
  }

  const QUARANTINE_REASON_ENUM = Object.freeze(['SPAWN_OUTCOME_UNKNOWN', 'PID_LIVE', 'PID_INDETERMINATE', 'RENAMED_WITHOUT_COMPLETE', 'STOP_UNCONFIRMED']);

  const SPAWN_FAILED_REASON_ENUM = Object.freeze(new Set(['synchronous-throw', 'error-event-before-spawn']));

  function writeQuarantineRecord({ repoId, instanceId, runId, reason, correlatedRecordBytes }) {
    if (!QUARANTINE_REASON_ENUM.includes(reason)) {
      throw new TypeError('writeQuarantineRecord: reason must be one of ' + QUARANTINE_REASON_ENUM.join('|') + ', got: ' + reason);
    }
    const record = {
      schema: 'coordination/quarantine/v1',
      instanceId, repoId, runId,
      reason,
      correlatedRecordDigest: rc.sha256Buffer(correlatedRecordBytes),
      quarantinedAt: new Date().toISOString(),
    };
    const quarantinePath = path.join(registryRepoDir({ repoId }), 'quarantine', instanceId + '.json');
    try {
      publishBridgeRegistryRecord(quarantinePath, Buffer.from(canonicalJSONStringify(record), 'utf8'));
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: (err && err.detailCode) || 'QUARANTINE_PUBLISH_FAILED' };
    }
  }

  function fdBoundRecordExists(recordPath) {
    try {
      const fd = fs.openSync(recordPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      fs.closeSync(fd);
      return { ok: true, exists: true };
    } catch (err) {
      if (err && err.code === 'ENOENT') return { ok: true, exists: false };
      return { ok: false }; // a genuine read failure -- caller must fail closed, never conflate with absence.
    }
  }

  // Every field that witnesses a change to the file under an open descriptor.
  // This comparison is the SOLE integrity guard for a durable registry record
  // -- no digest backs it -- so it uses the full list, same rule as PR #247's
  // app-server-pin.cjs: one named list rather than a hand-picked subset per
  // site, because a hand-picked subset is how a field goes missing.
  //
  // ctimeNs strengthens detection but is not unforgeable everywhere: POSIX has
  // no call that sets it directly; Windows ChangeTime IS settable given
  // FILE_WRITE_ATTRIBUTES, so it narrows what detection catches there rather
  // than closing a gap in the same-uid boundary. Full guarantee:
  // docs/agents/runtime-messaging-trust-boundaries.md. atimeNs is excluded --
  // reading the file changes it, which would make every check fail.
  const IDENTITY_FIELDS = Object.freeze([
    'dev', 'ino', 'mode', 'uid', 'gid', 'nlink', 'size', 'ctimeNs', 'mtimeNs',
  ]);
  const identityUnchanged = (a, b) => IDENTITY_FIELDS.every((f) => a[f] === b[f]);

  const REGISTRY_RECORD_MAX_BYTES = 32 * 1024;

  function readDurableRegistryRecordFd(recordPath, maxBytes) {
    let initialLstat;
    try {
      initialLstat = fs.lstatSync(recordPath, { bigint: true });
    } catch (err) {
      if (err && err.code === 'ENOENT') return { ok: true, exists: false };
      return { ok: false, reason: 'REGISTRY_RECORD_READ_FAILED' };
    }
    if (initialLstat.isSymbolicLink()) return { ok: false, reason: 'REGISTRY_RECORD_SYMLINK_REJECTED' };

    let fd;
    try {
      fd = fs.openSync(recordPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    } catch (err) {
      if (err && err.code === 'ENOENT') return { ok: true, exists: false };
      if (err && err.code === 'ELOOP') return { ok: false, reason: 'REGISTRY_RECORD_SYMLINK_REJECTED' };
      return { ok: false, reason: 'REGISTRY_RECORD_READ_FAILED' };
    }
    try {
      const st = fs.fstatSync(fd, { bigint: true });
      if (!st.isFile()) return { ok: false, reason: 'REGISTRY_RECORD_NOT_REGULAR_FILE' };
      // Windows does not expose POSIX ownership/mode confinement through
      // fs.Stat: mode bits collapse to the read-only attribute and cannot
      // represent 0600. The enclosing registry directory is protected by the
      // fail-closed Windows ACL primitive before these internally-derived
      // records are published/read; retain the exact uid/mode checks on POSIX.
      if (process.platform !== 'win32') {
        if (typeof process.getuid === 'function' && st.uid !== BigInt(process.getuid())) {
          return { ok: false, reason: 'REGISTRY_RECORD_OWNER_MISMATCH' };
        }
        if ((st.mode & 0o777n) !== 0o600n) {
          return { ok: false, reason: 'REGISTRY_RECORD_FILE_MODE_INVALID' };
        }
      }
      if (st.nlink !== 1n) {
        return { ok: false, reason: 'REGISTRY_RECORD_NLINK_INVALID' };
      }
      if (st.dev !== initialLstat.dev || st.ino !== initialLstat.ino) {
        return { ok: false, reason: 'REGISTRY_RECORD_IDENTITY_MISMATCH' }; // swapped between the pre-open lstat and the fd's own fstat.
      }
      if (st.size > BigInt(maxBytes)) return { ok: false, reason: 'REGISTRY_RECORD_OVERSIZED' };
      const size = Number(st.size);
      const buf = Buffer.alloc(size);
      let offset = 0;
      while (offset < buf.length) {
        const bytesRead = fs.readSync(fd, buf, offset, buf.length - offset, null);
        if (bytesRead <= 0) break;
        offset += bytesRead;
      }
      if (offset !== size) return { ok: false, reason: 'REGISTRY_RECORD_SHORT_READ' };

      const stAfter = fs.fstatSync(fd, { bigint: true });
      if (!identityUnchanged(stAfter, st)) {
        return { ok: false, reason: 'REGISTRY_RECORD_IDENTITY_MISMATCH' }; // changed identity/metadata DURING the read.
      }

      let text;
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
      } catch (err) {
        return { ok: false, reason: 'REGISTRY_RECORD_INVALID_UTF8' };
      }

      let finalLstat;
      try {
        finalLstat = fs.lstatSync(recordPath, { bigint: true });
      } catch (err) {
        return { ok: false, reason: 'REGISTRY_RECORD_IDENTITY_MISMATCH' };
      }
      if (finalLstat.isSymbolicLink() || finalLstat.dev !== initialLstat.dev || finalLstat.ino !== initialLstat.ino) {
        return { ok: false, reason: 'REGISTRY_RECORD_IDENTITY_MISMATCH' }; // the PATH itself was swapped during the operation.
      }

      // Blocker D (C3-ISO-C08a/b/c): purely additive -- the already-computed,
      // already-verified fd identity, for a caller that needs a fresh-identity-
      // recheck-immediately-before-a-destructive-action pattern (mirroring
      // retireInstanceRecordLocked's own pre-unlink discipline) against a
      // record it read earlier via this same function. `identity.dev`/`.ino`
      // are raw BigInt (createOrphanedProvisioningRecoveryAuthority's own
      // reconcile() already compares them directly against a fresh raw-BigInt
      // fstat, confirmed by direct read -- changing these two to strings
      // would have silently broken that real, existing comparison).
      // ROUND 7 (Finding 1 item 5): `mode`/`uid` ADDED (also raw BigInt, same
      // convention as dev/ino here) so a caller needing R4 §7's full
      // {dev,ino,mode,uid} instanceRecordIdentity shape (isValidCleanupAuthorization)
      // can get BOTH content and identity from this ONE already-open fd,
      // instead of a second, independent fdBoundIdentityTuple open on the same
      // path (a real TOCTOU window between the two reads). Purely additive --
      // no existing caller reads mode/uid from this return today.
      return { ok: true, exists: true, text, identity: { dev: st.dev, ino: st.ino, mode: st.mode, uid: st.uid } };
    } finally {
      try { fs.closeSync(fd); } catch (err) { /* best-effort close */ }
    }
  }

  return Object.freeze({ publishBridgeRegistryRecord, fsyncDirSync, QUARANTINE_REASON_ENUM, SPAWN_FAILED_REASON_ENUM, writeQuarantineRecord, fdBoundRecordExists, REGISTRY_RECORD_MAX_BYTES, readDurableRegistryRecordFd });
}

module.exports = Object.freeze({ createRegistryRecordIo });
