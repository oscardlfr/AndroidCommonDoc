'use strict';

// `root-init`/`root-validate` command controllers plus the shared coordination-root confinement primitive.

function createRootLifecycle({
  CliError,
  assertRootConfinedToWorktree,
  assertWindowsPrivateDirectoryAcl,
  assertWindowsRootAclProbeAvailable,
  fs,
  requireFlags,
  resolveAbsolute,
  resolveEffectivePlatform,
  windowsAclSnapshotsEqual,
  windowsPrivateDirectoryAcl,
}) {
function cmdRootInit(flags) {
  requireFlags(flags, ['coordination-root']);
  const coordRoot = resolveAbsolute(flags['coordination-root']);
  // RCR-confine-5: reject a pre-existing symlink at the leaf BEFORE any
  // mkdir/chmod. mkdirSync on an already-existing path is a no-op EVEN
  // THROUGH a symlink, so without this guard chmodSync(0700) below would
  // silently mutate whatever real directory the symlink points to.
  try {
    const lst = fs.lstatSync(coordRoot);
    if (lst.isSymbolicLink()) {
      throw new CliError('INVALID', 'SECURITY_INVALID', 'coordination root path is a pre-existing symlink (rejected before follow): ' + coordRoot);
    }
  } catch (err) {
    if (err instanceof CliError) throw err;
    // ENOENT (does not exist yet, the normal case) or any other lstat error:
    // fall through and let mkdirSync itself surface the real condition.
  }
  const preexisting = fs.existsSync(coordRoot);
  fs.mkdirSync(coordRoot, { recursive: true });
  try {
    if (process.platform === 'win32') {
      assertWindowsRootAclProbeAvailable();
      // Native Windows security is never selected through the capability-gated
      // FORCE_PLATFORM seam. A test may emulate argv behavior for another OS,
      // but it cannot suppress the real SID/DACL check on this host.
      assertWindowsPrivateDirectoryAcl(windowsPrivateDirectoryAcl(coordRoot, { mode: 'ensure' }), coordRoot);
    } else if (resolveEffectivePlatform() === 'win32') {
      // Cross-platform W10b exercises only the fail-closed probe verdict. It
      // cannot claim a SID inspection on a host that has no Windows ACL API.
      assertWindowsRootAclProbeAvailable();
    } else {
      fs.chmodSync(coordRoot, 0o700);
    }
    validateRootConfinement(coordRoot);
  } catch (err) {
    // Fail-closed rollback: never leave a freshly-created, non-confined
    // directory behind outside the worktree (best effort -- a directory that
    // pre-existed before this call is left untouched either way).
    if (!preexisting) {
      try { fs.rmdirSync(coordRoot); } catch (cleanupErr) { /* best effort */ }
    }
    throw err;
  }
  return { artifact_ref: coordRoot };
}

/**
 * Full coordination-root confinement primitive (RCR-confine-*): lstat
 * not-a-symlink, real directory, POSIX owner+0700 mode, Windows ACL probe
 * seam, git-worktree confinement, then a stable-identity re-check
 * (dev/ino/mode/uid/gid unchanged) across the measurably-slower `git`
 * confinement subprocess call.
 *
 * BOUNDED CLAIM, narrowed from "closes the TOCTOU window": the re-check DETECTS
 * a change that PERSISTS across that subprocess window. It does not close the
 * window, and it cannot: an ABA cycle -- swap the root, let the check run,
 * restore before the re-check -- leaves every sampled field identical. Nor does
 * the guarantee outlive the call: the caller resolves the path again afterwards,
 * and anything it then reads by name is re-resolved at that moment. Closing it
 * needs a retained directory fd with same-fd reads, which this function does not
 * provide. Wording narrowed after the same overclaim was withdrawn from the R33
 * snapshot helper; path-based sampling cannot establish continuity anywhere.
 *
 * Deliberately compares dev/ino/mode/uid/gid ONLY -- not nlink, mtime or
 * ctime, unlike this repository's FILE identity re-checks (app-server-pin.cjs,
 * registry-record-io.cjs). This is a DIRECTORY, and probed empirically: an
 * ordinary file OR subdirectory created inside it moves its own ctime and
 * mtime, and a subdirectory additionally bumps nlink, while dev/ino/mode/uid/
 * gid stay stable either way. coordRoot is a coordination root this repo's
 * own comments say is shared across cooperating processes, so legitimate
 * sibling creation during this window is plausible. Adding ctime/mtime/nlink
 * here would not close a gap -- it would false-positive on ordinary,
 * unrelated activity from a process this root is meant to be shared with.
 * Regression-pinned in root-lifecycle-directory-identity.test.js (RLDI-01/02).
 *
 * Extracted from
 * `cmdRootValidate` (unchanged behavior/order/errors) so any OTHER caller
 * needing the SAME confined-root guarantee (e.g. the WP3 bridge's own
 * rendezvous root) reuses this exact primitive instead of a second, weaker
 * reimplementation.
 * @param {string} coordRoot - absolute path, already resolved by the caller.
 * @returns {string} coordRoot, unchanged, once every check passes.
 * @throws {CliError}
 */
function validateRootConfinement(coordRoot) {
  let stat;
  try {
    // lstat (not stat): the coordination root PATH ITSELF must not be a symlink
    // (RCR-confine-3) -- checked below before anything follows it.
    stat = fs.lstatSync(coordRoot, { bigint: true });
  } catch (err) {
    // A missing/wrong root path is bad input, not a transient unavailability --
    // matches this file's own consistent not-found convention (INVALID/
    // SCHEMA_INVALID, e.g. readArtifactBytes/assertDurable/resolveContentRefOrThrow)
    // rather than the lone UNAVAILABLE/NONE outlier this handler previously used.
    throw new CliError('INVALID', 'SCHEMA_INVALID', 'coordination root does not exist: ' + coordRoot);
  }
  if (stat.isSymbolicLink()) {
    throw new CliError('INVALID', 'SECURITY_INVALID', 'coordination root path is a symlink (rejected before follow): ' + coordRoot);
  }
  if (!stat.isDirectory()) {
    throw new CliError('INVALID', 'SCHEMA_INVALID', 'coordination root is not a directory: ' + coordRoot);
  }
  const nativeWindows = process.platform === 'win32';
  const emulatedWindows = !nativeWindows && resolveEffectivePlatform() === 'win32';
  const isPosix = !nativeWindows && !emulatedWindows;
  let initialWindowsAcl = null;
  // Owner check mirrors assertDurableTargetMatches's own POSIX-identity
  // pattern (checked BEFORE mode, same order): a root owned by a different
  // principal can never be trusted as owner-confined regardless of its mode bits.
  if (isPosix && typeof process.getuid === 'function' && stat.uid !== BigInt(process.getuid())) {
    throw new CliError('INVALID', 'SECURITY_INVALID', 'coordination root is not owner-confined: ' + coordRoot);
  }
  if (isPosix && (stat.mode & 0o777n) !== 0o700n) {
    throw new CliError('INVALID', 'SECURITY_INVALID', 'coordination root mode is not owner-only 0700: ' + coordRoot);
  }
  if (nativeWindows) {
    assertWindowsRootAclProbeAvailable();
    initialWindowsAcl = windowsPrivateDirectoryAcl(coordRoot, { mode: 'validate' });
    assertWindowsPrivateDirectoryAcl(initialWindowsAcl, coordRoot);
  } else if (emulatedWindows) {
    assertWindowsRootAclProbeAvailable();
  }
  // Confinement is proven via a `git` subprocess call (assertRootConfinedToWorktree),
  // a measurably slower step than the pure in-process checks above -- widening the
  // TOCTOU window for a same-uid attacker to swap the path out from under this
  // validate call. Stable-identity re-check: re-lstat AFTER confinement and require
  // the exact same inode/mode/owner as the first snapshot, mirroring
  // classifyDurableRead's own before/after drift rejection for content artifacts.
  assertRootConfinedToWorktree(coordRoot);
  let stat2;
  try {
    stat2 = fs.lstatSync(coordRoot, { bigint: true });
  } catch (err) {
    throw new CliError('INVALID', 'SECURITY_INVALID', 'coordination root vanished during validation: ' + coordRoot);
  }
  if (stat2.isSymbolicLink() || stat2.dev !== stat.dev || stat2.ino !== stat.ino || stat2.mode !== stat.mode || stat2.uid !== stat.uid || stat2.gid !== stat.gid) {
    throw new CliError('INVALID', 'SECURITY_INVALID', 'coordination root identity changed during validation (swap/tamper): ' + coordRoot);
  }
  if (nativeWindows) {
    const finalWindowsAcl = windowsPrivateDirectoryAcl(coordRoot, { mode: 'validate' });
    assertWindowsPrivateDirectoryAcl(finalWindowsAcl, coordRoot);
    if (!windowsAclSnapshotsEqual(initialWindowsAcl, finalWindowsAcl)) {
      throw new CliError('INVALID', 'SECURITY_INVALID', 'coordination root ACL changed during validation (tamper): ' + coordRoot);
    }
  }
  return coordRoot;
}

function cmdRootValidate(flags) {
  requireFlags(flags, ['coordination-root']);
  const coordRoot = resolveAbsolute(flags['coordination-root']);
  return { artifact_ref: validateRootConfinement(coordRoot) };
}

  return Object.freeze({
    cmdRootInit,
    cmdRootValidate,
    validateRootConfinement,
  });
}

module.exports = { createRootLifecycle };
