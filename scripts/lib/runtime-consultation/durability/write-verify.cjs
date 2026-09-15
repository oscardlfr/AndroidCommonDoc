'use strict';

const fs = require('fs');
const { CliError } = require('../primitives.cjs');
const { readAllFromFd, statIsRegularFile } = require('./common.cjs');

function createWriteVerifier(isReplacePostRenameFaultActive) {
  function assertDurableTargetMatches(fd, targetPath, expectedBytes, expectedIdentity, suppressReplacePostRenameFaultInjection) {
    if (!suppressReplacePostRenameFaultInjection && isReplacePostRenameFaultActive('fstat1')) throw new Error('injected fstat1 fault');
    const st = fs.fstatSync(fd, { bigint: true });
    if (!statIsRegularFile(st)) throw new CliError('INVALID', 'SECURITY_INVALID', 'target is not a regular file: ' + targetPath);
    const isPosix = process.platform !== 'win32';
    if (isPosix && typeof process.getuid === 'function' && st.uid !== BigInt(process.getuid())) throw new CliError('INVALID', 'SECURITY_INVALID', 'target is not owner-confined: ' + targetPath);
    if (isPosix && (st.mode & 0o777n) !== 0o600n) throw new CliError('INVALID', 'SECURITY_INVALID', 'target mode is not owner-only 0600: ' + targetPath);
    if (expectedIdentity && (st.dev !== expectedIdentity.dev || st.ino !== expectedIdentity.ino)) {
      throw new CliError('INVALID', 'SECURITY_INVALID', 'target inode does not match the originally published temp (swap/tamper between write and link): ' + targetPath);
    }
    if (st.nlink !== 1n) throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'target nlink!=1: ' + targetPath);

    let mismatchErr = null;
    if (st.size !== BigInt(expectedBytes.length)) {
      // A size difference IS a content difference (byte-mismatch); recorded, not thrown yet.
      mismatchErr = new CliError('INVALID', 'DURABILITY_UNPROVEN', 'target size does not match the payload: ' + targetPath);
      mismatchErr.byteMismatch = true;
    } else {
      if (!suppressReplacePostRenameFaultInjection && isReplacePostRenameFaultActive('read')) throw new Error('injected read fault');
      const readback = readAllFromFd(fd, Number(st.size) + 1);
      if (Buffer.compare(readback, expectedBytes) !== 0) {
        // A genuine, durable target that simply carries DIFFERENT bytes is flagged distinctly so
        // an idempotent caller can map it to a no-clobber race-loss rather than a durability fault.
        mismatchErr = new CliError('INVALID', 'DURABILITY_UNPROVEN', 'target bytes do not match the payload: ' + targetPath);
        mismatchErr.byteMismatch = true;
      }
    }

    // Codex NO-GO round 16 (P1): ONLY evaluated when the bytes above already
    // matched -- if they didn't, mismatchErr (byteMismatch) already correctly
    // identifies this as "a different record occupies this path", and this
    // check must not steal that classification merely because an ordinary
    // content difference also touches ctimeNs. This exists for the NARROWER
    // case bytes alone can never catch: a rewrite-in-place (same inode)
    // FOLLOWED BY an exact-bytes restoration, indistinguishable from "never
    // touched" by content alone -- only comparing metadata against the
    // ORIGINAL publish-time snapshot (not just this call's own internal
    // st2/lst below, which only prove consistency across their OWN brief
    // window) can. When the caller supplies the FULL original snapshot
    // (mode/uid/gid/nlink/ctimeNs/mtimeNs, not just dev/ino --
    // `publishNoClobber`'s own internal temp-identity binding still passes
    // only dev/ino and is unaffected), a genuine rewrite changes at least
    // ctimeNs even if the final bytes are restored to identical.
    if (!mismatchErr && expectedIdentity && expectedIdentity.mode !== undefined && (
      st.mode !== expectedIdentity.mode || st.uid !== expectedIdentity.uid || st.gid !== expectedIdentity.gid
      || st.nlink !== expectedIdentity.nlink || st.ctimeNs !== expectedIdentity.ctimeNs || st.mtimeNs !== expectedIdentity.mtimeNs
    )) {
      throw new CliError('INVALID', 'SECURITY_INVALID', 'target metadata does not match its own original publish-time snapshot (rewritten since, even though current bytes match): ' + targetPath);
    }

    if (!suppressReplacePostRenameFaultInjection && isReplacePostRenameFaultActive('fstat2')) throw new Error('injected fstat2 fault');
    const st2 = fs.fstatSync(fd, { bigint: true });
    if (st2.dev !== st.dev || st2.ino !== st.ino || st2.nlink !== st.nlink || st2.size !== st.size || st2.mode !== st.mode || st2.uid !== st.uid || st2.gid !== st.gid || st2.ctimeNs !== st.ctimeNs || st2.mtimeNs !== st.mtimeNs) {
      throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'target identity changed during read (rewrite/chmod/hardlink/growth): ' + targetPath);
    }
    if (!suppressReplacePostRenameFaultInjection && isReplacePostRenameFaultActive('lstat')) throw new Error('injected lstat fault');
    const lst = fs.lstatSync(targetPath, { bigint: true });
    // PRESENT requires the LAST snapshot still be a single-link (nlink==1) inode with ALL
    // invariants -- including ctimeNs/mtimeNs -- unchanged from the stable fstat snapshot.
    if (lst.dev !== st.dev || lst.ino !== st.ino || lst.nlink !== st.nlink || lst.size !== st.size || lst.mode !== st.mode || lst.uid !== st.uid || lst.gid !== st.gid || lst.ctimeNs !== st.ctimeNs || lst.mtimeNs !== st.mtimeNs) {
      throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'target path rebound or invariants changed after read: ' + targetPath);
    }

    // Identity/path proven STABLE throughout the read -- ONLY NOW may a genuine byte/size
    // mismatch be surfaced as a race-loss candidate.
    if (mismatchErr) throw mismatchErr;
    // Codex NO-GO round 17 (P1): return the EXACT snapshot this call already
    // triple-proved stable (st == st2 == lst, all just asserted above) so a
    // caller building a receipt uses THIS accredited value directly, instead of
    // performing its own separate, later fstat on the same fd -- which would
    // reopen a fresh, unvalidated window between this function's own proof and
    // that subsequent read (the exact class of gap this function exists to
    // close in the first place).
    return st;
  }

  function assertArtifactMatchesReceipt(artifactPath, receipt, expectedBytes) {
    let fd;
    try {
      fd = fs.openSync(artifactPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    } catch (err) {
      if (err && err.code === 'ELOOP') {
        throw new CliError('INVALID', 'SECURITY_INVALID', 'artifact is a symlink (rejected at post-publish re-verification): ' + artifactPath);
      }
      throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'artifact vanished before post-publish re-verification: ' + artifactPath + ' (' + (err && err.message) + ')');
    }
    try {
      try {
        // Codex NO-GO round 16 (P1): the FULL receipt is passed through (not
        // just dev/ino) so assertDurableTargetMatches also proves mode/uid/gid/
        // nlink/ctimeNs/mtimeNs are unchanged since the ORIGINAL publish moment
        // -- catching a rewrite-then-restore-exact-bytes attack on the SAME
        // inode that a dev/ino-only comparison would miss entirely.
        assertDurableTargetMatches(fd, artifactPath, expectedBytes, receipt);
      } catch (err) {
        // assertDurableTargetMatches is shared with publishNoClobber's own
        // idempotent-path revalidation and throws its OWN generic vocabulary
        // (DURABILITY_UNPROVEN for a byte/size mismatch). This file's own
        // established convention for "a different, otherwise-valid record
        // occupies this path" is AUTHORITY_INVALID (matching every other
        // substitution/mismatch check in cmdCancel/cmdAcceptResult/cmdClaim
        // etc.) -- remap ONLY the byte-mismatch case; identity/mode/owner/nlink
        // failures are already correctly SECURITY_INVALID/DURABILITY_UNPROVEN
        // and propagate unchanged.
        if (err && err.byteMismatch) {
          throw new CliError('INVALID', 'AUTHORITY_INVALID', 'artifact at ' + artifactPath + ' is not byte-identical to what this invocation published');
        }
        throw err;
      }
    } finally {
      try { fs.closeSync(fd); } catch (e) { /* best-effort cleanup */ }
    }
  }

  return { assertArtifactMatchesReceipt, assertDurableTargetMatches };
}

module.exports = { createWriteVerifier };

