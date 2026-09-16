'use strict';

// Finding B (PR #247 review): the bytes that were VALIDATED must be the bytes
// that actually run. Hashing a descriptor and then handing spawn() the mutable
// pathname leaves a window in which the file, or its parent directory entry,
// can be replaced between validation and exec -- and on Unix the surrounding
// checks accept an owner-writable executable and do not protect its parent
// directory, so the same user can do exactly that.
//
// This module owns the remedy: copy the validated bytes straight out of the
// already-open, already-verified descriptor into an owner-confined private
// directory, key the copy by the validated digest, re-verify it, and let the
// caller execute THAT. It lives in its own file because every module in this
// tree is capped at 500 lines.

function createPinnedImageStore({ fs, os, path, crypto, windowsPrivateDirectoryAcl }) {
// ── Finding B: the bytes that were validated must be the bytes that run ─────
//
// Hashing a descriptor and then handing spawn() the mutable PATHNAME leaves a
// window in which the file (or its parent directory entry) can be replaced
// between validation and exec. The Unix checks accept an owner-writable
// executable and do not protect its parent directory, so the same user can
// swap it. Copy the validated bytes straight out of the already-open,
// already-verified descriptor into an owner-confined private directory, key
// the copy by the validated digest, re-verify it, and execute THAT.
const PINNED_COPY_DIR_PREFIX = 'acd-codex-pinned-';

function pinnedCopyDir() {
  const owner = typeof process.getuid === 'function' ? String(process.getuid()) : 'win';
  return path.join(os.tmpdir(), PINNED_COPY_DIR_PREFIX + owner);
}

function ensurePinnedCopyDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (process.platform !== 'win32') fs.chmodSync(dir, 0o700);
    const st = fs.lstatSync(dir);
    const uid = typeof process.getuid === 'function' ? process.getuid() : null;
    if (!st.isDirectory() || st.isSymbolicLink()) return false;
    if (uid !== null && st.uid !== uid) return false;
    if (process.platform !== 'win32' && (st.mode & 0o077) !== 0) return false;
    if (process.platform === 'win32') {
      const acl = windowsPrivateDirectoryAcl(dir, { mode: 'enforce' });
      if (!acl || acl.ok !== true) return false;
    }
    return true;
  } catch (err) {
    return false;
  }
}

// Re-open the copy the same way the original was validated -- O_NOFOLLOW,
// fstat identity, bounded read -- and re-hash it. A copy that does not hash to
// the validated digest is never executed, whatever its name says.
function verifyPinnedCopy(copyPath, expectedDigest) {
  let fd;
  try {
    fd = fs.openSync(copyPath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const opened = fs.fstatSync(fd);
    const uid = typeof process.getuid === 'function' ? process.getuid() : null;
    if (!opened.isFile() || opened.nlink !== 1 || opened.size <= 0) return { ok: false };
    if (uid !== null && opened.uid !== uid) return { ok: false };
    if (process.platform !== 'win32' && (opened.mode & 0o077) !== 0) return { ok: false };
    const hash = crypto.createHash('sha256');
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let offset = 0;
    while (offset < opened.size) {
      const read = fs.readSync(fd, buffer, 0, Math.min(buffer.length, opened.size - offset), offset);
      if (read <= 0) break;
      hash.update(buffer.subarray(0, read));
      offset += read;
    }
    if (offset !== opened.size) return { ok: false };
    return hash.digest('hex') === expectedDigest ? { ok: true, path: copyPath } : { ok: false };
  } catch (err) {
    return { ok: false };
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch (err) { /* already decided */ } }
  }
}

function materializePinnedCopy(fd, size, expectedDigest) {
  const dir = pinnedCopyDir();
  if (!ensurePinnedCopyDir(dir)) return { ok: false, reason: 'CODEX_PIN_COPY_DIR_INSECURE' };
  const finalPath = path.join(dir, 'codex-' + expectedDigest);
  // A copy already keyed by this digest is reusable ONLY if it still verifies.
  const reusable = verifyPinnedCopy(finalPath, expectedDigest);
  if (reusable.ok) { armPinnedCopyTeardown(); return { ok: true, path: finalPath }; }
  const tempPath = finalPath + '.' + process.pid + '.tmp';
  let out;
  try {
    try { fs.rmSync(tempPath, { force: true }); } catch (err) { /* nothing to clear */ }
    out = fs.openSync(tempPath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o500);
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let offset = 0;
    while (offset < size) {
      // pread from the VALIDATED descriptor -- never a second open of the
      // mutable pathname, which would reintroduce the very race this closes.
      const read = fs.readSync(fd, buffer, 0, Math.min(buffer.length, size - offset), offset);
      if (read <= 0) break;
      let written = 0;
      while (written < read) written += fs.writeSync(out, buffer, written, read - written);
      offset += read;
    }
    fs.fsyncSync(out);
    fs.closeSync(out);
    out = undefined;
    if (offset !== size) {
      try { fs.rmSync(tempPath, { force: true }); } catch (err) { /* best effort */ }
      return { ok: false, reason: 'CODEX_PIN_COPY_SHORT_WRITE' };
    }
    if (process.platform !== 'win32') fs.chmodSync(tempPath, 0o500);
    fs.renameSync(tempPath, finalPath);
  } catch (err) {
    if (out !== undefined) { try { fs.closeSync(out); } catch (e) { /* best effort */ } }
    try { fs.rmSync(tempPath, { force: true }); } catch (e) { /* best effort */ }
    return { ok: false, reason: 'CODEX_PIN_COPY_FAILED' };
  }
  const verified = verifyPinnedCopy(finalPath, expectedDigest);
  if (!verified.ok) return { ok: false, reason: 'CODEX_PIN_COPY_UNVERIFIED' };
  armPinnedCopyTeardown();
  return { ok: true, path: finalPath };
}

// Removed on teardown so a validated copy never outlives the run that made it.
function cleanupPinnedCopies() {
  try { fs.rmSync(pinnedCopyDir(), { recursive: true, force: true }); } catch (err) { /* best effort */ }
}

// Armed the first time a copy is actually materialized, so teardown cannot be
// missed by whichever exit path the run happens to take. On POSIX an image
// that is still executing keeps its inode alive after unlink, so removing it
// here cannot disturb a child that outlives us by a moment; on Windows a
// running image simply refuses deletion and the next run re-verifies by digest
// before reusing anything.
let pinnedCopyTeardownArmed = false;
function armPinnedCopyTeardown() {
  if (pinnedCopyTeardownArmed) return;
  pinnedCopyTeardownArmed = true;
  try {
    process.once('exit', cleanupPinnedCopies);
  } catch (err) { /* a host without process events still gets the explicit call */ }
}

  return Object.freeze({ materializePinnedCopy, verifyPinnedCopy, cleanupPinnedCopies });
}

module.exports = Object.freeze({ createPinnedImageStore });
