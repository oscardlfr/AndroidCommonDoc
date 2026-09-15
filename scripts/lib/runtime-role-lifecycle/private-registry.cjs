'use strict';

// Extracted verbatim from runtime-role-lifecycle.cjs (formerly lines 1023-1302):
// Windows common-app-data resolution, registry base/repo paths, secure
// registry directory enforcement, replace publication, fd-bound registry
// reads and bounded registry locking. Narrow factory inputs only -- never
// requires the facade or either sibling facade, directly or transitively.
// `currentClockMsForRegistry` is supplied by the facade via a forwarding
// thunk to session-generation.cjs's own output (breaks the two-way runtime
// dependency between this module and session-generation.cjs without either
// module requiring the other).

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

function createPrivateRegistryModule({
  computePrincipalId, computeRepoId, realpathOrSelf,
  resolvedWindowsPowerShellPath, windowsPrivateDirectoryAcl,
  classifyDurableRead, DURABLE_ABSENT, DURABLE_PENDING, writeAllSync,
  currentClockMsForRegistry,
}) {
  const TEST_PRIVATE_REGISTRY_BASE_SYMBOL = Symbol.for('android-common-doc.runtime-private-registry-base');
  let cachedWindowsCommonApplicationData = undefined;

  function windowsCommonApplicationDataRoot() {
    if (cachedWindowsCommonApplicationData !== undefined) return cachedWindowsCommonApplicationData;
    const powerShellPath = resolvedWindowsPowerShellPath();
    if (!powerShellPath) {
      cachedWindowsCommonApplicationData = null;
      return null;
    }
    let observed = null;
    let probeError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        observed = execFileSync(powerShellPath, [
          '-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
          '[Console]::Out.Write([Environment]::GetFolderPath("CommonApplicationData"))',
        ], { encoding: 'utf8', windowsHide: true }).trim();
        probeError = null;
        break;
      } catch (err) {
        probeError = err;
      }
    }
    if (probeError) {
      cachedWindowsCommonApplicationData = null;
      return null;
    }
    try {
      if (!path.isAbsolute(observed)) return null;
      const real = fs.realpathSync(observed);
      if (!fs.statSync(real).isDirectory()) return null;
      const homeReal = realpathOrSelf(os.homedir());
      const relativeToHome = path.relative(homeReal, real);
      if (relativeToHome === '' || (!relativeToHome.startsWith('..' + path.sep) && relativeToHome !== '..' && !path.isAbsolute(relativeToHome))) {
        return null;
      }
      cachedWindowsCommonApplicationData = real;
      return real;
    } catch {
      cachedWindowsCommonApplicationData = null;
      return null;
    }
  }

  function registryBaseDir() {
    const testPrivateBase = globalThis[TEST_PRIVATE_REGISTRY_BASE_SYMBOL];
    if (typeof testPrivateBase === 'string' && path.isAbsolute(testPrivateBase)) {
      return path.join(testPrivateBase, computePrincipalId());
    }
    if (process.platform === 'win32') {
      const commonApplicationData = windowsCommonApplicationDataRoot();
      if (!commonApplicationData) throw new Error('windows-common-application-data-unavailable');
      return path.join(commonApplicationData, 'AndroidCommonDoc', 'runtime', computePrincipalId());
    }
    return path.join(os.tmpdir(), 'android-common-doc-runtime', computePrincipalId());
  }

  /**
   * @param {string|{repoId:string}} projectRootOrRepoId
   */
  function registryRepoDir(projectRootOrRepoId) {
    const repoId = (
      projectRootOrRepoId && typeof projectRootOrRepoId === 'object' && typeof projectRootOrRepoId.repoId === 'string'
    ) ? projectRootOrRepoId.repoId : computeRepoId(projectRootOrRepoId);
    return path.join(registryBaseDir(), repoId);
  }

  /**
   * Creates `dirPath` (and every missing ancestor under the registry base) 0700,
   * rejecting a pre-existing symlink at the leaf BEFORE any mkdir/chmod. Also
   * verifies stable owner+mode after creation.
   * @param {string} dirPath
   * @returns {{ok:true}|{ok:false,reason:string}}
   */
  function ensureSecureRegistryDir(dirPath) {
    try {
      const lst = fs.lstatSync(dirPath);
      if (lst.isSymbolicLink()) return { ok: false, reason: 'symlink' };
    } catch (err) {
      // ENOENT (does not exist yet) is the normal, expected case -- proceed.
    }
    try {
      fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
      if (process.platform !== 'win32') fs.chmodSync(dirPath, 0o700);
    } catch (err) {
      return { ok: false, reason: 'mkdir-failed' };
    }
    const isPosix = process.platform !== 'win32';
    if (isPosix) {
      let st;
      try {
        st = fs.lstatSync(dirPath, { bigint: true });
      } catch (err) {
        return { ok: false, reason: 'stat-failed' };
      }
      if (st.isSymbolicLink()) return { ok: false, reason: 'symlink' };
      if (typeof process.getuid === 'function' && st.uid !== BigInt(process.getuid())) {
        return { ok: false, reason: 'wrong-owner' };
      }
      if ((st.mode & 0o777n) !== 0o700n) return { ok: false, reason: 'wrong-mode' };
    } else {
      const registryBase = path.resolve(registryBaseDir());
      const target = path.resolve(dirPath);
      const relative = path.relative(registryBase, target);
      if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
        return { ok: false, reason: 'registry-path-outside-base' };
      }
      const aclChain = [registryBase];
      let cursor = registryBase;
      for (const segment of relative.split(path.sep).filter(Boolean)) {
        cursor = path.join(cursor, segment);
        aclChain.push(cursor);
      }
      const acl = windowsPrivateDirectoryAcl(aclChain, { mode: 'ensure' });
      if (!acl.ok) return { ok: false, reason: acl.status === 'failed' ? 'acl-failed' : 'acl-indeterminate' };
    }
    return { ok: true };
  }

  /**
   * Mutable registry record write (presence/lease/session-generation).
   * @param {string} targetPath
   * @param {Buffer} bytes
   * @returns {{ok:true}|{ok:false,reason:string}}
   */
  function writeRegistryRecordReplace(targetPath, bytes) {
    const dir = path.dirname(targetPath);
    const dirResult = ensureSecureRegistryDir(dir);
    if (!dirResult.ok) return dirResult;
    const tempPath = path.join(dir, '.' + path.basename(targetPath) + '.' + crypto.randomBytes(8).toString('hex') + '.tmp');
    let fd;
    try {
      fd = fs.openSync(tempPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
    } catch (err) {
      return { ok: false, reason: 'temp-open-failed' };
    }
    try {
      writeAllSync(fd, bytes);
      fs.fsyncSync(fd);
    } catch (err) {
      try { fs.closeSync(fd); } catch (e) { /* already closed */ }
      try { fs.unlinkSync(tempPath); } catch (e) { /* best effort */ }
      return { ok: false, reason: 'write-failed' };
    }
    try { fs.closeSync(fd); } catch (e) { /* already closed */ }
    try {
      fs.renameSync(tempPath, targetPath);
    } catch (err) {
      try { fs.unlinkSync(tempPath); } catch (e) { /* best effort */ }
      return { ok: false, reason: 'rename-failed' };
    }
    return { ok: true };
  }

  /**
   * Fd-bound secure read of a registry record (immutable OR mutable).
   * @param {string} artifactPath
   * @param {{immutablePath?:boolean}} [opts]
   * @returns {{ok:true,obj:object}|{ok:true,absent:true}|{ok:false,reason:string}}
   */
  function readRegistryRecord(artifactPath, opts) {
    let classified;
    try {
      classified = classifyDurableRead(artifactPath, Object.assign({ parse: true }, opts || {}));
    } catch (err) {
      return { ok: false, reason: (err && err.detailCode) || 'read-failed' };
    }
    if (classified.state === DURABLE_ABSENT) return { ok: true, absent: true };
    if (classified.state === DURABLE_PENDING) return { ok: false, reason: 'pending' };
    return { ok: true, obj: classified.obj };
  }

  /**
   * Short, bounded-retry mkdir-based exclusive lock scoped to `lockDir`.
   * @param {string} lockDir
   * @param {function} fn
   * @param {{maxWaitMs?:number}} [opts]
   */
  function withRegistryLock(lockDir, fn, opts) {
    const lockParentResult = ensureSecureRegistryDir(path.dirname(lockDir));
    if (!lockParentResult.ok) return lockParentResult;
    const maxAttempts = 2000;
    const maxWaitMs = (opts && Number.isFinite(opts.maxWaitMs) && opts.maxWaitMs > 0) ? opts.maxWaitMs : 0;
    let acquired = false;
    for (let i = 0; i < maxAttempts; i += 1) {
      try {
        fs.mkdirSync(lockDir, { mode: 0o700 });
        const lockSecurity = ensureSecureRegistryDir(lockDir);
        if (!lockSecurity.ok) {
          try { fs.rmdirSync(lockDir); } catch (err) { /* best-effort rollback */ }
          return lockSecurity;
        }
        acquired = true;
        break;
      } catch (err) {
        if (!err || err.code !== 'EEXIST') return { ok: false, reason: 'lock-timeout' };
      }
    }
    if (!acquired && maxWaitMs > 0) {
      const deadlineMs = currentClockMsForRegistry() + maxWaitMs;
      while (currentClockMsForRegistry() < deadlineMs) {
        try {
          fs.mkdirSync(lockDir, { mode: 0o700 });
          const lockSecurity = ensureSecureRegistryDir(lockDir);
          if (!lockSecurity.ok) {
            try { fs.rmdirSync(lockDir); } catch (err) { /* best-effort rollback */ }
            return lockSecurity;
          }
          acquired = true;
          break;
        } catch (err) {
          if (!err || err.code !== 'EEXIST') return { ok: false, reason: 'lock-timeout' };
          try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5); } catch (e) { /* best effort */ }
        }
      }
    }
    if (!acquired) return { ok: false, reason: 'lock-timeout' };
    try {
      const value = fn();
      return { ok: true, value };
    } finally {
      try { fs.rmdirSync(lockDir); } catch (err) { /* best effort */ }
    }
  }

  return Object.freeze({
    windowsCommonApplicationDataRoot, registryBaseDir, registryRepoDir,
    ensureSecureRegistryDir, writeRegistryRecordReplace, readRegistryRecord, withRegistryLock,
  });
}

module.exports = { createPrivateRegistryModule };
