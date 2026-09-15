'use strict';

function createCredentialRunFinalization({
  path,
  credentialAbsenceCheckpointsPath,
  readCredentialAbsenceCheckpointsFd,
  hasExactKeys,
  CREDENTIAL_EVIDENCE_RECORD_KEYS_SORTED,
  isValidCheckpointEntry,
  parseCorrelatedCheckpointName,
  computeCredentialEvidenceComplete,
  computeRootId,
  isHexDigest64,
  clearSecretMatcherInternal,
  isSecretMatcherEmpty,
  clearCaptureRegistryInternal,
  isCaptureRegistryEmpty,
}) {
  function createRunFinalization({ runId, mode, expectedRoster, sealHandle, checkpointAuthority, publisher, manifestPath, isTeardownFaultActive, broker, secretMatcher, captureRegistry, activeConnectionCount }) {
    let finalizationState = 'OPEN';
    let terminalReason = null;
    let teardownPreConfirmed = false;

    /**
     * HARD NO-GO RESPONSE Block B: reads the durable credential-absence-
     * checkpoints/v1 record fresh off disk (CheckpointAuthority's own
     * authority, never composition-root in-memory state). FOURTH HARD NO-GO
     * RESPONSE fix (fail-open file-absence): a missing checkpoint file is no
     * longer an unconditional free pass -- it delegates to
     * computeCredentialEvidenceComplete([], expectedRoster), the SAME roster-
     * aware rule the non-empty-record path below uses, so "CheckpointAuthority
     * never engaged at all" is legitimately fine ONLY when expectedRoster is
     * itself empty (genuinely nothing was ever expected to happen); a non-
     * empty roster with zero durable evidence on disk is real incompleteness,
     * not a free pass just because the file was never created. THIRD HARD
     * NO-GO RESPONSE fix (confused-deputy) is preserved: never trusts the
     * record's own `.complete` flag at face value -- re-derives completeness
     * fresh from the `checkpoints` array itself (computeCredentialEvidenceComplete,
     * same function the writer itself uses). FOURTH HARD NO-GO RESPONSE adds:
     * schema (PLAN.md ~L554) and mode (~L555, `app-server|mcp`) are now
     * validated, and any checkpoint entry whose `.name` fails
     * parseCorrelatedCheckpointName is treated as a corrupted-record signal
     * (fail closed) rather than silently ignored. Returns `{complete}` on
     * success or `{complete:false, reason}` classified into a reason taxonomy
     * (documented on publishAndFinalize's own call site below) so callers/
     * tests can distinguish WHY evidence was rejected, not just THAT it was:
     * `EVIDENCE_SCHEMA_INVALID` (wrong/missing schema literal),
     * `EVIDENCE_MODE_INVALID` (mode not exactly `app-server`|`mcp`),
     * `EVIDENCE_RUN_ID_MISMATCH` (record belongs to a different run --
     * confused-deputy guard), `EVIDENCE_MALFORMED_ENTRY` (unparseable JSON,
     * non-object record, non-array checkpoints, or any single checkpoint
     * whose name does not match the `@role:ordinal` correlation shape), and
     * `EVIDENCE_INCOMPLETE` (structurally well-formed, but the required
     * sequence/cardinality is genuinely not yet satisfied). Any unexpected
     * read/parse exception is fail-closed to `EVIDENCE_MALFORMED_ENTRY`.
     */
    function isCredentialEvidenceComplete() {
      try {
        const p = credentialAbsenceCheckpointsPath(sealHandle.repoId, runId);
        const readResult = readCredentialAbsenceCheckpointsFd(p);
        if (!readResult.ok) return { complete: false, reason: readResult.reason || 'EVIDENCE_READ_FAILED' };
        if (!readResult.exists) {
          const complete = computeCredentialEvidenceComplete([], expectedRoster);
          return complete ? { complete: true } : { complete: false, reason: 'EVIDENCE_INCOMPLETE' };
        }
        const record = JSON.parse(readResult.text);
        if (!record || typeof record !== 'object' || Array.isArray(record)) return { complete: false, reason: 'EVIDENCE_MALFORMED_ENTRY' };
        // CORRECTION ROUND findings 3+5, bonus: the record's OWN top-level
        // shape must be exactly this closed 6-field set -- no extra/missing keys.
        if (!hasExactKeys(record, CREDENTIAL_EVIDENCE_RECORD_KEYS_SORTED)) return { complete: false, reason: 'EVIDENCE_MALFORMED_ENTRY' };
        if (record.schema !== 'coordination/credential-absence-checkpoints/v1') {
          return { complete: false, reason: 'EVIDENCE_SCHEMA_INVALID' };
        }
        if (record.mode !== 'app-server' && record.mode !== 'mcp') {
          return { complete: false, reason: 'EVIDENCE_MODE_INVALID' };
        }
        // CORRECTION ROUND findings 3+5, item 1: enum-validity above is a
        // DIFFERENT concern from equality against THIS run's own mode -- a
        // record whose mode is a valid enum member but belongs to a different
        // mode than this run's own must still be rejected.
        if (record.mode !== mode) return { complete: false, reason: 'EVIDENCE_MODE_MISMATCH' };
        if (record.run_id !== runId) return { complete: false, reason: 'EVIDENCE_RUN_ID_MISMATCH' }; // confused-deputy guard: never trust a record for a DIFFERENT run.
        // CORRECTION ROUND findings 3+5, item 2: root_ids was never validated
        // at all -- this implementation only ever writes a single root id
        // (checkpointState.rootIds's own initializer), so "full coverage" here
        // means an exact match to what THIS run's own sealHandle would produce.
        const expectedRootIds = [computeRootId(sealHandle.instanceId)];
        const rootIdsValid = Array.isArray(record.root_ids) && record.root_ids.every(isHexDigest64)
          && JSON.stringify(record.root_ids) === JSON.stringify(expectedRootIds);
        if (!rootIdsValid) return { complete: false, reason: 'EVIDENCE_ROOT_IDS_INVALID' };
        // CORRECTION ROUND findings 3+5, item 3: previously only `.name` was
        // validated -- now the FULL closed entry shape (at/captures_scanned/
        // name/ok/roots_scanned).
        const checkpointsValid = Array.isArray(record.checkpoints) && record.checkpoints.every(isValidCheckpointEntry);
        if (!checkpointsValid) return { complete: false, reason: 'EVIDENCE_MALFORMED_ENTRY' };
        const rederivedComplete = computeCredentialEvidenceComplete(record.checkpoints, expectedRoster);
        // CORRECTION ROUND findings 3+5, item 8 (mismatch-detection half of the
        // earlier write-failure-permanence finding): the writer's own stated
        // `.complete` field is still never TRUSTED at face value (confused-
        // deputy fix, unchanged) -- but a DISAGREEMENT between it and this
        // fresh re-derivation is now its own honest, fail-closed signal. A
        // legitimate record's own writer and this reader's re-derivation must
        // always agree; a mismatch indicates corruption, tampering, or a
        // genuine writer-side bug, never silently resolved by "trust the
        // re-derivation and move on".
        if (typeof record.complete !== 'boolean') return { complete: false, reason: 'EVIDENCE_MALFORMED_ENTRY' };
        if (record.complete !== rederivedComplete) return { complete: false, reason: 'EVIDENCE_COMPLETE_FLAG_MISMATCH' };
        return rederivedComplete ? { complete: true } : { complete: false, reason: 'EVIDENCE_INCOMPLETE' };
      } catch (err) {
        return { complete: false, reason: 'EVIDENCE_MALFORMED_ENTRY' };
      }
    }

    async function safePublish() {
      try {
        return await publisher.publish(manifestPath);
      } catch (err) {
        return 'POSSIBLY_PUBLISHED'; // an unconfirmable/throwing publish attempt is conservatively never CONFIRMED_BEFORE_WRITE.
      }
    }
    async function safeValidate() {
      try {
        return (await publisher.canonicalManifestValidator(manifestPath)) === true;
      } catch (err) {
        return false; // PLAN.md ~L1136: "validator fails/absent/ambiguous" -- all three collapse to false here.
      }
    }
    /**
     * PLAN.md ~L1146-1147: broker ZEROED, secretMatcher empty, captureRegistry
     * cleared, then RE-VERIFIED. Every step is idempotent so a stuck-FINALIZING
     * retry (after the fault seam below) can simply re-run the whole sequence
     * rather than needing to track which sub-step already completed.
     * HARD NO-GO RESPONSE Finding 4: pre/post supervisor-wide teardown
     * checkpoints bracket broker.zero() specifically -- both scans must run
     * WHILE secretMatcher/captureRegistry are still populated (a scan after the
     * clear below would be structurally vacuous, nothing left to match disk
     * content against), so the final clear+reverify tail stays the LAST step,
     * unchanged. CORRECTION PASS Block D item 1: a retry no longer re-fires
     * 'pre' at all once it was already durably recorded once for this run
     * (teardownPreConfirmed guard, below) -- the original "re-fires 'pre'
     * harmlessly" assumption was wrong, since a retry after a partial failure
     * would otherwise durably record a second 'teardown:pre' for the SAME
     * genuine attempt. 'post' is only ever written once, since a successful
     * call here leads straight to FINALIZED and no further attemptTeardown()
     * call is ever made for this run.
     */
    function attemptTeardown() {
      // CORRECTION PASS Block D item 1: guard against a retry re-emitting a
      // SECOND durable 'teardown:pre' -- once genuinely recorded once for
      // this run, a retry after a partial failure skips straight to
      // broker.zero() (itself idempotent, per this function's own existing
      // comment) rather than re-attesting 'pre' again.
      if (!teardownPreConfirmed) {
        const preCheckpoint = checkpointAuthority.attestSupervisorTeardown('pre');
        if (!preCheckpoint.ok) return { ok: false, reason: preCheckpoint.reason };
        teardownPreConfirmed = true;
      }
      broker.zero();
      if (isTeardownFaultActive('post-broker-zero')) {
        return { ok: false, reason: 'TEARDOWN_FAULT_INJECTED_POST_BROKER_ZERO' };
      }
      const postCheckpoint = checkpointAuthority.attestSupervisorTeardown('post');
      if (!postCheckpoint.ok) return { ok: false, reason: postCheckpoint.reason };
      clearSecretMatcherInternal(secretMatcher);
      clearCaptureRegistryInternal(captureRegistry);
      if (broker.status() !== 'ZEROED') return { ok: false, reason: 'TEARDOWN_BROKER_NOT_ZEROED' };
      if (!isSecretMatcherEmpty(secretMatcher)) return { ok: false, reason: 'TEARDOWN_SECRET_MATCHER_NOT_EMPTY' };
      if (!isCaptureRegistryEmpty(captureRegistry)) return { ok: false, reason: 'TEARDOWN_CAPTURE_REGISTRY_NOT_EMPTY' };
      return { ok: true };
    }

    /** PLAN.md ~L1126: single-lock-prevalidated, infallible-commit. Roster/ordinal classification (read-only) THEN broker.canBind() THEN commit -- synchronous, so no interleaving can ever occur between the checks and the commit below. */
    /**
     * PLAN.md ~L1136-1153: OPEN -> PUBLISHED_VALID -> FINALIZING -> FINALIZED,
     * with PUBLICATION_INVALID as a terminal branch off either OPEN or
     * PUBLISHED_VALID. Evidence-invalidation (overflow/leak) is checked FIRST,
     * unconditionally, ahead of any state-based logic -- "a run that ever
     * overflowed can never reach FINALIZED", regardless of what the canonical
     * validator later reports for an otherwise-plausible manifest. Each call
     * advances AT MOST the current state's own hop and returns immediately
     * EXCEPT the PUBLISHED_VALID->FINALIZING transition, which intentionally
     * falls through to attempt teardown in the SAME call (nothing meaningful
     * can happen in that specific gap) -- OPEN->PUBLISHED_VALID deliberately
     * does NOT also fall through, since a caller may legitimately bind a new
     * connection immediately after reaching PUBLISHED_VALID, before the next
     * publishAndFinalize call.
     */
    async function publishAndFinalize() {
      if (checkpointAuthority.isPoisoned()) {
        return { state: 'PUBLICATION_INVALID', reason: checkpointAuthority.poisonReason() };
      }
      // CORRECTION ROUND Block B Group 1: a historical checkpoint-write
      // failure must remain permanently fatal -- checked unconditionally
      // first, exactly like isPoisoned() above, so no later re-derivation
      // (however structurally complete the checkpoints array eventually
      // looks) can ever recompute this run back into a publishable state.
      // The in-memory flag is the sole, always-reliable signal (Blocker B:
      // the durable write-failure marker this comment used to also mention
      // was an unauthorized invented schema -- removed; this flag alone was
      // always the primary signal, and publishCredentialAbsenceCheckpoint's
      // own `complete` field already bakes any failure into every SUBSEQUENT
      // durable write for the rest of this process's life regardless).
      if (checkpointAuthority.hadWriteFailure()) {
        return { state: 'PUBLICATION_INVALID', reason: 'CHECKPOINT_WRITE_FAILURE_RECORDED' };
      }
      if (finalizationState === 'PUBLICATION_INVALID') {
        return { state: 'PUBLICATION_INVALID', reason: terminalReason };
      }
      if (finalizationState === 'FINALIZED') {
        return { state: 'FINALIZED' };
      }
      if (finalizationState === 'OPEN') {
        if (activeConnectionCount() > 0) return { state: 'OPEN', reason: 'LEASES_ACTIVE' };
        // HARD NO-GO RESPONSE Block B (PLAN.md ~L560: "schema validation + full
        // sequence... required before evidence manifest publication"): the
        // durable credential-absence-checkpoints/v1 record must genuinely be
        // complete before proceeding to publish -- read fresh off disk (never
        // cached), since it is a separate authority CheckpointAuthority itself
        // owns, not composition-root in-memory state. FOURTH HARD NO-GO
        // RESPONSE: the classified reason (see isCredentialEvidenceComplete's
        // own docblock for the full taxonomy) is surfaced here verbatim rather
        // than collapsed to a single generic string, so a caller can tell a
        // corrupted record apart from one that is merely still in progress.
        const evidence = isCredentialEvidenceComplete();
        if (!evidence.complete) return { state: 'OPEN', reason: evidence.reason };
        const classification = await safePublish();
        if (classification === 'CONFIRMED_BEFORE_WRITE') return { state: 'OPEN', reason: 'CONFIRMED_BEFORE_WRITE' };
        // PUBLISHED | POSSIBLY_PUBLISHED (or anything else) -- PLAN.md ~L1136:
        // "any other outcome" -- both route through the SAME independent validator.
        const valid = await safeValidate();
        if (!valid) {
          finalizationState = 'PUBLICATION_INVALID';
          terminalReason = 'CANONICAL_VALIDATION_FAILED';
          return { state: 'PUBLICATION_INVALID', reason: terminalReason };
        }
        finalizationState = 'PUBLISHED_VALID';
        return { state: 'PUBLISHED_VALID' };
      }
      if (finalizationState === 'PUBLISHED_VALID') {
        if (activeConnectionCount() > 0) return { state: 'PUBLISHED_VALID', reason: 'LEASES_ACTIVE' };
        // HARD NO-GO RESPONSE Finding 2(a): mirrors the OPEN branch's own
        // evidence check (line ~5789) -- reaching PUBLISHED_VALID once does not
        // mean evidence stays complete forever; re-derive fresh off disk here
        // too, before ever calling the (separate, external) canonical
        // validator, exactly like OPEN->PUBLISHED_VALID already does before
        // its own publish/validate calls. Surfaces isCredentialEvidenceComplete's
        // own specific reason taxonomy verbatim, same as the OPEN branch.
        const evidence = isCredentialEvidenceComplete();
        if (!evidence.complete) {
          finalizationState = 'PUBLICATION_INVALID';
          terminalReason = evidence.reason || 'EVIDENCE_INCOMPLETE';
          return { state: 'PUBLICATION_INVALID', reason: terminalReason };
        }
        const revalidated = await safeValidate();
        if (!revalidated) {
          finalizationState = 'PUBLICATION_INVALID';
          terminalReason = 'REVALIDATION_FAILED';
          return { state: 'PUBLICATION_INVALID', reason: terminalReason };
        }
        finalizationState = 'FINALIZING';
        // Intentional fallthrough into the FINALIZING branch immediately below.
      }
      if (finalizationState === 'FINALIZING') {
        const teardownResult = attemptTeardown();
        if (!teardownResult.ok) return { state: 'FINALIZING', reason: teardownResult.reason };
        // CORRECTION PASS Block D item 3: re-verify evidence completeness
        // fresh off disk immediately before FINALIZED -- attemptTeardown's OWN
        // checkpoint writes (teardown:pre/teardown:post) just landed, and a
        // SECOND, fresh createRunAuthorities() instance's own in-memory
        // checkpointState starts empty, so its writes clobber the durable
        // record down to just those two entries if evidence is never
        // re-derived here (a crash-restart scenario). Mirrors the SAME
        // isCredentialEvidenceComplete() mechanism already used at the
        // OPEN->PUBLISHED_VALID and PUBLISHED_VALID->FINALIZING hops; on
        // failure, routes to PUBLICATION_INVALID, matching the existing
        // pattern used elsewhere in this same function for other evidence
        // failures. NOTE: this is a genuinely separate concern from item 1's
        // idempotency guard -- that one only helps a SAME-instance retry;
        // this fresh-off-disk re-check is what closes the cross-instance gap.
        // Scoped to a non-empty expectedRoster: the crash-restart bug this
        // closes only manifests via CLOBBERED PER-MEMBER entries, which can
        // only exist when roster is non-empty -- an empty roster has no
        // per-member evidence to clobber, so isCredentialEvidenceComplete's
        // own "record absent" vacuous-complete rule already covered it
        // trivially before this fix; forcing the stricter "record present"
        // schema/mode validation here too (now that attemptTeardown's own
        // teardown:pre/post writes make the record genuinely exist) would
        // regress every empty-roster fixture using this suite's own
        // non-production 'conformance' mode placeholder for an unrelated reason.
        if (Array.isArray(expectedRoster) && expectedRoster.length > 0) {
          const postTeardownEvidence = isCredentialEvidenceComplete();
          if (!postTeardownEvidence.complete) {
            finalizationState = 'PUBLICATION_INVALID';
            terminalReason = postTeardownEvidence.reason || 'EVIDENCE_INCOMPLETE';
            return { state: 'PUBLICATION_INVALID', reason: terminalReason };
          }
        }
        finalizationState = 'FINALIZED';
        return { state: 'FINALIZED' };
      }
      return { state: finalizationState };
    }

    const isOpenForBinding = () => finalizationState === 'OPEN' || finalizationState === 'PUBLISHED_VALID';
    return Object.freeze({ publishAndFinalize, isOpenForBinding });
  }

  return Object.freeze({ createRunFinalization });
}

module.exports = Object.freeze({ createCredentialRunFinalization });
