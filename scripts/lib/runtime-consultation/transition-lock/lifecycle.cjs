'use strict';

const fs = require('fs');
const path = require('path');
const { CliError, isTestCapability } = require('../primitives.cjs');
const { assertAncestorChainConfined } = require('./confinement.cjs');
const { sleepSync, testRendezvous } = require('./rendezvous.cjs');

const LOCK_MAX_WAIT_MS = 1200;
const LOCK_POLL_MS = 40;

/**
 * Composes transition lifecycle operations after state and durable writers
 * exist. Dependencies are explicit so this leaf module never imports the
 * facade or creates a second authority registry.
 */
function createTransitionLockLifecycle(options) {
  const state = options.state;
  const writers = options.writers;
  const windowsPrivateDirectoryAcl = options.windowsPrivateDirectoryAcl;
  const assertWindowsPrivateDirectoryAcl = options.assertWindowsPrivateDirectoryAcl;
  const {
    markPoisoned, isPoisoned, assertLockedScopeIdentity,
    registerLock, activeRecordFor,
  } = state;
  const { fsyncDir, fsyncDirCauseSuffix, isLockRmdirFaultActive } = writers;

  /**
   * Exclusively creates `.lock`, proves its parent barrier, binds both the
   * transaction and lock identities, and only then mints an opaque token.
   * Existing locks are never age-reclaimed.
   */
  function acquireLock(txnDir, coordRoot) {
    const canonicalTxnDir = path.resolve(txnDir);
    const canonicalCoordRoot = path.resolve(coordRoot);
    const lockDir = path.join(canonicalTxnDir, '.lock');
    assertAncestorChainConfined(canonicalCoordRoot, canonicalTxnDir);
    let txnStBefore;
    try {
      txnStBefore = fs.lstatSync(canonicalTxnDir, { bigint: true });
    } catch (err) {
      throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'transition lock parent directory does not exist or could not be stat-verified before acquisition (acquireLock never creates it): ' + canonicalTxnDir);
    }
    if (!txnStBefore.isDirectory()) {
      throw new CliError('INVALID', 'SECURITY_INVALID', 'transition lock parent path is not a directory: ' + canonicalTxnDir);
    }
    testRendezvous(canonicalTxnDir, 'acquire-lock-before-mkdir-loop');
    const start = Date.now();
    for (;;) {
      try {
        fs.mkdirSync(lockDir);
      } catch (err) {
        if (err.code !== 'EEXIST') throw err;
        if (isTestCapability()) {
          try { fs.writeFileSync(path.join(canonicalTxnDir, '.lock-contention-observed'), String(process.pid)); } catch (e) { /* best-effort test evidence only */ }
        }
        if (Date.now() - start >= LOCK_MAX_WAIT_MS) {
          throw new CliError('TIMEOUT', 'DEADLINE_EXCEEDED', 'transition lock acquisition timed out: ' + lockDir);
        }
        sleepSync(LOCK_POLL_MS);
        continue;
      }

      // Capture the mkdir-created identity before opening it, then prove the
      // opened handle is still that same inode. O_NOFOLLOW prevents symlinks.
      let lockStAfterMkdir;
      try {
        lockStAfterMkdir = fs.lstatSync(lockDir, { bigint: true });
      } catch (err) {
        throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'transition lock directory could not be stat-verified immediately after this invocation\'s own mkdirSync: ' + lockDir);
      }
      if (lockStAfterMkdir.isSymbolicLink()) {
        throw new CliError('INVALID', 'SECURITY_INVALID', 'transition lock directory is a symlink immediately after this invocation\'s own mkdirSync: ' + lockDir);
      }
      testRendezvous(canonicalTxnDir, 'acquire-lock-post-mkdir-pre-verify');
      let lockFd;
      try {
        lockFd = fs.openSync(lockDir, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      } catch (err) {
        if (err && err.code === 'ELOOP') {
          throw new CliError('INVALID', 'SECURITY_INVALID', 'transition lock directory is a symlink immediately after this invocation\'s own mkdirSync (rejected at open): ' + lockDir);
        }
        throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'transition lock directory could not be opened immediately after acquisition: ' + lockDir);
      }
      let st;
      try {
        const openedSt = fs.fstatSync(lockFd, { bigint: true });
        if (openedSt.dev !== lockStAfterMkdir.dev || openedSt.ino !== lockStAfterMkdir.ino) {
          throw new CliError('INVALID', 'SECURITY_INVALID', 'transition lock directory was substituted between this invocation\'s own mkdirSync and its immediately-following open (dev/ino mismatch): ' + lockDir);
        }
        if (process.platform === 'win32') {
          assertWindowsPrivateDirectoryAcl(
            windowsPrivateDirectoryAcl(lockDir, { mode: 'ensure' }),
            lockDir,
          );
          const pathStAfterAcl = fs.lstatSync(lockDir, { bigint: true });
          if (pathStAfterAcl.dev !== openedSt.dev || pathStAfterAcl.ino !== openedSt.ino) {
            throw new CliError('INVALID', 'SECURITY_INVALID', 'transition lock directory was substituted while applying its Windows ACL: ' + lockDir);
          }
        } else {
          fs.fchmodSync(lockFd, 0o700);
        }
        st = fs.fstatSync(lockFd, { bigint: true });
      } finally {
        try { fs.closeSync(lockFd); } catch (e) { /* best-effort cleanup */ }
      }
      if (!st.isDirectory()) {
        throw new CliError('INVALID', 'SECURITY_INVALID', 'transition lock path is not a directory after acquisition: ' + lockDir);
      }
      if (process.platform !== 'win32' && (st.mode & 0o777n) !== 0o700n) {
        throw new CliError('INVALID', 'SECURITY_INVALID', 'transition lock directory is not owner-only 0700 immediately after this invocation\'s own fd-bound fchmod: ' + lockDir);
      }
      if (!fsyncDir(canonicalTxnDir, 'lock-acquire')) {
        throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'transition lock acquisition barrier could not be proven durable; .lock retained as a durable orphan: ' + lockDir + fsyncDirCauseSuffix());
      }
      let txnStAfter;
      try {
        txnStAfter = fs.lstatSync(canonicalTxnDir, { bigint: true });
      } catch (err) {
        throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'transition lock parent directory could not be stat-verified after acquisition: ' + canonicalTxnDir);
      }
      if (!txnStAfter.isDirectory()) {
        throw new CliError('INVALID', 'SECURITY_INVALID', 'transition lock parent path is not a directory after acquisition: ' + canonicalTxnDir);
      }
      assertAncestorChainConfined(canonicalCoordRoot, canonicalTxnDir);
      if (txnStAfter.dev !== txnStBefore.dev || txnStAfter.ino !== txnStBefore.ino
          || txnStAfter.mode !== txnStBefore.mode || txnStAfter.uid !== txnStBefore.uid || txnStAfter.gid !== txnStBefore.gid) {
        throw new CliError('INVALID', 'SECURITY_INVALID', 'transition lock parent directory identity changed during acquisition (before/after snapshot mismatch): ' + canonicalTxnDir);
      }
      return registerLock({
        canonicalTxnDir: canonicalTxnDir,
        canonicalLockDir: lockDir,
        coordRoot: canonicalCoordRoot,
        lockDev: st.dev, lockIno: st.ino, lockMode: st.mode, lockUid: st.uid, lockGid: st.gid,
        txnDirDev: txnStAfter.dev, txnDirIno: txnStAfter.ino, txnDirMode: txnStAfter.mode, txnDirUid: txnStAfter.uid, txnDirGid: txnStAfter.gid,
        active: true,
      });
    }
  }

  /** Authenticates, revokes, removes, then durably barriers the held lock. */
  function releaseLock(lockToken) {
    const rec = activeRecordFor(lockToken);
    if (!rec) {
      throw new CliError('INVALID', 'AUTHORITY_INVALID', 'releaseLock called with a non-authentic or already-released transition-lock token (no filesystem change made)');
    }
    try {
      assertAncestorChainConfined(rec.coordRoot, rec.canonicalTxnDir);
    } catch (err) {
      rec.active = false;
      throw isPoisoned(err) ? err : markPoisoned(err);
    }
    let st;
    try {
      st = fs.lstatSync(rec.canonicalLockDir, { bigint: true });
    } catch (err) {
      rec.active = false;
      throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'transition lock directory vanished before release: ' + rec.canonicalLockDir);
    }
    if (!st.isDirectory() || st.dev !== rec.lockDev || st.ino !== rec.lockIno
        || st.mode !== rec.lockMode || st.uid !== rec.lockUid || st.gid !== rec.lockGid) {
      rec.active = false;
      throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'transition lock directory identity changed before release: ' + rec.canonicalLockDir);
    }
    rec.active = false;
    try {
      if (isLockRmdirFaultActive()) {
        const injected = new Error('injected lock rmdir failure (RUNTIME_CONSULTATION_FAULT_LOCK_RMDIR)');
        injected.code = 'EIO';
        throw injected;
      }
      fs.rmdirSync(rec.canonicalLockDir);
    } catch (err) {
      throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'transition lock release rmdir failed; lock retained (token revoked): ' + rec.canonicalLockDir);
    }
    if (!fsyncDir(rec.canonicalTxnDir, 'lock-release')) {
      throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'transition lock release barrier could not be proven durable: ' + rec.canonicalLockDir + fsyncDirCauseSuffix());
    }
  }

  /** Runs `fn(lockToken)` under the durable transition lock. */
  function withLock(txnDir, coordRoot, fn) {
    const lockToken = acquireLock(txnDir, coordRoot);
    assertLockedScopeIdentity(lockToken);
    testRendezvous(txnDir, 'with-lock-post-acquire-pre-fn');
    let result;
    try {
      result = fn(lockToken);
    } catch (err) {
      if (isPoisoned(err)) throw err;
      try {
        assertLockedScopeIdentity(lockToken);
      } catch (scopeErr) {
        throw markPoisoned(scopeErr);
      }
      try {
        releaseLock(lockToken);
      } catch (releaseErr) {
        releaseErr.cause = err;
        throw releaseErr;
      }
      throw err;
    }
    try {
      assertLockedScopeIdentity(lockToken);
    } catch (scopeErr) {
      throw markPoisoned(scopeErr);
    }
    releaseLock(lockToken);
    return result;
  }

  return Object.freeze({ acquireLock, releaseLock, withLock });
}

module.exports = { createTransitionLockLifecycle };
