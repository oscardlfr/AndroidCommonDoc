'use strict';

const fs = require('fs');
const path = require('path');
const { CliError, genId, sha256Buffer } = require('../primitives.cjs');
const { createWriteSupport } = require('./write-support.cjs');
const { createWriteVerifier } = require('./write-verify.cjs');

function createDurableWriters(dependencies) {
  const { markPoisoned } = dependencies;
  const {
    assertDurable, fsyncDir, fsyncDirCauseSuffix, hardenTempFdExact0600,
    isLockRmdirFaultActive, isLoserUnlinkFaultActive,
    isNoclobberPrelinkFaultActive, isNoclobberPrevalidateFaultActive,
    isReplacePostRenameFaultActive, isTempFsyncFaultActive,
    isTempUnlinkFaultActive, writeAllSync,
  } = createWriteSupport();
  const { assertDurableTargetMatches, assertArtifactMatchesReceipt } =
    createWriteVerifier(isReplacePostRenameFaultActive);

  function publishNoClobber(targetPath, bytes, opts) {
    const options = opts || {};
    const dir = path.dirname(targetPath);
    fs.mkdirSync(dir, { recursive: true });
    const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    const tempPath = path.join(dir, '.' + path.basename(targetPath) + '.' + process.pid + '.' + genId({ raw: true }).slice(0, 16) + '.tmp-owner');
    // Exclusive/no-follow temp create (defense-in-depth, DUR-06): O_CREAT|O_EXCL
    // rejects a pre-planted file already sitting at this (random-nonce, so
    // practically unguessable) temp path instead of silently overwriting it;
    // O_NOFOLLOW rejects a pre-planted symlink at that exact path instead of
    // following it. Neither flag changes behavior for the overwhelmingly-common
    // case (temp path never previously existed) -- a fresh cryptographically-
    // random nonce every call -- so this open() succeeds exactly as the prior
    // plain writeFileSync did.
    const tempFd = fs.openSync(
      tempPath,
      fs.constants.O_CREAT | fs.constants.O_WRONLY | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW,
      0o600,
    );
    let tempIdentity;
    try {
      // Section 0.3: force exact 0600 via fchmod (never trust open()'s mode argument
      // alone, which is subject to the process umask) before any byte is written.
      hardenTempFdExact0600(tempFd, tempPath, options.suppressInternalFaultInjection);
      writeAllSync(tempFd, buf);
      fs.fsyncSync(tempFd);
      // Codex P1-1: capture OUR OWN temp's identity (dev/ino) while its fd is still open
      // and trusted -- the post-link revalidation below binds the final target back to
      // THIS exact inode, so a temp swapped out from under us between this close and the
      // linkSync call cannot be laundered into a SUCCESS merely because linkSync itself
      // did not error.
      tempIdentity = fs.fstatSync(tempFd, { bigint: true });
    } finally {
      fs.closeSync(tempFd);
    }
    if (!options.suppressInternalFaultInjection && isNoclobberPrelinkFaultActive('swap')) {
      // Test-only (Codex P1-1 repro): simulate an attacker swapping the temp's content
      // between our own fsync+identity-capture and our linkSync below.
      try { fs.unlinkSync(tempPath); } catch (e) { /* best-effort test setup */ }
      fs.writeFileSync(tempPath, Buffer.from('RUNTIME_CONSULTATION_TEST_ATTACKER_SWAP_CONTENT'), { mode: 0o600 });
    } else if (!options.suppressInternalFaultInjection && isNoclobberPrelinkFaultActive('swap-same-bytes')) {
      // Test-only (Codex NO-GO round 2, missing-evidence item 3): swap to a FRESH file
      // carrying the EXACT SAME bytes we just wrote (`buf`) -- a different inode, but
      // byte-identical content. Isolates that the post-link revalidation's identity
      // binding (dev/ino), not merely a byte comparison, is what rejects the foreign
      // inode: a byte-only check would see identical content and wrongly accept it.
      const replacementPath = tempPath + '.same-bytes-replacement';
      fs.writeFileSync(replacementPath, buf, { mode: 0o600, flag: 'wx' });
      try { fs.unlinkSync(tempPath); } catch (e) { /* best-effort test setup */ }
      fs.renameSync(replacementPath, tempPath);
    }
    if (typeof options.revalidateBeforeLink === 'function') {
      try {
        options.revalidateBeforeLink();
      } catch (err) {
        // M7 GREEN section 4.6: a revalidateBeforeLink rejection (e.g. a
        // freshly-observed terminal) must leave ZERO observable mutation --
        // the temp-owner file already created/fsynced above is best-effort
        // cleaned up here too, mirroring the identical non-EEXIST linkSync
        // failure cleanup below. Never masks the original rejection reason.
        try { fs.unlinkSync(tempPath); } catch (cleanupErr) { /* best effort */ }
        throw err;
      }
    }
    try {
      fs.linkSync(tempPath, targetPath);
    } catch (err) {
      if (err.code === 'EEXIST') {
        // Loser cleanup (PLAN.md ~L679-683 binding: "losers clean temp + flush"), CHECKED,
        // strictly BEFORE any idempotent-success or race-loss classification (Section 0.2):
        // unlink our own owned temp, then flush the directory. Either step failing means we
        // cannot PROVE our temp is durably gone, so the call fails closed DURABILITY_UNPROVEN
        // -- never an idempotent SUCCESS (even against a byte-identical target) and never a
        // silent best-effort swallow that leaves a false completion claim.
        try {
          if (!options.suppressInternalFaultInjection && isLoserUnlinkFaultActive()) {
            const injected = new Error('injected loser-cleanup unlink failure (RUNTIME_CONSULTATION_FAULT_LOSER_UNLINK)');
            injected.code = 'EIO';
            throw injected;
          }
          fs.unlinkSync(tempPath);
        } catch (unlinkErr) {
          throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'no-clobber loser could not durably remove its own temp: ' + tempPath + ' (' + (unlinkErr && unlinkErr.message) + ')');
        }
        if (!fsyncDir(dir, 'loser-cleanup', options.suppressInternalFaultInjection)) {
          throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'no-clobber loser temp cleanup could not be flushed durable for ' + dir + fsyncDirCauseSuffix());
        }
        if (options.allowIdenticalIdempotent) {
          // DUR-F (PLAN.md ~L679-683): the idempotent no-op must FD-BIND the existing
          // target and prove it is a genuine, owner-confined, durable REGULAR FILE --
          // never read it by path (which follows a symlink and would accept an
          // attacker-planted byte-identical file, or a hard link, as the durable
          // artifact). O_NOFOLLOW rejects a symlinked target at open; fstat proves
          // regular-file + owner + owner-only mode + nlink==1; the compare is
          // fd-bound and re-fstat'd for identity (no swap mid-read).
          let existingFd;
          try {
            existingFd = fs.openSync(targetPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
          } catch (openErr) {
            if (openErr && openErr.code === 'ELOOP') {
              throw new CliError('INVALID', 'SECURITY_INVALID', 'idempotent target is a symlink (rejected at open): ' + targetPath);
            }
            throw openErr;
          }
          try {
            // DUR-J item 5: reuse the shared BigInt comparator to prove the existing target is
            // a genuine, owner-confined, EXACT-0600, nlink==1, identity-stable durable file
            // carrying EXACTLY our bytes (with a final re-lstat). Byte-identical + durable -> an
            // idempotent no-op success; a genuine durable target with DIFFERENT bytes is a
            // no-clobber race-loss (a different publisher won); nlink==2 / symlink / wrong-mode /
            // identity drift propagate as their own SECURITY/DURABILITY failure.
            let idempotentSt;
            try {
              idempotentSt = assertDurableTargetMatches(existingFd, targetPath, buf, undefined, options.suppressReplacePostRenameFaultInjection);
            } catch (cmpErr) {
              if (cmpErr && cmpErr.byteMismatch) {
                throw new CliError('INVALID', options.raceDetailCode || 'AUTHORITY_INVALID', 'no-clobber race lost (existing durable target differs) for ' + targetPath);
              }
              throw cmpErr;
            }
            // Receipt built from the EXACT snapshot assertDurableTargetMatches
            // itself already accredited (its own return value) -- never a
            // separate, later fstat call on the same fd. Codex NO-GO round 17
            // (P1): the prior round's own "never a fresh by-path fstat" fix
            // still performed a fresh FD-BOUND fstat here, which is a narrower
            // but still-real gap -- a mutation landing between the comparator's
            // own internal proof (st/st2/lst all consistent) and this call would
            // have been silently adopted as if it were the original snapshot.
            return {
              path: targetPath, dev: idempotentSt.dev, ino: idempotentSt.ino,
              mode: idempotentSt.mode, uid: idempotentSt.uid, gid: idempotentSt.gid,
              nlink: idempotentSt.nlink, ctimeNs: idempotentSt.ctimeNs, mtimeNs: idempotentSt.mtimeNs,
              digest: sha256Buffer(buf),
            };
          } finally {
            fs.closeSync(existingFd);
          }
        }
        throw new CliError('INVALID', options.raceDetailCode || 'AUTHORITY_INVALID', 'no-clobber race lost for ' + targetPath);
      }
      // Non-EEXIST linkSync failure: NOT the PLAN-bound loser-cleanup path above (an
      // arbitrary fs error, not a race loss) -- best-effort temp cleanup, as before.
      try { fs.unlinkSync(tempPath); } catch (cleanupErr) { /* best effort */ }
      throw err;
    }
    // Barrier 1: target link durable while nlink==2. If NOT proven, the target
    // currently exists with nlink==2 (still hard-linked from tempPath) -- the
    // exact crash-cut state CC-02/CC-03 already model for an out-of-process
    // crash (a reader's assertDurable correctly rejects nlink==2 as
    // DURABILITY_UNPROVEN) -- fail closed: the writer itself must never claim
    // SUCCESS on an unproven durability barrier.
    if (!fsyncDir(dir, 'barrier1', options.suppressInternalFaultInjection)) {
      // Fail closed and deliberately LEAVE the target at nlink==2 (the owner-tagged
      // temp stays hard-linked): barrier 1 was never proven, so unlinking the temp
      // here would drop the target to nlink==1 and break the PLAN.md ~L681 invariant
      // (nlink==1 IMPLIES barrier-1-durable) -- a reader's assertDurable or an
      // idempotent retry would then launder this unproven barrier as durable
      // (DUR-C). Codex NO-GO round 2 (blocker 1): the nlink==2 orphan is later
      // DETECTED and REPORTED by `reconcileTempArtifacts`/`cleanup` (`'unlink-unsafe'`,
      // DUR-H) -- it is NOT auto-completed/reconciled away; no portable primitive can
      // prove a path-based unlink targets the fd-accredited inode, so recovery
      // reports the orphan rather than resolving it.
      throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'directory-fsync barrier 1 not proven for ' + dir + fsyncDirCauseSuffix());
    }
    try {
      if (!options.suppressInternalFaultInjection && isTempUnlinkFaultActive()) {
        const injected = new Error('injected temp-unlink failure (RUNTIME_CONSULTATION_FAULT_TEMP_UNLINK)');
        injected.code = 'EIO';
        throw injected;
      }
      fs.unlinkSync(tempPath);
    } catch (err) {
      // DUR-E: a failed post-barrier-1 temp unlink leaves the target hard-linked
      // (nlink==2) -- a reader/idempotent-retry rejects it -- so the writer must
      // fail closed rather than swallow the failure and return a non-durable
      // SUCCESS. Codex NO-GO round 2 (blocker 1): the nlink==2 orphan is later
      // DETECTED and REPORTED (never auto-completed) by `cleanup` (DUR-H).
      throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'temp cleanup unlink failed after barrier 1; target not durable: ' + tempPath);
    }
    // Barrier 2: cleanup durable. The target link is already fully present at
    // nlink==1 by this point regardless of this barrier's own outcome -- but
    // the writer's OWN contract (PLAN.md ~L679: "Writer returns only after
    // barrier 2") is stricter than what a reader can currently observe here, so
    // an unproven barrier 2 still fails the publish closed rather than
    // returning SUCCESS.
    if (!fsyncDir(dir, 'barrier2', options.suppressInternalFaultInjection)) {
      throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'directory-fsync barrier 2 not proven for ' + dir + fsyncDirCauseSuffix());
    }
    // Codex P1-1: the writer's own SUCCESS claim must be PROVEN, not merely inferred from
    // the barriers having reported clean -- a temp swapped in before linkSync, a target
    // deleted after it, or a hardlink added after it would otherwise let this function
    // return SUCCESS over a target that is foreign, absent, or no longer nlink==1. This
    // final fd-bound revalidation re-opens the target NO_FOLLOW and binds it back to the
    // ORIGINAL temp's captured identity (dev/ino) via the shared comparator, re-proving
    // regular/owner/exact-0600/nlink==1/exact-bytes/stable-metadata. From this point the
    // durable link is ALREADY established (mirroring publishReplace's POST_RENAME_UNPROVEN
    // phase) -- ANY failure here POISONS so a caller holding the transition lock retains it
    // as a durable orphan for later reconciliation rather than silently releasing over a
    // compromised or vanished target.
    try {
      if (!options.suppressInternalFaultInjection && isNoclobberPrevalidateFaultActive('delete')) {
        // Test-only (Codex P1-1 repro): simulate an attacker deleting the just-published
        // target after barrier 2 but before this revalidation observes it.
        try { fs.unlinkSync(targetPath); } catch (e) { /* best-effort test setup */ }
      } else if (!options.suppressInternalFaultInjection && isNoclobberPrevalidateFaultActive('hardlink')) {
        // Test-only (Codex P1-1 repro): simulate an attacker adding a second hardlink to
        // the just-published target after barrier 2 but before this revalidation observes
        // it -- the shared comparator's nlink==1 check must reject it.
        try { fs.linkSync(targetPath, targetPath + '.attacker-hardlink-test-only'); } catch (e) { /* best-effort test setup */ }
      }
      let checkFd;
      try {
        checkFd = fs.openSync(targetPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      } catch (err) {
        if (err && err.code === 'ELOOP') {
          throw new CliError('INVALID', 'SECURITY_INVALID', 'published target is a symlink (rejected at post-publish revalidation): ' + targetPath);
        }
        throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'published target vanished before post-publish revalidation: ' + targetPath + ' (' + (err && err.message) + ')');
      }
      let publishedSt;
      try {
        // Codex NO-GO round 17 (P1): built directly from the comparator's OWN
        // return value -- the exact snapshot it already triple-proved stable
        // internally (st/st2/lst) -- rather than a separate, later fstat call
        // on the same fd. Round 16's own "captured immediately after" fix was
        // still a distinct, unvalidated re-read, reopening a fresh (if narrow)
        // window between the comparator's own proof and this call's own read;
        // see assertDurableTargetMatches's own matching comment.
        publishedSt = assertDurableTargetMatches(checkFd, targetPath, buf, { dev: tempIdentity.dev, ino: tempIdentity.ino }, options.suppressReplacePostRenameFaultInjection);
      } finally {
        try { fs.closeSync(checkFd); } catch (e) { /* best-effort cleanup */ }
      }
      // Receipt: dev/ino already fd-bound-proven above (tempIdentity, which now
      // IS the target's own identity post-linkSync); digest is over `buf`, the
      // exact bytes this call wrote -- never a re-read/re-serialization, so a
      // caller holding this receipt can later compare fresh fd-bound bytes/
      // identity against it directly, with no reconstruction step in between.
      return {
        path: targetPath, dev: tempIdentity.dev, ino: tempIdentity.ino,
        mode: publishedSt.mode, uid: publishedSt.uid, gid: publishedSt.gid,
        nlink: publishedSt.nlink, ctimeNs: publishedSt.ctimeNs, mtimeNs: publishedSt.mtimeNs,
        digest: sha256Buffer(buf),
      }; // COMPLETE: publish credited durable + fully revalidated.
    } catch (err) {
      const poisoned = new CliError('INVALID', 'DURABILITY_UNPROVEN', 'post-publish target not accredited durable (POST_LINK_UNPROVEN): ' + (err && err.message));
      poisoned.cause = err;
      throw markPoisoned(poisoned);
    }
  }

  function publishReplace(targetPath, bytes) {
    const dir = path.dirname(targetPath);
    fs.mkdirSync(dir, { recursive: true });
    const tempPath = path.join(dir, '.' + path.basename(targetPath) + '.' + process.pid + '.' + genId({ raw: true }).slice(0, 16) + '.refresh-tmp-owner');
    // DUR-G (PLAN.md ~L677): the refresh temp is created with the SAME owner-confined,
    // no-follow, exclusive discipline as publishNoClobber -- O_EXCL rejects a colliding
    // stray, O_NOFOLLOW rejects a planted symlink at the temp path, 0600 keeps it
    // owner-only -- then the canonical bytes are written through that one fd and the
    // FILE is fsync'd via the same fd (never re-opened by path, which would re-follow).
    let tempFd;
    try {
      tempFd = fs.openSync(tempPath, fs.constants.O_CREAT | fs.constants.O_WRONLY | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    } catch (err) {
      throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'refresh temp could not be created exclusively: ' + (err && err.message));
    }
    let tempIdentity;
    try {
      // Section 0.3: force exact 0600 via fchmod (never trust open()'s mode argument
      // alone, which is subject to the process umask) before any byte is written.
      hardenTempFdExact0600(tempFd, tempPath);
      writeAllSync(tempFd, bytes);
      if (isTempFsyncFaultActive()) {
        const injected = new Error('injected refresh temp fsync failure (RUNTIME_CONSULTATION_FAULT_TEMP_FSYNC)');
        injected.code = 'EIO';
        throw injected;
      }
      fs.fsyncSync(tempFd);
      // Codex NO-GO round 17 (P1): capture OUR OWN temp's identity while its fd
      // is still open and trusted -- mirrors publishNoClobber's own tempIdentity
      // discipline (line ~941) exactly. renameSync preserves the inode (dev/ino
      // unchanged across a same-filesystem rename), so this lets the post-rename
      // revalidation below bind the renamed target back to THIS SPECIFIC inode,
      // never merely "some byte-matching regular file" -- without it, a swap of
      // targetPath for a byte-identical foreign file between rename and
      // revalidation would go completely undetected.
      tempIdentity = fs.fstatSync(tempFd, { bigint: true });
    } catch (err) {
      try { fs.closeSync(tempFd); } catch (e) { /* already closed */ }
      try { fs.unlinkSync(tempPath); } catch (e) { /* best-effort cleanup */ }
      // PRE_RENAME failure: the rename has NOT happened, the prior target is intact -> a
      // normal (non-poisoning) error, so the caller's lock is released. A CliError from
      // hardenTempFdExact0600 above is preserved verbatim (its own detail_code is more
      // specific than a generic wrap); any other fs-level error is wrapped as before.
      throw (err instanceof CliError) ? err : new CliError('INVALID', 'DURABILITY_UNPROVEN', 'refresh temp write/fsync failed (PRE_RENAME, prior lease intact): ' + (err && err.message));
    }
    // The pre-rename temp CLOSE is part of PRE_RENAME: a failed close means the temp cannot
    // be trusted as fully committed, so we do NOT rename (the prior target stays intact).
    try {
      fs.closeSync(tempFd);
    } catch (err) {
      try { fs.unlinkSync(tempPath); } catch (e) { /* best-effort PRE_RENAME cleanup */ }
      throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'refresh temp close failed (PRE_RENAME, prior lease intact): ' + (err && err.message));
    }

    // DUR-J item 7 -- explicit progress states. The RENAME is the durability boundary. A
    // rename FAILURE leaves the prior target intact (PRE_RENAME) -> a NORMAL error, so the
    // caller's lock may be released and the prior lease remains valid.
    try {
      fs.renameSync(tempPath, targetPath);
    } catch (err) {
      try { fs.unlinkSync(tempPath); } catch (e) { /* best-effort PRE_RENAME cleanup */ }
      throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'refresh rename failed (prior lease intact, PRE_RENAME): ' + (err && err.message));
    }

    // POST_RENAME_UNPROVEN: the new bytes are visible at the target (nlink==1) but NOT yet
    // proven durable, and a crash could revert to the prior lease. An OUTER catch turns ANY
    // throwable from here to COMPLETE -- the directory barrier, or any open/fstat/read/fstat/
    // lstat/close of the fd-bound revalidation, or an unexpected error -- into a POISONED
    // DURABILITY_UNPROVEN so withLock retains .lock as a durable orphan and later actors
    // timeout+STOP. The phase boundary is STRUCTURAL (this try region), never per-throw marking.
    try {
      if (isReplacePostRenameFaultActive('barrier') || !fsyncDir(dir, 'replace')) {
        throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'refresh directory barrier could not be flushed after rename: ' + targetPath + fsyncDirCauseSuffix());
      }
      // POST_DIR_FSYNC: revalidate the durable target with the shared fd-bound comparator (the
      // fstat1/read/fstat2/lstat fault seams live INSIDE the comparator, at the real steps).
      if (isReplacePostRenameFaultActive('swap-same-bytes')) {
        // Test-only (Codex HARD NO-GO post round 17, repro for the tempIdentity
        // binding this same round added): simulate an attacker replacing the
        // just-renamed target with a FRESH file carrying byte-identical
        // content -- a different inode -- in the window between rename and
        // this revalidation opening it. Isolates that the tempIdentity dev/ino
        // binding (not merely a byte comparison) is what rejects the foreign
        // inode.
        const replacementPath = targetPath + '.same-bytes-replacement';
        fs.writeFileSync(replacementPath, bytes, { mode: 0o600, flag: 'wx' });
        try { fs.unlinkSync(targetPath); } catch (e) { /* best-effort test setup */ }
        fs.renameSync(replacementPath, targetPath);
      }
      if (isReplacePostRenameFaultActive('open')) throw new Error('injected post-rename open fault');
      const checkFd = fs.openSync(targetPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      let revalErr = null;
      let publishedSt = null;
      try {
        // Codex NO-GO round 17 (P1, two fixes): (1) bind back to the ORIGINAL
        // temp's own captured inode (tempIdentity) -- previously omitted here
        // entirely, unlike publishNoClobber's own equivalent call, so this
        // revalidation could only prove "some byte-matching regular file exists
        // at targetPath", never that it is the SPECIFIC inode renameSync just
        // created. (2) use the comparator's OWN return value for the receipt
        // instead of a separate, later fstat call on the same fd -- round 16's
        // own "captured immediately after" fix was still a distinct,
        // unvalidated re-read; see assertDurableTargetMatches's own comment.
        publishedSt = assertDurableTargetMatches(checkFd, targetPath, bytes, { dev: tempIdentity.dev, ino: tempIdentity.ino });
      } catch (err) {
        revalErr = err;
      }
      // The post-rename CLOSE of the revalidation fd is a durability step, NOT silenced. The
      // 'close' seam takes the PRIMARY close's own place (Section 0.4: never a redundant SECOND
      // close of an already-closed fd, which would manufacture an unrelated EBADF instead of
      // proving a genuine primary-close failure) -- the real fd is still closed for real via the
      // `finally` cleanup below, so no fd leaks even when the fault fires. If both the
      // revalidation and the close fail, both are preserved (close as cause) but the primary
      // outcome is still a poisoned DURABILITY_UNPROVEN.
      let closeErr = null;
      let checkFdClosed = false;
      try {
        if (isReplacePostRenameFaultActive('close')) {
          const injected = new Error('injected post-rename close fault (RUNTIME_CONSULTATION_FAULT_REPLACE_POSTRENAME=close)');
          injected.code = 'EBADF';
          throw injected;
        }
        fs.closeSync(checkFd);
        checkFdClosed = true;
      } catch (err) {
        closeErr = err;
      } finally {
        if (!checkFdClosed) {
          try { fs.closeSync(checkFd); } catch (err) { /* best-effort cleanup after the primary close failed/was faulted */ }
        }
      }
      if (revalErr) {
        if (closeErr) revalErr.cause = closeErr;
        throw revalErr;
      }
      if (closeErr) throw closeErr;
      return {
        path: targetPath, dev: publishedSt.dev, ino: publishedSt.ino,
        mode: publishedSt.mode, uid: publishedSt.uid, gid: publishedSt.gid,
        nlink: publishedSt.nlink, ctimeNs: publishedSt.ctimeNs, mtimeNs: publishedSt.mtimeNs,
        digest: sha256Buffer(bytes),
      }; // COMPLETE: rename credited durable + fully revalidated.
    } catch (err) {
      // Residual: after the rename, the PRIMARY truth is that the newly-visible target was NOT
      // accredited durable -> ALWAYS a fresh poisoned DURABILITY_UNPROVEN, with the original
      // (possibly SECURITY_INVALID / SCHEMA_INVALID / an fs error) preserved only as cause.
      const poisoned = new CliError('INVALID', 'DURABILITY_UNPROVEN', 'post-rename target not accredited durable (POST_RENAME_UNPROVEN): ' + (err && err.message));
      poisoned.cause = err;
      throw markPoisoned(poisoned);
    }
  }

  return {
    assertArtifactMatchesReceipt, assertDurable, fsyncDir, fsyncDirCauseSuffix,
    isLockRmdirFaultActive, publishNoClobber, publishReplace, writeAllSync,
  };
}

module.exports = { createDurableWriters };
