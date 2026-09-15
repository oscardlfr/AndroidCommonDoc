'use strict';

function createCredentialEvidenceStore({
  fs,
  path,
  crypto,
  registryRepoDir,
  canonicalJSONStringify,
  fsyncDirSync,
  ensureSecureRegistryDir,
  computeCredentialEvidenceComplete,
  windowsPrivateDirectoryAcl,
  windowsAclSnapshotsEqual,
}) {
  /**
   * CORRECTION ROUND Section B (PLAN.md ~L550, record 14): durable
   * `credential-absence-checkpoints/v1`. Unlike this file's other durable
   * records (published once, no-clobber), this one is a CUMULATIVE,
   * run-lifetime-scoped accumulator (PLAN's own `checkpoints` array grows with
   * every checkpoint) -- written via a plain replace (fsync'd write, not
   * publishNoClobber) on every single checkpoint, which is the correct
   * semantics for a record that is BY DESIGN mutated/extended repeatedly over
   * one run's lifetime, never a write-once fact.
   */
  function credentialAbsenceCheckpointsPath(repoId, runId) {
    return path.join(registryRepoDir({ repoId }), 'credential-absence-checkpoints', runId + '.json');
  }
  /**
   * ADVERSARIAL RE-AUDIT (HARD NO-GO, 2026-07-21): best-effort corrective
   * re-publish using the SAME already-authorized credential-absence-
   * checkpoints/v1 schema -- deliberately never a new schema/record type (an
   * earlier attempt at a separate durable write-failure marker was reverted as
   * "an unauthorized invented schema"; see the comment on
   * checkpointAuthority.hadWriteFailure()'s own call site in publishAndFinalize
   * above). Called only when a publish's own directory-barrier failed AFTER
   * its rename already landed a record (potentially complete:true, computed
   * from BEFORE this failure was known) durably at targetPath -- overwrites
   * that SAME path with complete:false forced, using the SAME temp-write/
   * fsync-file/rename/fsync-dir sequence the original publish used. If this
   * retry's own barrier succeeds, a FUTURE process (a crash-restart, or any
   * process other than the one that observed the failure) reads a genuinely
   * honest complete:false off disk -- no new file, no new schema, and
   * isCredentialEvidenceComplete's own EXISTING record.complete-vs-rederived
   * mismatch check (CORRECTION ROUND findings 3+5 item 8) already refuses to
   * trust a record whose stated complete disagrees with fresh re-derivation,
   * so even a STRUCTURALLY-complete-looking checkpoints array combined with
   * this forced complete:false is still correctly rejected, never silently
   * accepted. Best-effort: if this retry's own barrier ALSO fails, nothing
   * regresses -- checkpointState.everHadWriteFailure (in-memory, for the
   * remainder of THIS process's life) remains exactly the same signal it was
   * before this fix, never worse.
   * CORRECTION PASS Block E: now RETURNS whether its OWN directory-barrier
   * (fsyncDirSync) genuinely succeeded (`false` on any failure, including the
   * write/rename itself throwing before the barrier is ever reached) -- its
   * caller (publishCredentialAbsenceCheckpoint) captures this onto
   * checkpointState so it can be surfaced through the existing
   * __testOnlyInspectFinalizationState introspection convention, closing the
   * in-process half of "was the CORRECTIVE rewrite's own barrier confirmed,
   * as opposed to the original publish's."
   * @returns {boolean}
   */
  const CORRECTIVE_REPUBLISH_FSYNC_RETRY_ATTEMPTS = 3;
  function correctivelyRepublishAsIncomplete(targetPath, targetDir, checkpoints, repoId, runId, mode, checkpointState) {
    const correctedRecord = {
      schema: 'coordination/credential-absence-checkpoints/v1',
      run_id: runId,
      mode: (typeof mode === 'string' && mode.length > 0) ? mode : 'app-server',
      root_ids: checkpointState.rootIds,
      checkpoints,
      complete: false,
    };
    const tempPath = targetPath + '.tmp-correction-' + process.pid + '-' + crypto.randomBytes(6).toString('hex');
    try {
      fs.writeFileSync(tempPath, canonicalJSONStringify(correctedRecord), { mode: 0o600 });
      const fd = fs.openSync(tempPath, process.platform === 'win32' ? 'r+' : 'r');
      try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(tempPath, targetPath);
      // CORRECTION PASS Block E: a bounded retry of the directory-barrier
      // fsync before giving up -- a legitimate, standard durability pattern;
      // a transient EIO-class failure can clear on retry. This narrows the
      // window in which a genuine double-fault is possible but does NOT, by
      // itself, close the deeper cross-process/cross-restart signal gap (a
      // FRESH process reading this record later still cannot distinguish
      // "confirmed durable" from "also failed" using only this schema's own
      // fields -- see block report).
      for (let attempt = 0; attempt < CORRECTIVE_REPUBLISH_FSYNC_RETRY_ATTEMPTS; attempt++) {
        if (fsyncDirSync(targetDir)) return true;
      }
      return false;
    } catch (err) {
      try { fs.unlinkSync(tempPath); } catch (cleanupErr) { /* best-effort temp cleanup */ }
      return false;
    }
  }

  /**
   * HARD NO-GO RESPONSE Block B: atomic temp-write -> fsync -> rename ->
   * directory-barrier sequence (matching this file's own publishNoClobber
   * precedent). THIRD HARD NO-GO RESPONSE fix (checkpoint-pollution/healing
   * bug): the new entry is included in a CANDIDATE array used to compute and
   * write the record, but is committed to `checkpointState.checkpoints`
   * (shared in-memory state, read by every SUBSEQUENT publish call) only AFTER
   * the write is confirmed genuinely durable -- a failed write can never leave
   * a phantom ok:true entry for a later successful write to silently inherit/
   * "heal" into its own re-published array. Any write failure, ever, also
   * permanently sets `checkpointState.everHadWriteFailure` -- checked by
   * `complete` on every subsequent publish (and by isCredentialEvidenceComplete
   * below), so this run's evidence can never silently heal back to
   * complete:true after a genuine durability failure, regardless of what
   * succeeds afterward.
   */
  function publishCredentialAbsenceCheckpoint(checkpointState, { repoId, runId, mode, checkpointEntry }) {
    const candidateCheckpoints = checkpointState.checkpoints.concat([checkpointEntry]);
    const record = {
      schema: 'coordination/credential-absence-checkpoints/v1',
      run_id: runId,
      mode: (typeof mode === 'string' && mode.length > 0) ? mode : 'app-server',
      root_ids: checkpointState.rootIds,
      checkpoints: candidateCheckpoints,
      complete: !checkpointState.everHadWriteFailure && computeCredentialEvidenceComplete(candidateCheckpoints, checkpointState.expectedRoster),
    };
    const targetPath = credentialAbsenceCheckpointsPath(repoId, runId);
    const targetDir = path.dirname(targetPath);
    const tempPath = targetPath + '.tmp-' + process.pid + '-' + crypto.randomBytes(6).toString('hex');
    try {
      const targetDirResult = ensureSecureRegistryDir(targetDir);
      if (!targetDirResult.ok) throw new Error('checkpoint-directory-insecure:' + targetDirResult.reason);
      fs.writeFileSync(tempPath, canonicalJSONStringify(record), { mode: 0o600 });
      const fd = fs.openSync(tempPath, process.platform === 'win32' ? 'r+' : 'r');
      try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(tempPath, targetPath);
      if (!fsyncDirSync(targetDir)) {
        // ADVERSARIAL RE-AUDIT (HARD NO-GO, 2026-07-21): the rename above
        // already landed `record` (potentially complete:true) at targetPath
        // BEFORE this directory-barrier confirmation ever ran -- a crash or
        // process exit right here leaves that record durably readable by a
        // FUTURE process, which starts with a fresh, unpoisoned
        // checkpointState.everHadWriteFailure (in-memory only, never survives
        // past this process). A best-effort corrective re-publish (SAME
        // already-authorized schema, complete forced false) closes that gap
        // without inventing new durable state -- see its own docblock.
        checkpointState.everHadWriteFailure = true;
        // CORRECTION PASS Block E: capture whether the CORRECTIVE rewrite's
        // OWN directory-barrier was itself confirmed durable -- distinct from
        // the original publish's own (already-failed) barrier above.
        checkpointState.correctiveRepublishDurabilityConfirmed = correctivelyRepublishAsIncomplete(targetPath, targetDir, candidateCheckpoints, repoId, runId, mode, checkpointState);
        return false;
      }
      checkpointState.checkpoints = candidateCheckpoints; // commit ONLY now, write genuinely durable.
      return true;
    } catch (err) {
      try { fs.unlinkSync(tempPath); } catch (cleanupErr) { /* best-effort temp cleanup */ }
      checkpointState.everHadWriteFailure = true; // permanent -- never un-set for the rest of this run.
      return false;
    }
  }

  // Blocker B: this record is a cumulative, ever-growing array (unlike the
  // small, fixed-shape credential blob CREDENTIAL_SOURCE_MAX_BYTES guards) --
  // a dedicated, generously-bounded constant, never a reuse of that smaller,
  // semantically different limit.
  const CREDENTIAL_ABSENCE_CHECKPOINTS_MAX_BYTES = 4 * 1024 * 1024; // 4 MiB.

  /**
   * HARD NO-GO RESPONSE Blocker B: fd-bound read for the durable
   * credential-absence-checkpoints/v1 record, mirroring readCredentialSourceFd's
   * own lstat -> open(O_NOFOLLOW) -> fstat -> owner/mode/nlink/identity checks
   * -> bounded read -> re-fstat -> strict UTF-8 decode -> final lstat sequence
   * (see that function's own docblock for the full rationale) -- this closes
   * the last raw, non-fd-bound read of a security-relevant durable record in
   * the composition-root code path. Unlike readCredentialSourceFd, this record
   * legitimately does not exist yet early in a run (before any checkpoint has
   * ever been written), so absence is distinguished from every other failure
   * via the SAME {ok,exists} split fdBoundRecordExists already uses elsewhere
   * in this file: `{ok:true,exists:false}` on a genuine ENOENT at either the
   * lstat or the open call, `{ok:false,reason}` on any other failure,
   * `{ok:true,exists:true,text}` on success -- the caller still owns
   * JSON.parse and every record-shape/schema check, exactly as before this
   * fix; this function's only job is a hardened, identity-verified read of the
   * raw bytes.
   * @returns {{ok:true,exists:false}|{ok:true,exists:true,text:string}|{ok:false,reason:string}}
   */
  function readCredentialAbsenceCheckpointsFd(checkpointPath) {
    let initialLstat;
    try {
      initialLstat = fs.lstatSync(checkpointPath, { bigint: true });
    } catch (err) {
      if (err && err.code === 'ENOENT') return { ok: true, exists: false };
      return { ok: false, reason: 'EVIDENCE_READ_FAILED' };
    }
    if (initialLstat.isSymbolicLink()) return { ok: false, reason: 'EVIDENCE_SYMLINK_REJECTED' };
    let initialWindowsAcl;
    if (process.platform === 'win32') {
      initialWindowsAcl = windowsPrivateDirectoryAcl(path.dirname(checkpointPath), { mode: 'validate' });
      if (!initialWindowsAcl || initialWindowsAcl.ok !== true) {
        return { ok: false, reason: 'EVIDENCE_DIR_INSECURE' };
      }
    }

    let fd;
    try {
      fd = fs.openSync(checkpointPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    } catch (err) {
      if (err && err.code === 'ENOENT') return { ok: true, exists: false };
      if (err && err.code === 'ELOOP') return { ok: false, reason: 'EVIDENCE_SYMLINK_REJECTED' };
      return { ok: false, reason: 'EVIDENCE_READ_FAILED' };
    }
    try {
      const st = fs.fstatSync(fd, { bigint: true });
      if (!st.isFile()) return { ok: false, reason: 'EVIDENCE_NOT_REGULAR_FILE' };
      if (typeof process.getuid === 'function' && st.uid !== BigInt(process.getuid())) {
        return { ok: false, reason: 'EVIDENCE_OWNER_MISMATCH' };
      }
      if (process.platform !== 'win32' && (st.mode & 0o777n) !== 0o600n) {
        return { ok: false, reason: 'EVIDENCE_FILE_MODE_INVALID' };
      }
      if (st.nlink !== 1n) {
        return { ok: false, reason: 'EVIDENCE_NLINK_INVALID' };
      }
      if (st.dev !== initialLstat.dev || st.ino !== initialLstat.ino) {
        return { ok: false, reason: 'EVIDENCE_IDENTITY_MISMATCH' }; // swapped between the pre-open lstat and the fd's own fstat.
      }
      if (st.size > BigInt(CREDENTIAL_ABSENCE_CHECKPOINTS_MAX_BYTES)) return { ok: false, reason: 'EVIDENCE_OVERSIZED' };
      const size = Number(st.size);
      const buf = Buffer.alloc(size);
      let offset = 0;
      while (offset < buf.length) {
        const bytesRead = fs.readSync(fd, buf, offset, buf.length - offset, null);
        if (bytesRead <= 0) break;
        offset += bytesRead;
      }
      if (offset !== size) return { ok: false, reason: 'EVIDENCE_SHORT_READ' };

      const stAfter = fs.fstatSync(fd, { bigint: true });
      if (stAfter.dev !== st.dev || stAfter.ino !== st.ino || stAfter.mode !== st.mode || stAfter.nlink !== st.nlink || stAfter.size !== st.size) {
        return { ok: false, reason: 'EVIDENCE_IDENTITY_MISMATCH' }; // changed identity/metadata DURING the read.
      }

      let text;
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
      } catch (err) {
        return { ok: false, reason: 'EVIDENCE_INVALID_UTF8' };
      }

      let finalLstat;
      try {
        finalLstat = fs.lstatSync(checkpointPath, { bigint: true });
      } catch (err) {
        return { ok: false, reason: 'EVIDENCE_IDENTITY_MISMATCH' };
      }
      if (finalLstat.isSymbolicLink() || finalLstat.dev !== initialLstat.dev || finalLstat.ino !== initialLstat.ino) {
        return { ok: false, reason: 'EVIDENCE_IDENTITY_MISMATCH' }; // the PATH itself was swapped during the operation.
      }
      if (process.platform === 'win32') {
        const finalWindowsAcl = windowsPrivateDirectoryAcl(path.dirname(checkpointPath), { mode: 'validate' });
        if (!finalWindowsAcl || finalWindowsAcl.ok !== true || !windowsAclSnapshotsEqual(initialWindowsAcl, finalWindowsAcl)) {
          return { ok: false, reason: 'EVIDENCE_DIR_CHANGED_DURING_READ' };
        }
      }

      return { ok: true, exists: true, text };
    } finally {
      try { fs.closeSync(fd); } catch (err) { /* best-effort close */ }
    }
  }

  return Object.freeze({ credentialAbsenceCheckpointsPath, publishCredentialAbsenceCheckpoint, readCredentialAbsenceCheckpointsFd });
}

module.exports = Object.freeze({ createCredentialEvidenceStore });
