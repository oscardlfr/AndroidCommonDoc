'use strict';

function createCredentialRunSupport({
  fs,
  path,
  isTestCapability,
}) {
  /**
   * Broker (PLAN.md ~L1124/1126): depends only on `secretMatcher` (accepted for
   * correct construction-order wiring -- CheckpointAuthority owns all scanning
   * and calls back into this broker only to `poison()` it). `canBind()` is the
   * single gate `bindConnection` consults: true only while `status==='OPEN'`.
   * `POISONED`/`ZEROED` are both terminal per PLAN.md's own language -- no
   * un-poison/recovery path exists at all: once POISONED, `canBind()` never
   * again returns true for this broker instance. `zero()` (Block 3) is a
   * ONE-WAY forward transition used only by `publishAndFinalize`'s own
   * teardown -- POISONED is unreachable at that point anyway, since
   * `checkpointAuthority.isPoisoned()` is checked first and blocks a poisoned
   * run from ever reaching FINALIZING.
   */
  function createBroker({ secretMatcher }) {
    void secretMatcher;
    let status = 'OPEN'; // 'OPEN' | 'POISONED' | 'ZEROED'
    function canBind() { return status === 'OPEN'; }
    function poison() { if (status === 'OPEN') status = 'POISONED'; }
    // Block 3's teardown: unconditionally forces ZEROED (idempotent -- safe to
    // call again on a stuck-FINALIZING retry; PUBLICATION_INVALID/POISONED are
    // unreachable at teardown time anyway, since evidenceInvalid is checked
    // first and blocks reaching FINALIZING at all once poisoned).
    function zero() { status = 'ZEROED'; }
    return { canBind, poison, zero, status: () => status };
  }

  /**
   * CheckpointAuthority (PLAN.md ~L1130/1132): depends on `secretMatcher`,
   * `captureRegistry`, `isolationProvider`, `sealHandle` (and this block's own
   * addition, `runId`, needed to call `withValidatedReadView`). `bindAttestor`
   * returns a closure permanently bound to `{connectionId,role,ordinal}` --
   * every call performs a FULL walk: the entire CaptureRegistry history (read
   * via the module-private `captureRegistryInternals` WeakMap -- Block 1's own
   * forward-scaffolding, consumed here for the first time) plus the sealed
   * root's config.toml (read via `isolationProvider.withValidatedReadView`,
   * never a raw path). `EVIDENCE_INCOMPLETE_OVERFLOW` is checked FIRST,
   * unconditionally, before any scan even runs (PLAN.md: "no public
   * 'nothing to scan' shortcut anywhere"). A `clean:false` result or an
   * overflow both permanently poison (first reason sticks; PLAN.md's
   * permanence -- never overwritten by a later, different one) and notify the
   * broker.
   */
  /**
   * CORRECTION ROUND Section B / HARD NO-GO RESPONSE Block C: recursively
   * lists every FILE under `dir` (never following symlinks --
   * Dirent.isDirectory()/isFile() reflect the symlink's OWN type, false for
   * both, so a symlinked entry is silently skipped rather than followed).
   * Returns `{ok,files}` -- `ok:false` means enumeration itself failed
   * (unreadable directory, permission error, or a nested subdirectory that
   * failed to enumerate), distinguishable from `ok:true` genuine emptiness.
   * The caller (scanSealedRoot) must treat `ok:false` as a scan failure (fail
   * closed to dirty), never silently "nothing here, therefore clean" -- a real
   * secret sitting in a directory that fails to enumerate must never be
   * reported clean just because it was invisible to this call.
   */
  function listFilesRecursiveSafe(dir) {
    const results = [];
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      return { ok: false, files: results };
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const nested = listFilesRecursiveSafe(full);
        for (const f of nested.files) results.push(f);
        if (!nested.ok) return { ok: false, files: results };
      } else if (entry.isFile()) {
        results.push(full);
      }
    }
    return { ok: true, files: results };
  }

  /**
   * Recorder (PLAN.md ~L1124/1126): depends only on `checkpointAuthority`.
   * Owns roster/ordinal-contiguity classification and the per-role bound-count
   * ledger. `classify` is READ-ONLY (never mutates the ledger) so
   * `bindConnection` can check-then-commit atomically -- `commit` is only ever
   * called AFTER `broker.canBind()` has ALSO passed, so a broker-rejected bind
   * can never leave a phantom recorder-side reservation.
   */
  function createRecorder({ expectedRoster }) {
    const boundCountByRole = new Map();

    function classify(role, ordinal) {
      const rosterEntriesForRole = expectedRoster.filter((entry) => entry.role === role);
      if (rosterEntriesForRole.length === 0) return 'ROLE_NOT_IN_ROSTER';
      const alreadyBound = boundCountByRole.get(role) || 0;
      if (ordinal < alreadyBound) return 'ORDINAL_DUPLICATE';
      if (ordinal > alreadyBound) return 'ORDINAL_NOT_CONTIGUOUS';
      if (alreadyBound >= rosterEntriesForRole.length) return 'ORDINAL_NOT_CONTIGUOUS'; // contiguous numerically, but exceeds this role's own declared roster count.
      return null;
    }

    function commit(role) {
      boundCountByRole.set(role, (boundCountByRole.get(role) || 0) + 1);
    }

    return { classify, commit };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // WP3 item C3 (Block 3 of 3): publishAndFinalize's real Publisher/
  // finalization state machine and overflow/ConnectionStopAuthority
  // coordination. PLAN.md ~L1136-1153. Deliberately OUT of scope in this block
  // (Block 4): spawnWithIntent, cleanup/retirement/quarantine.
  //
  // "leases" (PLAN.md's finalization-diagram term, undefined in this section):
  // a lease is held by each currently-bound (not yet close()d) connection from
  // THIS composition root -- bindConnection mints one, close() releases it,
  // "leases>0" means the active-lease Set is non-empty. Grounded in
  // wp3-item-c3-design-r5.md's close() prose ("...then releases the LEASE")
  // and its own C3-BROKER-B12 test ID ("...succeeds once
  // activeLeaseCount()===0") -- a real, named method in the design history, not
  // merely inferred prose.
  //
  // Path derivation (PLAN.md ~L1151: `<wave-dir>/conformance-evidence/<mode>/
  // <run_id>/manifest.json`): `<wave-dir>` resolves from `sealHandle
  // .intendedPath`'s own PARENT directory -- Block 1's `intendedPath` is
  // ALWAYS a caller-supplied, test-tmp-rooted path in every fixture this file's
  // own test suite builds, so deriving the wave-dir from it is fully hermetic
  // (never a hardcoded location under this actual repo) without requiring a
  // new mandatory constructor dependency the existing test fixture helper
  // (`validAuthoritiesDeps`, test-owned, unmodifiable) does not supply. This
  // file performs ZERO filesystem I/O of its own against the derived path (no
  // mkdir, no write) -- it is a pure string handed to the injected
  // publisher/validator (both C4-owned fakes per the C3/C4 boundary, in every
  // test in this suite), so there is no real-project-tree risk even though the
  // STRUCTURE mirrors PLAN's own frozen formula exactly.
  // ═══════════════════════════════════════════════════════════════════════════

  /** Block 3's teardown reads/clears a matcher's registered values via the module-private secretMatcherInternals WeakMap (Block 1's own SecretMatcher never exposes this publicly). */
  function isToctouSwapFaultActive(phase) {
    return isTestCapability() && process.env.RUNTIME_BRIDGE_CODEX_FAULT_TOCTOU_SWAP === phase;
  }

  // C3-CLEANUP-E15: a distinct, narrower gate (not a TOCTOU swap) -- simulates
  // a crash immediately after the rename+fsync barrier durably succeeds but
  // before cleanup-complete/v1 ever publishes, so a test can prove
  // reapTombstonedRoot's own RENAMED_WITHOUT_COMPLETE quarantine path (PLAN.md
  // ~L1178) correctly detects and handles exactly that on-disk state on a
  // later, separate recovery pass.
  function isCleanupCrashFaultActive(phase) {
    return isTestCapability() && process.env.RUNTIME_BRIDGE_CODEX_FAULT_CLEANUP_CRASH === phase;
  }

  return Object.freeze({ createBroker, listFilesRecursiveSafe, createRecorder, isToctouSwapFaultActive, isCleanupCrashFaultActive });
}

module.exports = Object.freeze({ createCredentialRunSupport });
