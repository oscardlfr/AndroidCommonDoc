'use strict';

function createCredentialCheckpointAuthority({
  fs,
  computeRootId,
  captureRegistrySnapshot,
  captureRegistryOverflowed,
  publishCredentialAbsenceCheckpoint,
  listFilesRecursiveSafe,
  correlatedCheckpointName,
}) {
  function createCheckpointAuthority({ secretMatcher, captureRegistry, isolationProvider, sealHandle, runId, repoId, mode, expectedRoster, rootRoster }) {
    let poisoned = false;
    let poisonReason = null;
    const onPoisonListeners = [];
    const checkpointState = {
      checkpoints: [],
      root_ids: undefined, // unused; kept out of the object literal shape below intentionally.
      rootIds: sealHandle && typeof sealHandle.instanceId === 'string' ? [computeRootId(sealHandle.instanceId)] : [],
      // THIRD HARD NO-GO RESPONSE Block B: expectedRoster (for per-member
      // completeness accounting) and everHadWriteFailure (permanent poison on
      // any durable-write failure) -- see publishCredentialAbsenceCheckpoint.
      expectedRoster: Array.isArray(expectedRoster) ? expectedRoster : [],
      everHadWriteFailure: false,
      // CORRECTION PASS Block E: true until a corrective re-publish's OWN
      // directory-barrier is proven NOT durable (see
      // correctivelyRepublishAsIncomplete's own docblock and its call site in
      // publishCredentialAbsenceCheckpoint) -- vacuously true while no
      // corrective re-publish was ever needed, mirroring everHadWriteFailure's
      // own "starts at the healthy value, flips only on a genuine observed
      // failure" convention.
      correctiveRepublishDurabilityConfirmed: true,
    };

    function onPoison(listener) { onPoisonListeners.push(listener); }

    function notifyPoison(reason) {
      if (poisoned) return; // permanence: the FIRST reason sticks, never overwritten.
      poisoned = true;
      poisonReason = reason;
      for (const listener of onPoisonListeners) listener(reason);
    }

    function notifyOverflow() { notifyPoison('EVIDENCE_INCOMPLETE_OVERFLOW'); }

    function publishDurableCheckpoint(checkpointName, ok) {
      if (typeof repoId !== 'string' || repoId.length === 0) return true; // no stable key to publish under -- best-effort only, never blocks the in-memory attestation (pre-existing narrow carve-out, unrelated to Block B's write-failure fix below).
      const internals = captureRegistrySnapshot(captureRegistry);
      return publishCredentialAbsenceCheckpoint(checkpointState, {
        repoId, runId, mode,
        checkpointEntry: {
          name: checkpointName,
          at: new Date().toISOString(),
          roots_scanned: checkpointState.rootIds.length,
          captures_scanned: internals ? internals.entries.length : 0,
          ok,
        },
      });
    }

    function scanCaptureRegistryFullHistory() {
      const internals = captureRegistrySnapshot(captureRegistry);
      // CORRECTION ROUND Section B (fail-closed default): a missing internals
      // entry is never "nothing to scan, therefore clean" -- captureRegistry is
      // always a real, freshly-constructed object at composition-root
      // construction time, so this branch is a genuine anomaly, not a verified-
      // empty state.
      if (!internals) return { clean: false };
      for (const entry of internals.entries) {
        const result = secretMatcher.scanBytes(entry);
        if (!result.ok || result.clean === false) return { clean: false };
      }
      return { clean: true };
    }

    /**
     * CORRECTION ROUND Section B (FOLLOW-UP dispatch: rewired onto withValidatedRoot): scans
     * config.toml AND every file under EVERY topology directory (all 8:
     * root/home/codexHome/tmp/xdgCache/xdgConfig/xdgState/cwd -- the same set finalIdentitySnapshot
     * already enumerates), never config.toml alone. Any read error anywhere in the scan fails closed
     * as dirty (never an uncaught exception, never a silent "assumed clean"). Routes through
     * isolationProvider.withValidatedRoot(sealHandle,...) -- C3's own internal root authority,
     * credited via sealHandle's own WeakMap-verified provenance -- rather than self-minting a
     * capability and going through the external readViewAuthority-gated withValidatedReadView;
     * CheckpointAuthority already legitimately holds sealHandle from its own construction-time
     * dependency and never needs an external capability just to scan its own sealed root.
     */
    function scanSealedRoot(role) {
      if (!sealHandle || !isolationProvider || typeof isolationProvider.withValidatedRoot !== 'function') {
        // Fail closed (Section B6): "nothing to scan" must be positively
        // verified, never assumed -- a missing sealHandle/isolationProvider is
        // a misconfiguration, not verified-empty evidence.
        return { clean: false };
      }
      const viewResult = isolationProvider.withValidatedRoot(
        sealHandle,
        { runId, role },
        (creditedReader) => {
          try {
            const configBytes = fs.readFileSync(creditedReader.configPath);
            const configScan = secretMatcher.scanBytes(configBytes);
            if (!configScan.ok || configScan.clean === false) return { ok: true, clean: false };
            for (const layer of Object.keys(creditedReader.topologyPaths || {})) {
              const layerDir = creditedReader.topologyPaths[layer];
              const enumResult = listFilesRecursiveSafe(layerDir);
              // HARD NO-GO RESPONSE Block C: a failed enumeration must never be
              // silently treated as "nothing here, therefore clean" -- fail
              // closed exactly like a read error anywhere else in this scan.
              if (!enumResult.ok) return { ok: true, clean: false };
              for (const file of enumResult.files) {
                const bytes = fs.readFileSync(file);
                const scan = secretMatcher.scanBytes(bytes);
                if (!scan.ok || scan.clean === false) return { ok: true, clean: false };
              }
            }
            return { ok: true, clean: true };
          } catch (err) {
            // Fail closed: a read error ANYWHERE during the scan (a file
            // removed underneath, a permission error, whatever) is never an
            // uncaught exception and never treated as clean.
            return { ok: true, clean: false };
          }
        },
      );
      // Fail closed: anything other than a PROVEN clean read (ok:true AND
      // clean:true) is treated as NOT clean -- an unconfirmable read (e.g. a
      // REBIND_DURING_USE mid-scan) is never silently assumed clean just
      // because it wasn't a positive secret match.
      if (!viewResult || viewResult.ok !== true || viewResult.clean !== true) return { clean: false };
      return { clean: true };
    }

    function fullWalk(role) {
      if (scanCaptureRegistryFullHistory().clean === false) return { clean: false };
      if (scanSealedRoot(role).clean === false) return { clean: false };
      return { clean: true };
    }

    // HARD NO-GO RESPONSE Finding 4: stateless overflow detection, extracted so
    // BOTH performCheckpoint (per-member checkpoints) and
    // attestSupervisorTeardown (run-wide teardown checkpoints) can each react
    // to the SAME overflow condition. Both now write into the SAME
    // credential-absence-checkpoints/v1 array via publishDurableCheckpoint --
    // performCheckpoint under an @role:ordinal-correlated name, and
    // attestSupervisorTeardown under the reserved, non-correlated
    // 'teardown:pre'/'teardown:post' names (TEARDOWN_CHECKPOINT_NAMES).
    // computeCredentialEvidenceComplete splits teardown entries out BEFORE its
    // per-member parsing ever sees them, so the two families coexist in one
    // array without corrupting each other's completeness accounting.
    function isOverflowed() {
      return captureRegistryOverflowed(captureRegistry);
    }

    /** Shared by bindAttestor's returned closure AND attestPreBind (below): overflow checked first, unconditionally, then a genuine full walk; publishes the durable checkpoint record either way. */
    function performCheckpoint(checkpointName) {
      if (isOverflowed()) {
        notifyPoison('EVIDENCE_INCOMPLETE_OVERFLOW');
        publishDurableCheckpoint(checkpointName, false);
        return { ok: false, reason: 'EVIDENCE_INCOMPLETE_OVERFLOW' };
      }
      return null; // caller still needs the role-scoped fullWalk -- see call sites.
    }

    /**
     * HARD NO-GO RESPONSE Finding 4: role-agnostic full walk for the
     * supervisor-wide teardown checkpoint -- scanCaptureRegistryFullHistory is
     * already role-agnostic (scans the whole registry regardless of role);
     * this additionally walks EVERY role in rootRoster's own sealed root
     * (never just one connection's), since teardown must prove the ENTIRE
     * run's evidence surface is clean, not one member's.
     */
    function supervisorWideFullWalk() {
      if (scanCaptureRegistryFullHistory().clean === false) return { clean: false };
      for (const role of (Array.isArray(rootRoster) ? rootRoster : [])) {
        if (scanSealedRoot(role).clean === false) return { clean: false };
      }
      return { clean: true };
    }

    /**
     * HARD NO-GO RESPONSE Finding 4: pre/post supervisor-wide teardown
     * attestation -- called by attemptTeardown (below), bracketing broker.zero()
     * specifically (never the final secretMatcher/captureRegistry clear+
     * reverify tail, since a scan AFTER that clear would be structurally
     * vacuous -- secretMatcher would have nothing registered left to match
     * disk content against). A genuine scan every time, per PLAN.md ~L1134's
     * "no public 'nothing to scan' shortcut anywhere" -- never a purely
     * structural/bookkeeping-only entry. CORRECTION ROUND: folded into the
     * SAME credential-absence-checkpoints/v1 record every other checkpoint
     * uses (via publishDurableCheckpoint, under the 'teardown:pre'/
     * 'teardown:post' names -- see TEARDOWN_CHECKPOINT_NAMES), never a
     * separate schema; a write failure permanently blocks finalization via
     * the SAME checkpointState.everHadWriteFailure flag every other
     * checkpoint uses.
     */
    function attestSupervisorTeardown(phase) {
      if (isOverflowed()) {
        notifyPoison('EVIDENCE_INCOMPLETE_OVERFLOW');
        publishDurableCheckpoint('teardown:' + phase, false);
        return { ok: false, reason: 'EVIDENCE_INCOMPLETE_OVERFLOW' };
      }
      if (!supervisorWideFullWalk().clean) {
        notifyPoison('LEAK_DETECTED');
        publishDurableCheckpoint('teardown:' + phase, false);
        return { ok: false, reason: 'LEAK_DETECTED' };
      }
      if (!publishDurableCheckpoint('teardown:' + phase, true)) {
        return { ok: false, reason: 'CHECKPOINT_WRITE_FAILED' };
      }
      return { ok: true };
    }

    /** @returns {function(string,string): ({ok:true,attestation:object}|{ok:false,reason:string})} */
    function bindAttestor({ connectionId, role, ordinal }) {
      return function attest(phase, checkpointName) {
        const overflowResult = performCheckpoint(checkpointName || phase);
        if (overflowResult) return overflowResult;
        if (!fullWalk(role).clean) {
          notifyPoison('LEAK_DETECTED');
          publishDurableCheckpoint(checkpointName || phase, false);
          return { ok: false, reason: 'LEAK_DETECTED' };
        }
        // HARD NO-GO RESPONSE Block B: a durable-write failure must invalidate
        // THIS checkpoint's own attestation -- never silently report ok:true
        // for evidence that was never actually recorded durably.
        if (!publishDurableCheckpoint(checkpointName || phase, true)) {
          return { ok: false, reason: 'CHECKPOINT_WRITE_FAILED' };
        }
        return { ok: true, attestation: { connectionId, role, ordinal, phase, checkpointName, checkedAt: new Date().toISOString() } };
      };
    }

    /**
     * CORRECTION ROUND Section B: binding itself is a genuine checkpoint --
     * "no path may ever return 'nothing to scan, therefore clean' as an
     * unproven default" applies to bind time too, not only to
     * refreshProvider/checkout. Called by bindConnection BEFORE the roster
     * reservation is committed, so a dirty result rejects cleanly without ever
     * leaving a phantom recorder-side reservation (Block 2's atomicity
     * guarantee extended to this new check).
     */
    function attestPreBind(role, ordinal) {
      const checkpointName = correlatedCheckpointName('bind', role, ordinal);
      const overflowResult = performCheckpoint(checkpointName);
      if (overflowResult) return overflowResult;
      if (!fullWalk(role).clean) {
        notifyPoison('LEAK_DETECTED');
        publishDurableCheckpoint(checkpointName, false);
        return { ok: false, reason: 'LEAK_DETECTED' };
      }
      if (!publishDurableCheckpoint(checkpointName, true)) {
        return { ok: false, reason: 'CHECKPOINT_WRITE_FAILED' };
      }
      return { ok: true };
    }

    return {
      bindAttestor, onPoison, notifyOverflow, attestPreBind,
      // HARD NO-GO RESPONSE Block A: a generic, arbitrary-reason poison entry
      // point -- used by bindConnection's own same-account-enforcement check
      // (ACCOUNT_MISMATCH), which is a real evidence-relevant poisoning event
      // exactly like LEAK_DETECTED/EVIDENCE_INCOMPLETE_OVERFLOW and must route
      // through the SAME central mechanism (permanence, isPoisoned()/
      // poisonReason() reflect it, the stopAll fanout fires) rather than a
      // parallel, disconnected broker.poison() call.
      notifyPoison,
      isPoisoned: () => poisoned, poisonReason: () => poisonReason,
      // CORRECTION ROUND Block B Group 1: exposes the existing in-memory
      // checkpointState.everHadWriteFailure flag -- checked directly and
      // unconditionally by publishAndFinalize (mirroring isPoisoned()'s own
      // shape exactly) so a historical checkpoint-write failure permanently
      // blocks finalization, never just the writer's own .complete field
      // (which the reader has always deliberately distrusted).
      hadWriteFailure: () => checkpointState.everHadWriteFailure,
      // CORRECTION PASS Block E: exposes the existing in-memory
      // checkpointState.correctiveRepublishDurabilityConfirmed flag, mirroring
      // hadWriteFailure()'s own shape exactly -- surfaced through
      // __testOnlyInspectFinalizationState below.
      correctiveRepublishDurabilityConfirmed: () => checkpointState.correctiveRepublishDurabilityConfirmed,
      // HARD NO-GO RESPONSE Finding 4: the supervisor-wide teardown attestation
      // -- called exclusively by attemptTeardown (createRunAuthorities, below).
      attestSupervisorTeardown,
    };
  }

  return Object.freeze({ createCheckpointAuthority });
}

module.exports = Object.freeze({ createCredentialCheckpointAuthority });
