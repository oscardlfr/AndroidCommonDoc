'use strict';
// Confined durable reads/writes, lock, no-clobber and CAS (PLAN 3.6-3.7, T5-T9).
// Schema-free and independent of runtime-consultation; Node built-ins only.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const REASON_CODES = Object.freeze([
  'already-exists', 'compare-mismatch', 'confinement-failed',
  'durability-unproven', 'identity-drift', 'lock-timeout',
]);
const MAX_EVIDENCE_FILE_BYTES = 10485760; // 10 MiB; see blob-publish.cjs:51 precedent
const LOCK_MAX_WAIT_MS = 1200;
const LOCK_POLL_MS = 40;
function throwReasonCode(reasonCode, message) { const err = new Error(message); err.reasonCode = reasonCode; throw err; }
function sha256Buffer(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }
function sleepSync(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
function isTestCapability() {
  return process.env.NODE_ENV === 'test' && typeof process.env.VERDICT_ARTIFACT_STORE_TEST_CAPABILITY === 'string'
    && process.env.VERDICT_ARTIFACT_STORE_TEST_CAPABILITY.length > 0;
}
function faultActive(name) {
  return isTestCapability() && typeof process.env[name] === 'string' && process.env[name].length > 0;
}
// Windows junctions report isSymbolicLink()===true via lstat but are NOT
// rejected by O_NOFOLLOW at open() (empirically confirmed on this machine) --
// this per-component walk is the PRIMARY defense, done before any mkdir/open.
function assertConfinedAncestry(waveDir, targetPath, includeLeaf) {
  const logicalRoot = path.resolve(waveDir);
  let resolvedRoot;
  try { resolvedRoot = fs.realpathSync(logicalRoot); } catch (err) { throwReasonCode('confinement-failed', 'wave directory does not exist: ' + logicalRoot); }
  const lexicalTarget = path.resolve(path.isAbsolute(targetPath) ? targetPath : path.join(logicalRoot, targetPath));
  const logicalRelative = path.relative(logicalRoot, lexicalTarget);
  const canonicalRelative = path.relative(resolvedRoot, lexicalTarget);
  const targetIsRoot = lexicalTarget === logicalRoot || lexicalTarget === resolvedRoot;
  const logicalConfined = logicalRelative !== '' && !logicalRelative.startsWith('..') && !path.isAbsolute(logicalRelative);
  const canonicalConfined = canonicalRelative !== '' && !canonicalRelative.startsWith('..') && !path.isAbsolute(canonicalRelative);
  if (!targetIsRoot && !logicalConfined && !canonicalConfined) {
    throwReasonCode('confinement-failed', 'target escapes the wave directory: ' + targetPath);
  }
  const resolvedTarget = targetIsRoot ? resolvedRoot : (logicalConfined ? path.resolve(resolvedRoot, logicalRelative) : lexicalTarget);
  const rel = path.relative(resolvedRoot, resolvedTarget);
  if ((rel === '' && !includeLeaf) || rel.startsWith('..') || path.isAbsolute(rel)) {
    throwReasonCode('confinement-failed', 'target escapes the wave directory: ' + targetPath);
  }
  let rootLst;
  try { rootLst = fs.lstatSync(logicalRoot); } catch (err) { throwReasonCode('confinement-failed', 'wave directory does not exist: ' + logicalRoot); }
  if (rootLst.isSymbolicLink()) throwReasonCode('confinement-failed', 'wave directory is a symlink: ' + resolvedRoot);
  const segments = rel.split(path.sep);
  let walked = resolvedRoot;
  for (let idx = 0; idx < segments.length; idx += 1) {
    walked = path.join(walked, segments[idx]);
    let segLst;
    try {
      segLst = fs.lstatSync(walked);
    } catch (err) {
      // First missing component: nothing deeper can exist -- fine on the write path
      // (first-publish), a hard failure on the read path.
      if (!includeLeaf) break;
      throwReasonCode('confinement-failed', 'path component does not exist: ' + walked);
    }
    if (segLst.isSymbolicLink()) throwReasonCode('confinement-failed', 'path component is a symlink or reparse point: ' + walked);
  }
  return resolvedTarget;
}
function readAllFromFd(fd, size) {
  const buf = Buffer.allocUnsafe(size);
  let total = 0;
  while (total < size) {
    const n = fs.readSync(fd, buf, total, size - total, total);
    if (n === 0) break;
    total += n;
  }
  return buf.subarray(0, total);
}
function stableFileIdentity(st) {
  return ['dev', 'ino', 'mode', 'nlink', 'size', 'mtimeNs', 'ctimeNs']
    .map((key) => `${key}:${String(st[key])}`).join('|');
}
function readConfinedFile(waveDir, targetPath) {
  const resolvedTarget = assertConfinedAncestry(waveDir, targetPath, true);
  let fd;
  try {
    fd = fs.openSync(resolvedTarget, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  } catch (err) {
    throwReasonCode('confinement-failed', 'could not open target (' + (err && err.code) + '): ' + resolvedTarget);
  }
  try {
    const st = fs.fstatSync(fd, { bigint: true });
    if (!st.isFile()) throwReasonCode('confinement-failed', 'target is not a regular file: ' + resolvedTarget);
    if (st.nlink !== 1n) throwReasonCode('confinement-failed', 'target is hard-linked (nlink!==1): ' + resolvedTarget);
    if (st.size > BigInt(MAX_EVIDENCE_FILE_BYTES)) throwReasonCode('confinement-failed', 'target exceeds the size cap: ' + resolvedTarget);
    const bytes = readAllFromFd(fd, Number(st.size));
    const after = fs.fstatSync(fd, { bigint: true });
    if (bytes.length !== Number(st.size) || stableFileIdentity(st) !== stableFileIdentity(after)) {
      throwReasonCode('identity-drift', 'target changed while it was being read: ' + resolvedTarget);
    }
    return { bytes, resolvedPath: resolvedTarget };
  } finally {
    fs.closeSync(fd);
  }
}
function fsyncDir(dirPath, platform) {
  let fd;
  try {
    if (faultActive('VERDICT_ARTIFACT_STORE_FAULT_DURABILITY')) return false;
    fd = fs.openSync(dirPath, platform === 'win32' ? 'r+' : 'r');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    return true;
  } catch (err) {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch (e) { /* best-effort */ } }
    return false;
  }
}

function acquireLock(targetPath) {
  const lockDir = path.join(path.dirname(targetPath), '.' + path.basename(targetPath) + '.lock');
  const start = Date.now();
  for (;;) {
    try {
      fs.mkdirSync(lockDir);
      break;
    } catch (err) {
      if (err.code !== 'EEXIST') throwReasonCode('lock-timeout', 'could not create lock directory: ' + (err && err.message));
      if (Date.now() - start >= LOCK_MAX_WAIT_MS) throwReasonCode('lock-timeout', 'lock acquisition timed out: ' + lockDir);
      sleepSync(LOCK_POLL_MS);
    }
  }
  const lst = fs.lstatSync(lockDir);
  if (lst.isSymbolicLink()) throwReasonCode('confinement-failed', 'lock directory is a symlink: ' + lockDir);
  fsyncDir(path.dirname(lockDir), process.platform);
  return { lockDir };
}

function releaseLock(lockHandle) {
  try {
    fs.rmdirSync(lockHandle.lockDir);
  } catch (err) {
    throwReasonCode('durability-unproven', 'lock directory could not be removed: ' + lockHandle.lockDir + ' (' + (err && err.code) + ')');
  }
  if (!fsyncDir(path.dirname(lockHandle.lockDir), process.platform)) {
    throwReasonCode('durability-unproven', 'lock-release directory fsync barrier not proven for ' + path.dirname(lockHandle.lockDir));
  }
}

function writeAllSync(fd, buf) {
  let offset = 0;
  while (offset < buf.length) {
    const n = fs.writeSync(fd, buf, offset, buf.length - offset);
    if (n <= 0) throw new Error('writeSync made no progress on fd ' + fd);
    offset += n;
  }
}

function writeTempSync(dir, basename, buf) {
  const tempPath = path.join(dir, '.' + basename + '.' + process.pid + '.' + crypto.randomBytes(8).toString('hex') + '.tmp');
  const tempFd = fs.openSync(tempPath, fs.constants.O_CREAT | fs.constants.O_WRONLY | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  let identity;
  try {
    writeAllSync(tempFd, buf);
    fs.fsyncSync(tempFd);
    identity = fs.fstatSync(tempFd);
  } finally {
    fs.closeSync(tempFd);
  }
  return { tempPath, identity };
}

function verifyPublishedIdentity(resolvedTarget, identity) {
  let checkFd;
  try { checkFd = fs.openSync(resolvedTarget, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); } catch (err) { throwReasonCode('identity-drift', 'published target vanished or became unopenable: ' + resolvedTarget); }
  let publishedSt;
  try { publishedSt = fs.fstatSync(checkFd); } finally { fs.closeSync(checkFd); }
  if (publishedSt.dev !== identity.dev || publishedSt.ino !== identity.ino) throwReasonCode('identity-drift', 'published target identity does not match the originally written temp: ' + resolvedTarget);
}
function injectIdentitySwap(resolvedTarget) {
  const swapPath = resolvedTarget + '.swap.' + crypto.randomBytes(8).toString('hex'); fs.writeFileSync(swapPath, Buffer.from('SWAPPED-BY-FAULT-INJECTION'), { flag: 'wx', mode: 0o600 });
  try { if (process.platform === 'win32') fs.unlinkSync(resolvedTarget); fs.renameSync(swapPath, resolvedTarget); } finally { try { fs.unlinkSync(swapPath); } catch (e) { /* already renamed or best-effort cleanup */ } }
}
function publishNoClobber(waveDir, targetPath, bytes) {
  const resolvedTarget = assertConfinedAncestry(waveDir, targetPath, false);
  const dir = path.dirname(resolvedTarget);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  assertConfinedAncestry(waveDir, dir, true);
  const lockHandle = acquireLock(resolvedTarget);
  try {
    const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    const { tempPath, identity } = writeTempSync(dir, path.basename(resolvedTarget), buf);
    if (faultActive('VERDICT_ARTIFACT_STORE_FAULT_CRASH_MID_WRITE')) { try { fs.unlinkSync(tempPath); } catch (e) { /* best-effort */ } throw new Error('injected crash-mid-write fault'); }
    try {
      fs.linkSync(tempPath, resolvedTarget);
    } catch (err) {
      try { fs.unlinkSync(tempPath); } catch (e) { /* best-effort */ }
      if (err && err.code === 'EEXIST') throwReasonCode('already-exists', 'target already exists: ' + resolvedTarget);
      throw err;
    }
    try { fs.unlinkSync(tempPath); } catch (e) { /* best-effort; target already linked */ }
    if (!fsyncDir(dir, process.platform)) throwReasonCode('durability-unproven', 'directory fsync barrier not proven for ' + dir);
    if (faultActive('VERDICT_ARTIFACT_STORE_FAULT_IDENTITY_SWAP')) injectIdentitySwap(resolvedTarget);
    verifyPublishedIdentity(resolvedTarget, identity);
    return { sha256: sha256Buffer(buf) };
  } finally {
    releaseLock(lockHandle);
  }
}

function publishSupersede(waveDir, targetPath, bytes, expectedCurrentSha256) {
  const resolvedTarget = assertConfinedAncestry(waveDir, targetPath, false);
  const dir = path.dirname(resolvedTarget);
  const lockHandle = acquireLock(resolvedTarget);
  try {
    let currentBytes;
    try {
      currentBytes = readConfinedFile(waveDir, resolvedTarget).bytes;
    } catch (err) {
      throwReasonCode('compare-mismatch', 'no current target to compare against: ' + resolvedTarget);
    }
    if (sha256Buffer(currentBytes) !== expectedCurrentSha256) {
      throwReasonCode('compare-mismatch', 'expected-current-sha256 does not match the actual current target: ' + resolvedTarget);
    }
    const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    const { tempPath, identity } = writeTempSync(dir, path.basename(resolvedTarget), buf);
    if (faultActive('VERDICT_ARTIFACT_STORE_FAULT_CRASH_MID_WRITE')) { try { fs.unlinkSync(tempPath); } catch (e) { /* best-effort */ } throw new Error('injected crash-mid-write fault'); }
    try {
      fs.renameSync(tempPath, resolvedTarget);
    } catch (err) {
      try { fs.unlinkSync(tempPath); } catch (e) { /* best-effort */ }
      throw err;
    }
    if (!fsyncDir(dir, process.platform)) throwReasonCode('durability-unproven', 'directory fsync barrier not proven for ' + dir);
    if (faultActive('VERDICT_ARTIFACT_STORE_FAULT_IDENTITY_SWAP')) injectIdentitySwap(resolvedTarget);
    verifyPublishedIdentity(resolvedTarget, identity);
    return { sha256: sha256Buffer(buf) };
  } finally {
    releaseLock(lockHandle);
  }
}

function isAncestorCommit(ancestorSha, descendantSha, repoRoot) {
  return spawnSync('git', ['merge-base', '--is-ancestor', ancestorSha, descendantSha], { cwd: repoRoot, timeout: 3000 }).status === 0;
}
function computeRequestId() { return crypto.randomBytes(16).toString('hex'); }

module.exports = {
  REASON_CODES, readConfinedFile, acquireLock, releaseLock, fsyncDir,
  publishNoClobber, publishSupersede, isAncestorCommit, computeRequestId,
  assertConfinedAncestry,
};
