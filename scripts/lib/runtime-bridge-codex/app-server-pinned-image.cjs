'use strict';

// The VERIFIED ISOLATED COPY of the pinned Codex executable.
//
// Deliberately not called an "immutable copy". It is not immutable, and naming
// it so would promise a guarantee this module does not deliver.
//
// ── What this exists to fix ────────────────────────────────────────────────
// Hashing a descriptor and then handing spawn() the mutable PATHNAME leaves a
// window in which the file, or its parent directory entry, can be replaced
// between validation and exec. The surrounding checks accept an owner-writable
// executable and do not protect its parent directory. So: copy the validated
// bytes straight out of the already-open, already-verified descriptor into an
// owner-confined private directory, key the copy by the validated digest,
// re-verify it, and execute THAT.
//
// ── What the copy DOES protect against ─────────────────────────────────────
//   * Any other user on the host. The directory is created by mkdtempSync at
//     0700 with an unpredictable name, owner-checked, and on Windows carries an
//     owner-only ACL. Another uid can neither read, write nor pre-create it.
//   * Substitution of the ORIGINAL after validation. The copy is taken from the
//     open descriptor, never by re-opening the pathname, so rewriting or
//     replacing the original -- in place or by a new inode -- cannot reach the
//     image that runs (CPF-13).
//   * A stale or foreign copy being reused. Reuse requires a full re-hash
//     against the validated digest, not a name match (verifyPinnedCopy).
//   * Cross-process interference. The directory is per-process, so no peer's
//     teardown can remove a copy this process has verified (CPF-17).
//
// ── What it does NOT protect against, stated plainly ───────────────────────
// A process running as THE SAME UID. Such a process can chmod the copy writable
// and alter it in the window between the final verifyPinnedCopy and the spawn.
// That window is small and the copy lives at an unpredictable path, but neither
// is a guarantee, and this module must not be described as if they were.
//
// ── Why that is the contract, not an oversight ─────────────────────────────
// The local user account is a trust boundary for this entire runtime, stated
// consistently wherever the question is faced:
//
//   * runtime-consultation/root-lifecycle/root-lifecycle.cjs names "a same-uid
//     attacker" explicitly and answers with a before/after identity re-check --
//     DETECTION of tampering, never prevention of it.
//   * runtime-consultation/durability/write.cjs defends an "attacker-planted
//     byte-identical file, or a hard link" with fd-binding, O_NOFOLLOW, and a
//     re-fstat identity compare. Same shape: bind and verify, do not assume
//     the filesystem cannot be touched.
//   * runtime-role-lifecycle/private-registry.cjs confines its root to
//     owner-only 0700 and checks the owner -- again a boundary against OTHER
//     users, with no claim about this one.
//
// genuine-pinned binds the executable to a conductor-written freeze record by
// DIGEST rather than trusting a path or a version string. That is its whole
// promise, and this copy delivers it. Resisting a hostile process already
// running as the user is a different and much stronger property, which nothing
// in this runtime claims and which POSIX and Win32 give no portable primitive
// for -- fexecve and memfd_create + F_SEAL_WRITE have no Node binding.
//
// If that contract ever changes, this comment is wrong and the mechanism, not
// the wording, has to change with it.
//
// Lives in its own file because every module in this tree is capped at 500 lines.

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
// Identity, ownership and mode are compared in BigInt. fs.Stats reports them as
// doubles by default, and Windows NTFS file IDs are 64-bit: two genuinely
// different files become indistinguishable once their identities round, so a
// swap into a nearby inode would read as the same file. Measured on a real
// Windows runner, ino 28710447629357696 satisfies `ino + 1 === ino`.
const STAT_BIGINT = Object.freeze({ bigint: true });
const MAX_SAFE_BIG = BigInt(Number.MAX_SAFE_INTEGER);

// The one sanctioned BigInt->Number crossing: a byte length that must index a
// Buffer. Returns null rather than a lossy double, so the caller refuses
// instead of silently truncating.
function safeSize(value) {
  if (typeof value !== 'bigint' || value < 0n || value > MAX_SAFE_BIG) return null;
  return Number(value);
}

const PINNED_COPY_DIR_PREFIX = 'acd-codex-pinned-';

// Per-PROCESS, created by mkdtempSync, memoized. Two review findings share this
// one root cause, and both are closed by the same change:
//
//   * A single uid-keyed directory is shared by every bridge process for that
//     user. validatePinnedCodexExecutable verifies the copy, the supervisor
//     spawns it later, and in that interval ANOTHER process exiting runs its
//     own cleanupPinnedCopies and can delete the verified pathname out from
//     under us -- the descriptor is already closed, and unlink protection only
//     starts once the child is running.
//   * A predictable path can be pre-created as a symlink by an attacker.
//     mkdirSync({recursive:true}) accepts an existing symlink and the chmod
//     that followed it then changed the mode of whatever it pointed at, before
//     the lstat below ever got to reject it.
//
// mkdtempSync creates atomically, with 0700, at a name nobody can predict, so
// there is nothing to pre-create and nothing shared to race. The digest stays
// in the file basename, so reuse-by-digest within a process is unaffected.
let pinnedCopyDirMemo = null;
function pinnedCopyDir() {
  if (pinnedCopyDirMemo === null) {
    pinnedCopyDirMemo = fs.mkdtempSync(path.join(os.tmpdir(), PINNED_COPY_DIR_PREFIX));
    // Armed HERE, at creation, not on the success paths. A per-process
    // directory that is abandoned is leaked, unlike the old shared one which
    // the next run simply reused -- so if ensurePinnedCopyDir below rejects
    // this very directory, or anything else throws before a copy exists, the
    // teardown is already registered. The later calls are idempotent by the
    // armed flag and are kept as defence in depth.
    armPinnedCopyTeardown();
  }
  return pinnedCopyDirMemo;
}

function ensurePinnedCopyDir(dir) {
  try {
    // mkdtempSync already created it atomically at 0700; never mkdir/chmod a
    // path that could have been substituted. Validate what is actually there.
    const st = fs.lstatSync(dir, STAT_BIGINT);
    const uid = typeof process.getuid === 'function' ? BigInt(process.getuid()) : null;
    if (!st.isDirectory() || st.isSymbolicLink()) return false;
    if (uid !== null && st.uid !== uid) return false;
    if (process.platform !== 'win32' && (st.mode & 0o077n) !== 0n) return false;
    if (process.platform === 'win32') {
      // 'ensure' APPLIES the owner-only ACL to a directory this module just
      // created -- the same mode private-registry.cjs and local-registry.cjs
      // use for their own private roots. 'validate' would only observe an ACL
      // nobody had set, and the closed mode enum (windows-acl.cjs) admits
      // exactly these two, so any other literal fails closed as 'invalid-mode'
      // and would disable the pinned copy on Windows entirely.
      const acl = windowsPrivateDirectoryAcl(dir, { mode: 'ensure' });
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
    const opened = fs.fstatSync(fd, STAT_BIGINT);
    const uid = typeof process.getuid === 'function' ? BigInt(process.getuid()) : null;
    if (!opened.isFile() || opened.nlink !== 1n || opened.size <= 0n) return { ok: false };
    if (uid !== null && opened.uid !== uid) return { ok: false };
    if (process.platform !== 'win32' && (opened.mode & 0o077n) !== 0n) return { ok: false };
    const size = safeSize(opened.size);
    if (size === null) return { ok: false };
    const hash = crypto.createHash('sha256');
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let offset = 0;
    while (offset < size) {
      const read = fs.readSync(fd, buffer, 0, Math.min(buffer.length, size - offset), offset);
      if (read <= 0) break;
      hash.update(buffer.subarray(0, read));
      offset += read;
    }
    if (offset !== size) return { ok: false };
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
  // The .exe suffix on Windows is load-bearing, not cosmetic. This path goes
  // to spawn(..., { shell: false }); libuv's search_path refuses to take an
  // extensionless path containing a directory separator as-is and only probes
  // .com and .exe candidates, so an extensionless copy fails with
  // ERROR_FILE_NOT_FOUND and the validated PE bytes never start at all. The
  // digest stays in the basename either way, so reuse-by-digest is unchanged.
  const finalPath = path.join(dir, 'codex-' + expectedDigest + (process.platform === 'win32' ? '.exe' : ''));
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
  // Never call pinnedCopyDir() here: it CREATES the directory on first use, so
  // a cleanup that ran before any copy was materialized would mint a directory
  // purely in order to delete it. Only a directory this process actually made
  // is removed -- and only this process's, never a peer's.
  if (pinnedCopyDirMemo === null) return;
  try { fs.rmSync(pinnedCopyDirMemo, { recursive: true, force: true }); } catch (err) { /* best effort */ }
  pinnedCopyDirMemo = null;
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
