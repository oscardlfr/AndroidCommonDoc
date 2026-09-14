'use strict';

const fs = require('fs');
const path = require('path');
const { isTestCapability } = require('../primitives.cjs');
const {
  DEFAULT_MAX_DURABLE_ARTIFACT_BYTES,
  MAX_ENUM_HARD_CAP,
  MAX_ENUM_KEPT_ENTRIES,
  insertBoundedCandidate,
  readAllFromFd,
  statIsRegularFile,
} = require('./common.cjs');
const { injectReadMutationFault } = require('./read.cjs');

const NOCLOBBER_TEMP_RE = /^\.(.+)\.(\d+)\.([0-9a-f]{16})\.tmp-owner$/;
const RECONCILE_FAILURE_STATUSES = new Set(['ambiguous', 'drift', 'failed', 'unlink-unsafe']);

function isReconcileTempFstatFaultActive() {
  return (
    isTestCapability()
    && typeof process.env.RUNTIME_CONSULTATION_FAULT_RECONCILE_TEMP_FSTAT === 'string'
    && process.env.RUNTIME_CONSULTATION_FAULT_RECONCILE_TEMP_FSTAT.length > 0
  );
}

/** Bounded scan of production-named no-clobber temp siblings. */
function reconcileTempArtifacts(dirPath) {
  let dirHandle;
  try {
    dirHandle = fs.opendirSync(dirPath);
  } catch (err) {
    if (err && err.code === 'ENOENT') return { ok: true, results: [] };
    return { ok: false, results: [{ status: 'failed', reason: 'directory could not be enumerated: ' + (err && err.code) }] };
  }
  const matched = [];
  let totalSeen = 0;
  let matchedCount = 0;
  let hardCapExceeded = false;
  try {
    let entry = dirHandle.readSync();
    while (entry !== null) {
      totalSeen += 1;
      if (totalSeen > MAX_ENUM_HARD_CAP) {
        hardCapExceeded = true;
        break;
      }
      const m = NOCLOBBER_TEMP_RE.exec(entry.name);
      if (m) {
        matchedCount += 1;
        insertBoundedCandidate(matched, entry.name, m[1], MAX_ENUM_KEPT_ENTRIES);
      }
      entry = dirHandle.readSync();
    }
  } catch (err) {
    return { ok: false, results: [{ status: 'failed', reason: 'directory enumeration failed mid-scan: ' + (err && err.code) }] };
  } finally {
    try { dirHandle.closeSync(); } catch (e) { /* best-effort close */ }
  }
  if (hardCapExceeded) {
    return { ok: false, results: [{ status: 'failed', reason: 'directory exceeds the max scanned-entry bound (>' + MAX_ENUM_HARD_CAP + ')' }] };
  }
  if (matchedCount > MAX_ENUM_KEPT_ENTRIES) {
    return { ok: false, results: [{ status: 'ambiguous', reason: 'directory has more matching temp candidates than the max kept bound (' + matchedCount + '>' + MAX_ENUM_KEPT_ENTRIES + ')' }] };
  }
  const results = matched.map(([entry, targetBasename]) => reconcileOneNoClobberTemp(dirPath, entry, targetBasename));
  const ok = results.every((r) => !RECONCILE_FAILURE_STATUSES.has(r.status));
  return { ok, results };
}

/**
 * Accredit one candidate without destructive unlink. Node exposes no fd-bound
 * unlink primitive, so a genuine stray or crash-cut pair is reported as
 * `unlink-unsafe` instead of racing a path-based delete.
 */
function reconcileOneNoClobberTemp(dirPath, tempName, targetBasename) {
  const tempPath = path.join(dirPath, tempName);
  const isPosix = process.platform !== 'win32';
  let tfd;
  try {
    tfd = fs.openSync(tempPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  } catch (err) {
    if (err && err.code === 'ENOENT') return { status: 'skip', reason: 'temp gone' };
    if (err && err.code === 'ELOOP') return { status: 'skip', reason: 'temp path is a symlink (rejected at open, O_NOFOLLOW)' };
    return { status: 'failed', reason: 'temp open failed unexpectedly (' + (err && err.code) + ')' };
  }
  try {
    let tst;
    try {
      if (isReconcileTempFstatFaultActive()) {
        const injected = new Error('injected reconcile temp-fstat failure (RUNTIME_CONSULTATION_FAULT_RECONCILE_TEMP_FSTAT)');
        injected.code = 'EIO';
        throw injected;
      }
      tst = fs.fstatSync(tfd, { bigint: true });
    } catch (err) {
      return { status: 'failed', reason: 'temp fstat failed' };
    }
    if (!statIsRegularFile(tst)) return { status: 'skip', reason: 'temp is not a regular file' };
    if (tst.nlink > 2n) return { status: 'failed', reason: 'temp nlink>2 is not a recognized no-clobber state' };
    const ownerOk = !isPosix || typeof process.getuid !== 'function' || tst.uid === BigInt(process.getuid());
    const modeOk = !isPosix || (tst.mode & 0o777n) === 0o600n;
    if (!ownerOk || !modeOk) return { status: 'skip', reason: 'temp is not owner-confined exact-0600' };
    if (tst.size > BigInt(DEFAULT_MAX_DURABLE_ARTIFACT_BYTES)) {
      return { status: 'ambiguous', reason: 'temp exceeds max durable size' };
    }
    if (tst.nlink === 1n) {
      return { status: 'unlink-unsafe', reason: 'genuine stray temp identified but not auto-removed (no fd-bound unlink primitive)' };
    }

    const targetPath = path.join(dirPath, targetBasename);
    let xfd;
    try {
      xfd = fs.openSync(targetPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    } catch (err) {
      return { status: 'ambiguous', reason: 'no companion at the derived target path (or it is a symlink)' };
    }
    try {
      let xst;
      try {
        xst = fs.fstatSync(xfd, { bigint: true });
      } catch (err) {
        return { status: 'ambiguous', reason: 'companion fstat failed' };
      }
      if (
        xst.dev !== tst.dev || xst.ino !== tst.ino
        || !statIsRegularFile(xst) || xst.nlink !== 2n
        || (isPosix && typeof process.getuid === 'function' && xst.uid !== BigInt(process.getuid()))
        || (isPosix && (xst.mode & 0o777n) !== 0o600n)
      ) {
        return { status: 'ambiguous', reason: 'derived target is not the temp\'s exact genuine companion' };
      }
      if (xst.size > BigInt(DEFAULT_MAX_DURABLE_ARTIFACT_BYTES)) {
        return { status: 'ambiguous', reason: 'companion exceeds max durable size' };
      }
      injectReadMutationFault(targetPath);
      const tempBytes = readAllFromFd(tfd, Number(tst.size) + 1);
      const targetBytes = readAllFromFd(xfd, Number(xst.size) + 1);
      if (tst.size !== xst.size || Buffer.compare(tempBytes, targetBytes) !== 0) {
        return { status: 'ambiguous', reason: 'temp/target byte mismatch' };
      }
      let xst1b;
      try {
        xst1b = fs.fstatSync(xfd, { bigint: true });
      } catch (err) {
        return { status: 'ambiguous', reason: 'companion re-fstat failed' };
      }
      if (
        xst1b.dev !== xst.dev || xst1b.ino !== xst.ino || xst1b.nlink !== xst.nlink
        || xst1b.size !== xst.size || xst1b.mode !== xst.mode || xst1b.uid !== xst.uid
        || xst1b.gid !== xst.gid || xst1b.ctimeNs !== xst.ctimeNs || xst1b.mtimeNs !== xst.mtimeNs
      ) {
        return { status: 'drift', reason: 'companion identity drifted mid-read' };
      }
      return { status: 'unlink-unsafe', reason: 'genuine crash-cut pair identified but not auto-completed (no fd-bound unlink primitive)' };
    } finally {
      try { fs.closeSync(xfd); } catch (e) { /* already closed */ }
    }
  } finally {
    try { fs.closeSync(tfd); } catch (e) { /* already closed */ }
  }
}

module.exports = {
  NOCLOBBER_TEMP_RE,
  RECONCILE_FAILURE_STATUSES,
  reconcileOneNoClobberTemp,
  reconcileTempArtifacts,
};
