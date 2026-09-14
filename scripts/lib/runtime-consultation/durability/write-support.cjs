'use strict';

const fs = require('fs');
const { CliError, isTestCapability } = require('../primitives.cjs');
const { statIsRegularFile } = require('./common.cjs');

function createWriteSupport() {
  let dirFsyncFaultInjectedCount = 0;
  let dirCloseFaultInjectedCount = 0;
  let lastFsyncDirError = null;

  function isDirFsyncFaultActive(barrierLabel) {
    if (!isTestCapability()) return false;
    const v = process.env.RUNTIME_CONSULTATION_FAULT_DIR_FSYNC;
    if (typeof v !== 'string' || v.length === 0) return false;
    // "1"/"all" fails EVERY directory barrier (backward-compat, DUR-01). Otherwise
    // the value names the single barrier to fail independently -- "barrier1",
    // "barrier2" (publishNoClobber), or "replace" (publishReplace) -- so a RED test
    // can prove each barrier's own fail-closed behavior in isolation.
    return v === '1' || v === 'all' || v === barrierLabel;
  }

  function isDirCloseFaultActive(barrierLabel) {
    if (!isTestCapability()) return false;
    const v = process.env.RUNTIME_CONSULTATION_FAULT_DIR_CLOSE;
    if (typeof v !== 'string' || v.length === 0) return false;
    return v === '1' || v === 'all' || v === barrierLabel;
  }

  function isTempUnlinkFaultActive() {
    return (
      isTestCapability()
      && typeof process.env.RUNTIME_CONSULTATION_FAULT_TEMP_UNLINK === 'string'
      && process.env.RUNTIME_CONSULTATION_FAULT_TEMP_UNLINK.length > 0
    );
  }

  function isLoserUnlinkFaultActive() {
    return (
      isTestCapability()
      && typeof process.env.RUNTIME_CONSULTATION_FAULT_LOSER_UNLINK === 'string'
      && process.env.RUNTIME_CONSULTATION_FAULT_LOSER_UNLINK.length > 0
    );
  }

  function isTempFsyncFaultActive() {
    return (
      isTestCapability()
      && typeof process.env.RUNTIME_CONSULTATION_FAULT_TEMP_FSYNC === 'string'
      && process.env.RUNTIME_CONSULTATION_FAULT_TEMP_FSYNC.length > 0
    );
  }

  function isTempHardenFaultActive(phase) {
    return isTestCapability() && process.env.RUNTIME_CONSULTATION_FAULT_TEMP_HARDEN === phase;
  }

  function isNoclobberPrelinkFaultActive(phase) {
    return isTestCapability() && process.env.RUNTIME_CONSULTATION_FAULT_NOCLOBBER_PRELINK === phase;
  }

  function isNoclobberPrevalidateFaultActive(phase) {
    return isTestCapability() && process.env.RUNTIME_CONSULTATION_FAULT_NOCLOBBER_PREVALIDATE === phase;
  }

  function isLockRmdirFaultActive() {
    return (
      isTestCapability()
      && typeof process.env.RUNTIME_CONSULTATION_FAULT_LOCK_RMDIR === 'string'
      && process.env.RUNTIME_CONSULTATION_FAULT_LOCK_RMDIR.length > 0
    );
  }

  function isReplacePostRenameFaultActive(step) {
    return isTestCapability() && process.env.RUNTIME_CONSULTATION_FAULT_REPLACE_POSTRENAME === step;
  }

  function fsyncDir(dirPath, barrierLabel, suppressFaultInjection) {
    let fd;
    let proven = false;
    let primaryClosed = false;
    try {
      // libuv maps a Windows directory opened read-only to a handle on which
      // FlushFileBuffers fails with EPERM. Opening that same directory read/write
      // yields a flush-capable handle; POSIX directories must remain read-only
      // because O_RDWR is rejected there (typically EISDIR).
      fd = fs.openSync(dirPath, process.platform === 'win32' ? 'r+' : 'r');
      if (!suppressFaultInjection && isDirFsyncFaultActive(barrierLabel)) {
        dirFsyncFaultInjectedCount += 1;
        const injected = new Error('simulated directory-fsync failure (RUNTIME_CONSULTATION_FAULT_DIR_FSYNC)');
        injected.code = 'EIO';
        throw injected;
      }
      fs.fsyncSync(fd);
      if (!suppressFaultInjection && isDirCloseFaultActive(barrierLabel)) {
        dirCloseFaultInjectedCount += 1;
        const injected = new Error('simulated directory-close failure (RUNTIME_CONSULTATION_FAULT_DIR_CLOSE)');
        injected.code = 'EIO';
        throw injected;
      }
      fs.closeSync(fd);
      primaryClosed = true;
      lastFsyncDirError = null;
      proven = true;
    } catch (err) {
      lastFsyncDirError = err;
      proven = false;
    } finally {
      if (fd !== undefined && !primaryClosed) {
        try { fs.closeSync(fd); } catch (err) { /* best-effort cleanup after an already-failed/faulted primary close */ }
      }
    }
    return proven;
  }

  function fsyncDirCauseSuffix() {
    return lastFsyncDirError ? (' (' + (lastFsyncDirError.message || lastFsyncDirError.code) + ')') : '';
  }

  function writeAllSync(fd, buffer) {
    let offset = 0;
    while (offset < buffer.length) {
      const written = fs.writeSync(fd, buffer, offset, buffer.length - offset);
      // A blocking write to a regular file advances by >=1 byte or throws. A 0-byte
      // return with bytes still pending can make no forward progress -- fail closed
      // (DUR-A) rather than spin forever on the durability write path.
      if (written <= 0) {
        throw new Error('writeSync made no progress (' + written + ' of ' + (buffer.length - offset) + ' pending bytes) on fd ' + fd);
      }
      offset += written;
    }
  }

  function hardenTempFdExact0600(fd, tempPath, suppressFaultInjection) {
    if (process.platform === 'win32') return; // POSIX-mode discipline only; Windows ACL confinement is PENDING_CI.
    try {
      if (!suppressFaultInjection && isTempHardenFaultActive('fchmod')) {
        const injected = new Error('injected temp-harden fchmod failure (RUNTIME_CONSULTATION_FAULT_TEMP_HARDEN=fchmod)');
        injected.code = 'EIO';
        throw injected;
      }
      fs.fchmodSync(fd, 0o600);
    } catch (err) {
      throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'temp fchmod to exact 0600 failed: ' + tempPath + ' (' + (err && err.message) + ')');
    }
    let st;
    try {
      if (!suppressFaultInjection && isTempHardenFaultActive('fstat')) {
        const injected = new Error('injected temp-harden fstat failure (RUNTIME_CONSULTATION_FAULT_TEMP_HARDEN=fstat)');
        injected.code = 'EIO';
        throw injected;
      }
      st = fs.fstatSync(fd, { bigint: true });
    } catch (err) {
      throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'temp fstat after fchmod failed: ' + tempPath + ' (' + (err && err.message) + ')');
    }
    if (!statIsRegularFile(st)) {
      throw new CliError('INVALID', 'SECURITY_INVALID', 'temp is not a regular file after fchmod: ' + tempPath);
    }
    if ((st.mode & 0o777n) !== 0o600n) {
      throw new CliError('INVALID', 'SECURITY_INVALID', 'temp mode is not exact owner-only 0600 after fchmod: ' + tempPath);
    }
    if (typeof process.getuid === 'function' && st.uid !== BigInt(process.getuid())) {
      throw new CliError('INVALID', 'SECURITY_INVALID', 'temp owner is not the current process after fchmod: ' + tempPath);
    }
  }

  function assertDurable(targetPath) {
    let stat;
    try {
      stat = fs.lstatSync(targetPath);
    } catch (err) {
      throw new CliError('INVALID', 'SCHEMA_INVALID', 'artifact not found: ' + targetPath);
    }
    if (!stat.isFile()) {
      throw new CliError('INVALID', 'SCHEMA_INVALID', 'artifact is not a regular file: ' + targetPath);
    }
    if (stat.nlink !== 1) {
      throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'artifact nlink!=1, not yet durable: ' + targetPath);
    }
  }

  return {
    assertDurable, fsyncDir, fsyncDirCauseSuffix, hardenTempFdExact0600,
    isLockRmdirFaultActive, isLoserUnlinkFaultActive,
    isNoclobberPrelinkFaultActive, isNoclobberPrevalidateFaultActive,
    isReplacePostRenameFaultActive, isTempFsyncFaultActive,
    isTempUnlinkFaultActive, writeAllSync,
  };
}

module.exports = { createWriteSupport };
