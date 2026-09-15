'use strict';

const fs = require('fs');
const { CliError } = require('../primitives.cjs');
const { isPathWithin, assertAncestorChainConfined } = require('./confinement.cjs');

/**
 * Creates the private authority state for one consultation facade instance.
 * Lock authority lives only in the WeakMap; poison authority lives only in
 * the WeakSet. Tokens therefore remain frozen, empty, opaque and unforgeable.
 */
function createTransitionLockState() {
  const lockRegistry = new WeakMap();
  const poisonedErrors = new WeakSet();

  function markPoisoned(err) { poisonedErrors.add(err); return err; }
  function isPoisoned(err) { return !!err && poisonedErrors.has(err); }

  /**
   * True iff `token` is live, authentic, bound to `artifactPath`, and the
   * original lock directory still has the same identity and permissions.
   */
  function isValidLockTokenFor(token, artifactPath) {
    if (!token || typeof token !== 'object') return false;
    const rec = lockRegistry.get(token);
    if (!rec || rec.active !== true) return false;
    if (!isPathWithin(rec.canonicalTxnDir, artifactPath)) return false;
    try {
      assertAncestorChainConfined(rec.coordRoot, rec.canonicalTxnDir);
    } catch (err) {
      return false;
    }
    let st;
    try {
      st = fs.lstatSync(rec.canonicalLockDir, { bigint: true });
    } catch (err) {
      return false;
    }
    return st.isDirectory() && st.dev === rec.lockDev && st.ino === rec.lockIno
      && st.mode === rec.lockMode && st.uid === rec.lockUid && st.gid === rec.lockGid;
  }

  /**
   * Proves the complete held scope immediately before/after sensitive I/O.
   * A whole-subtree move preserves the leaf inode, so confinement is walked
   * again on every call in addition to checking both directory identities.
   */
  function assertLockedScopeIdentity(lockToken) {
    const rec = (lockToken && typeof lockToken === 'object') ? lockRegistry.get(lockToken) : undefined;
    if (!rec || rec.active !== true) {
      throw new CliError('INVALID', 'AUTHORITY_INVALID', 'assertLockedScopeIdentity called with a non-authentic or already-released transition-lock token');
    }
    assertAncestorChainConfined(rec.coordRoot, rec.canonicalTxnDir);
    let txnSt;
    try {
      txnSt = fs.lstatSync(rec.canonicalTxnDir, { bigint: true });
    } catch (err) {
      throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'transition lock parent directory vanished while the lock was held: ' + rec.canonicalTxnDir);
    }
    if (!txnSt.isDirectory() || txnSt.dev !== rec.txnDirDev || txnSt.ino !== rec.txnDirIno
        || txnSt.mode !== rec.txnDirMode || txnSt.uid !== rec.txnDirUid || txnSt.gid !== rec.txnDirGid) {
      throw new CliError('INVALID', 'SECURITY_INVALID', 'transition lock parent directory identity changed while the lock was held: ' + rec.canonicalTxnDir);
    }
    let lockSt;
    try {
      lockSt = fs.lstatSync(rec.canonicalLockDir, { bigint: true });
    } catch (err) {
      throw new CliError('INVALID', 'DURABILITY_UNPROVEN', '.lock directory vanished while the lock was held: ' + rec.canonicalLockDir);
    }
    if (!lockSt.isDirectory() || lockSt.dev !== rec.lockDev || lockSt.ino !== rec.lockIno
        || lockSt.mode !== rec.lockMode || lockSt.uid !== rec.lockUid || lockSt.gid !== rec.lockGid) {
      throw new CliError('INVALID', 'SECURITY_INVALID', '.lock directory identity changed while the lock was held (deleted/recreated, or its own ownership/permissions changed): ' + rec.canonicalLockDir);
    }
  }

  function registerLock(record) {
    const token = Object.freeze({});
    lockRegistry.set(token, record);
    return token;
  }

  function activeRecordFor(token) {
    if (!token || typeof token !== 'object') return undefined;
    const record = lockRegistry.get(token);
    return record && record.active === true ? record : undefined;
  }

  return Object.freeze({
    markPoisoned,
    isPoisoned,
    isValidLockTokenFor,
    assertLockedScopeIdentity,
    registerLock,
    activeRecordFor,
  });
}

module.exports = { createTransitionLockState };
