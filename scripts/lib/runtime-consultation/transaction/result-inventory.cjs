'use strict';

// Extracted from runtime-consultation.cjs. This focused factory has no
// upward facade import; every authority, clock and durability seam is injected.
function createResultInventory(deps) {
  const {
    CONFLICT_V1_FIELDS,
    CliError,
    MAX_ENUM_HARD_CAP,
    MAX_ENUM_KEPT_ENTRIES,
    assertArtifactMatchesReceipt,
    assertClosedShape,
    canonicalJSONStringify,
    fs,
    insertBoundedCandidate,
    isHexId,
    nowIso,
    path,
    publishNoClobber,
    validateConflictV1,
  } = deps;


  // ─────────────────────────────────────────────────────────────────────────────
  // `cancel` (PLAN.md ~L771) -- under lock, publish cancel.json (+ conflict diagnostic)
  // ─────────────────────────────────────────────────────────────────────────────

  const CANCEL_REASON_ENUM = ['expired', 'explicit', 'invalid-takeover-exhaustion', 'conflict'];

  /**
   * Section 8: ENOENT (the results/ directory genuinely does not exist yet) is
   * harmlessly empty; EACCES/EIO/ENOTDIR/any other enumeration failure STOPs -- it is
   * never silently folded into "no results", which would mask a real I/O problem as
   * a legitimate empty-transaction state.
   *
   * Codex gap #2 / NO-GO round 2 blocker 4 (PLAN.md ~L698): `MAX_ENUM_HARD_CAP`/
   * `MAX_ENUM_KEPT_ENTRIES` bound this scan via a TRUE streaming `opendirSync`/
   * `readSync` cutoff -- a directory with an implausible number of raw entries fails
   * closed DURABILITY_UNPROVEN WITHOUT ever materializing more than
   * `MAX_ENUM_HARD_CAP` dirents at once (the prior `readdirSync()` fully materialized
   * the directory into memory BEFORE checking its length, which bounded downstream
   * processing but not the scan/allocation itself), and the sorted `.json` candidate
   * set kept is capped so a caller never processes an unbounded list.
   */
  function listResultFiles(txnDir) {
    const resultsDir = path.join(txnDir, 'results');
    let dirHandle;
    try {
      dirHandle = fs.opendirSync(resultsDir);
    } catch (err) {
      if (err && err.code === 'ENOENT') return [];
      throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'results directory could not be enumerated (' + (err && err.code) + '): ' + resultsDir);
    }
    const kept = []; // ascending-sorted [name, null] pairs, bounded to MAX_ENUM_KEPT_ENTRIES
    let totalSeen = 0;
    try {
      let entry = dirHandle.readSync();
      while (entry !== null) {
        totalSeen += 1;
        if (totalSeen > MAX_ENUM_HARD_CAP) {
          throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'results directory exceeds the max scanned-entry bound (>' + MAX_ENUM_HARD_CAP + '): ' + resultsDir);
        }
        if (entry.name.endsWith('.json')) insertBoundedCandidate(kept, entry.name, null, MAX_ENUM_KEPT_ENTRIES);
        entry = dirHandle.readSync();
      }
    } finally {
      try { dirHandle.closeSync(); } catch (e) { /* best-effort close */ }
    }
    return kept.map(([name]) => name);
  }

  /**
   * Codex NO-GO round 15: confines a subdirectory the caller is ABOUT TO join
   * an attempt-pair/attempt-id filename onto. Deliberately tolerates absence
   * (returns without error) rather than requiring pre-existence like
   * cmdPublishBlob's own per-component symlink walk (a different precondition
   * -- that walk assumes a fully-materialized staging root; this one is called
   * for subdirectories, like `conflict/`, that are lazily created by whichever
   * publishNoClobber call first targets them). Rejects an EXISTING symlink
   * outright.
   *
   * Codex NO-GO round 16 (P0): previously tolerated ANY lstat error as
   * "absent", not only ENOENT -- an EACCES or EIO (a real, reportable
   * problem) would have been silently treated the same as "doesn't exist
   * yet", masking a genuine failure instead of propagating it.
   */
  function assertConfinedSubdirectory(txnDir, subdirName) {
    const candidate = path.join(txnDir, subdirName);
    let lst;
    try {
      lst = fs.lstatSync(candidate);
    } catch (err) {
      if (err && err.code === 'ENOENT') return;
      throw new CliError('INVALID', 'DURABILITY_UNPROVEN', subdirName + ' could not be stat-verified (' + (err && err.code) + '): ' + candidate);
    }
    if (lst.isSymbolicLink()) {
      throw new CliError('INVALID', 'SECURITY_INVALID', subdirName + ' is a symlink (rejected): ' + candidate);
    }
    if (!lst.isDirectory()) {
      throw new CliError('INVALID', 'SCHEMA_INVALID', subdirName + ' is not a directory: ' + candidate);
    }
  }

  /**
   * Codex NO-GO round 15: this function used to swallow EVERY error from BOTH
   * of its own operations unconditionally (`catch (err) { return; }` /
   * `catch (err) { /* diagnostic only *\/ }`) -- a genuine SECURITY_INVALID (a
   * planted symlink at the conflict-diagnostic path) or DURABILITY_UNPROVEN
   * would have been completely invisible, with cmdCancel still reporting
   * overall SUCCESS. `listResultFiles` itself already correctly distinguishes
   * ENOENT (returns `[]`) from a genuine enumeration failure (throws
   * DURABILITY_UNPROVEN) -- the removed try/catch around it was wrongly
   * swallowing that already-correct throw too.
   *
   * Codex NO-GO round 16 (P0), on top of round 15's own fix: `results/` itself
   * (read from) was never confinement-checked, only `conflict/` (written to)
   * -- `fs.opendirSync` follows a symlink at `results/` transparently, same as
   * any other directory open. The names `listResultFiles` returns were never
   * validated as genuine hex attempt IDs before being joined into a path/
   * schema field. Tolerating a race-lost AUTHORITY_INVALID (a different
   * diagnostic already exists for this exact pair) never validated that
   * EXISTING, WINNING diagnostic at all -- an attacker-plantable
   * schema-invalid file at that exact path would have been silently accepted
   * as "good enough, someone else already wrote it".
   */
  function writeConflictDiagnosticIfApplicable(txnDir) {
    assertConfinedSubdirectory(txnDir, 'results');
    const entries = listResultFiles(txnDir);
    if (entries.length < 2) return;
    const a = path.basename(entries[0], '.json');
    const b = path.basename(entries[1], '.json');
    if (!isHexId(a) || !isHexId(b)) {
      throw new CliError('INVALID', 'SCHEMA_INVALID', 'results/ entry name is not a well-formed attempt_id: ' + txnDir);
    }
    const conflictObj = { schema: 'coordination/conflict/v1', attempt_id: a, other_attempt_id: b, detected_at: nowIso() };
    assertClosedShape(conflictObj, CONFLICT_V1_FIELDS);
    const conflictBytes = Buffer.from(canonicalJSONStringify(conflictObj), 'utf8');
    assertConfinedSubdirectory(txnDir, 'conflict');
    const conflictPath = path.join(txnDir, 'conflict', a + '-' + b + '.json');
    let receipt;
    try {
      receipt = publishNoClobber(conflictPath, conflictBytes, { allowIdenticalIdempotent: true });
    } catch (err) {
      // A DIFFERENT diagnostic already durably exists for this exact
      // attempt-pair (a race loss allowIdenticalIdempotent did not accept as
      // byte-identical) -- diagnostic only, and whichever writer landed first
      // is definitive; tolerated, but ONLY once that existing, WINNING
      // diagnostic is itself fully re-validated (fd-bound durable + closed
      // shape), never blindly trusted merely because "some file already
      // exists at this path". Any OTHER failure (SECURITY_INVALID,
      // DURABILITY_UNPROVEN) is a real problem and must propagate.
      //
      // Codex NO-GO round 17 (P0): validateConflictV1 proves SHAPE only
      // (schema/field-types) -- it never confirmed the existing diagnostic's
      // OWN attempt_id/other_attempt_id equal THIS invocation's specific a/b
      // pair, nor that they are in the expected order. A durable, well-formed
      // conflict/v1 diagnostic belonging to a COMPLETELY DIFFERENT attempt pair
      // (e.g. a stray left by an unrelated bug, or planted) would previously
      // have been silently accepted as "good enough". conflictPath's own
      // filename already encodes (a, b); the CONTENT must match it exactly.
      if (err instanceof CliError && err.detailCode === 'AUTHORITY_INVALID') {
        const existing = validateConflictV1(conflictPath);
        if (existing.attempt_id !== a || existing.other_attempt_id !== b) {
          throw new CliError('INVALID', 'SECURITY_INVALID', 'existing conflict diagnostic at ' + conflictPath + ' does not correlate with the expected attempt pair (' + a + ', ' + b + ')');
        }
        return;
      }
      throw err;
    }
    // Re-confirm conflict/ itself is still a genuine, non-symlinked directory
    // -- publishNoClobber's own internal mkdirSync(dir,{recursive:true}) does
    // not reject a symlink planted between the check above and this write, so
    // this closes as much of that window as re-verification after the fact
    // can (the same "shrink, don't claim to eliminate" honesty this file
    // already applies to other TOCTOU windows it cannot fully close).
    assertConfinedSubdirectory(txnDir, 'conflict');
    assertArtifactMatchesReceipt(conflictPath, receipt, conflictBytes);
  }


  return { CANCEL_REASON_ENUM, listResultFiles, writeConflictDiagnosticIfApplicable };
}

module.exports = { createResultInventory };
