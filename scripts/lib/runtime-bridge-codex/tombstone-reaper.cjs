'use strict';

function createTombstoneReaper({
  fs,
  path,
  registryRepoDir,
  isCoreGeneratedIdentifier,
  fdBoundRecordExists,
  readDurableRegistryRecordFd,
  REGISTRY_RECORD_MAX_BYTES,
  validateCleanupIntentRecord,
  validateRetiredInstanceRecord,
  classifyGenuineNeverSpawnedAbsence,
  defaultPidLivenessProbe,
  writeQuarantineRecord,
  resolveProcessBirthObserver,
  rootIdentityKeyFor,
  liveChildRootIdentityKeys,
  validateRootProvisionIntentRecord,
  validateRootProvisionCompleteRecord,
  fdBoundIdentityTuple,
  fsyncDirSync,
  hasExactKeys,
  CLEANUP_COMPLETE_CLOSED_FIELDS,
  CANONICAL_NONNEGATIVE_DECIMAL_STRING_PATTERN,
}) {

  function reapTombstonedRoot({ repoId, instanceId }, deps) {
    // CORRECTION PASS ROUND 6 (Finding F, entrypoint sweep): same
    // isCoreGeneratedIdentifier grammar as createRunRoot/spawnWithIntent/
    // retireInstanceRecord/classify()/reconcile() -- this exported entrypoint
    // had zero validation before reaching registryRepoDir's path.join below.
    if (!isCoreGeneratedIdentifier(repoId) || !isCoreGeneratedIdentifier(instanceId)) {
      return { ok: false, reason: 'UNSAFE_IDENTIFIER_SEGMENT:core-generated-grammar' };
    }
    const reapDependencies = deps || {};
    const reapLivenessProbe = typeof reapDependencies.livenessProbe === 'function' ? reapDependencies.livenessProbe : defaultPidLivenessProbe;
    const containerDir = path.join(registryRepoDir({ repoId }), '.tombstone', instanceId);
    const integrityPath = path.join(containerDir, 'integrity-failure.json');
    const integrityCheck = readDurableRegistryRecordFd(integrityPath, REGISTRY_RECORD_MAX_BYTES);
    if (!integrityCheck.ok) return { ok: false, reason: 'CLEANUP_RECORD_READ_FAILED' };
    if (integrityCheck.exists) {
      return { ok: false, reason: 'CLEANUP_INTEGRITY_FAILURE_ON_RECORD' };
    }

    const intentPath = path.join(containerDir, 'intent.json');
    const completePath = path.join(containerDir, 'complete.json');
    const intentCheck = readDurableRegistryRecordFd(intentPath, REGISTRY_RECORD_MAX_BYTES);
    if (!intentCheck.ok) return { ok: false, reason: 'CLEANUP_RECORD_READ_FAILED' };
    if (!intentCheck.exists) {
      return { ok: false, reason: 'NOTHING_TO_REAP' };
    }
    // ROUND 9 (P0-2a): cleanup-intent/v1 is now genuinely parsed/validated
    // (schema, correlation, outcome-aware shape) BEFORE anything else in this
    // record is trusted -- previously only its bare bytes were read, never
    // its content.
    const intentValidation = validateCleanupIntentRecord(intentCheck.text, { repoId, instanceId });
    if (!intentValidation.ok) return { ok: false, reason: intentValidation.reason };
    const intentRecord = intentValidation.record;
    const completeCheck = readDurableRegistryRecordFd(completePath, REGISTRY_RECORD_MAX_BYTES);
    if (!completeCheck.ok) return { ok: false, reason: 'CLEANUP_RECORD_READ_FAILED' };

    if (!completeCheck.exists) {
      const intentBytes = Buffer.from(intentCheck.text, 'utf8');
      writeQuarantineRecord({ repoId, instanceId, runId: intentRecord.runId, reason: 'RENAMED_WITHOUT_COMPLETE', correlatedRecordBytes: intentBytes });
      return { ok: false, reason: 'RENAMED_WITHOUT_COMPLETE' };
    }
    // CORRECTION PASS ROUND 5 (Finding 3, precondition 1 of 3, semantics
    // corrected by team-lead after an initial over-broad version): PLAN.md
    // ~L1178 requires the instance record's OWN retirement as one of 5
    // preconditions before reaping. The actual violation is a record still
    // sitting at its LIVE location (spawned but never retired) -- reject ONLY
    // then. Absent from BOTH the live and tombstone locations (genuinely
    // never spawned -- NEVER_SPAWNED, needs no liveness proof per PLAN.md
    // ~L1182) or present ONLY at the tombstone location (properly retired)
    // both legitimately permit reaping.
    const instanceLivePath = path.join(registryRepoDir({ repoId }), 'instances', instanceId + '.json');
    const instanceLiveCheck = fdBoundRecordExists(instanceLivePath);
    if (!instanceLiveCheck.ok) return { ok: false, reason: 'CLEANUP_REAP_INSTANCE_RECORD_CHECK_FAILED' };
    if (instanceLiveCheck.exists) {
      return { ok: false, reason: 'CLEANUP_REAP_INSTANCE_RECORD_NOT_RETIRED' };
    }
    // CORRECTION PASS ROUND 5 (Finding 3, precondition 3 of 3): the instance
    // record's own closed schema (PLAN.md's "Host-private instance registry"
    // paragraph, verified directly: `instances/<instance_id>.json` carries
    // exactly {instance_id,driver,process_kind,ephemeral_home_path,
    // worker_session_id,worker_nonce,pid,executable_path,os_birth_token,pgid,
    // created_at}) already carries pid/os_birth_token/executable_path -- once
    // retired, that same record survives byte-identical at its tombstone
    // location (retireInstanceRecord's own copy-then-remove contract). Reusing
    // THIS SAME read (no new parameter, no new schema) for a genuine, fresh
    // liveness re-check via the injected livenessProbe closes PLAN's own
    // "fresh re-check of PID/birth-token/liveness" requirement. Absent
    // (NEVER_SPAWNED, nothing was ever spawned) means nothing to re-check --
    // proceeds directly, matching PLAN.md ~L1182's own "needs no liveness
    // proof" rule for that case.
    const instanceTombstonePath = path.join(registryRepoDir({ repoId }), 'instances', '.tombstone', instanceId + '.json');
    const instanceTombstoneRead = readDurableRegistryRecordFd(instanceTombstonePath, REGISTRY_RECORD_MAX_BYTES);
    if (!instanceTombstoneRead.ok) return { ok: false, reason: 'CLEANUP_REAP_INSTANCE_RECORD_CHECK_FAILED' };
    if (instanceTombstoneRead.exists) {
      let retiredInstanceRecord;
      try {
        retiredInstanceRecord = JSON.parse(instanceTombstoneRead.text);
      } catch (err) {
        return { ok: false, reason: 'CLEANUP_REAP_INSTANCE_RECORD_UNREADABLE' };
      }
      if (!retiredInstanceRecord || typeof retiredInstanceRecord !== 'object') {
        return { ok: false, reason: 'CLEANUP_REAP_INSTANCE_RECORD_UNREADABLE' };
      }
      // ROUND 8 (Finding 4 item 1+3) / ROUND 10 (Block D): now the SAME
      // shared validateRetiredInstanceRecord retirement's own idempotent-
      // resume uses -- previously this call site validated only instance_id
      // correlation + pid shape, a strictly WEAKER standard than retirement's
      // own full-11-field check for the identical durable record family. A
      // record found at the expected tombstone path is not, by itself, proof
      // it is genuinely THIS instanceId's own COMPLETE record.
      const retiredInstanceValidation = validateRetiredInstanceRecord(retiredInstanceRecord, { instanceId });
      if (!retiredInstanceValidation.ok) {
        if (retiredInstanceValidation.reason === 'INSTANCE_RECORD_CORRELATION_MISMATCH') {
          return { ok: false, reason: 'CLEANUP_REAP_INSTANCE_RECORD_CORRELATION_MISMATCH' };
        }
        return { ok: false, reason: 'CLEANUP_REAP_INSTANCE_RECORD_MALFORMED' };
      }
      // ROUND 7 (Finding 2 item 1): same bug class as Finding 1 item 1 --
      // only 'LIVE' was rejected, silently letting 'INDETERMINATE' (unproven
      // either way) pass through as if the probe had confirmed the process
      // dead. Only a proven 'DEAD' may proceed.
      if (reapLivenessProbe(retiredInstanceRecord.pid) !== 'DEAD') {
        return { ok: false, reason: 'CLEANUP_REAP_LIVE_CHILD_PRESENT' };
      }
      // ROUND 9 (P0-2e): PLAN.md's own "fresh re-check of PID/birth-token/
      // liveness" (wp3-item-c3-design-r4.md:386) previously only re-checked
      // liveness via the (injectable, therefore not independently
      // trustworthy on its own) reapLivenessProbe -- os_birth_token was never
      // touched at all. observeProcessBirth (Block E's closed 3-way result --
      // the SAME real ps -o lstart= mechanism requireProvenChildIdentity
      // already uses for a live child object, reused here for a durable
      // record's stored fields rather than re-implemented) gives an
      // INDEPENDENT, non-injectable (resolveProcessBirthObserver's own
      // test-only double-gate, never a production-caller-substitutable
      // parameter) cross-check: PRESENT means SOMETHING is currently observed
      // at this pid via the real OS mechanism, contradicting the (possibly
      // buggy or lying) injected probe's 'DEAD' claim regardless of outcome
      // -- if its birth-time matches the stored os_birth_token, the ORIGINAL
      // identified process is somehow still alive (the probe itself is
      // wrong); if it does not match, a DIFFERENT process has since reused
      // this pid. Both are genuinely distinct, informative conditions -- kept
      // as separate reason codes rather than collapsed into one, even though
      // both correctly reject.
      // ROUND 10 (Block E): UNAVAILABLE (ps itself could not be resolved or
      // invoked) is INDETERMINATE and must NEVER be treated as though it were
      // a confirmed ABSENT observation -- the prior `string|null` surface
      // collapsed both into the same null, silently letting destructive
      // recovery proceed on NO independent evidence whenever ps was merely
      // broken/unavailable, exactly as trusting a caller-injected probe alone
      // would. Only a genuine, positive ABSENT observation adds no signal
      // beyond what reapLivenessProbe already established and may proceed.
      // executable_path is NOT re-verified here: unlike a live child object
      // (which exposes its own spawnfile directly), there is no existing,
      // reliable, cross-platform mechanism in this file to query "the CURRENT
      // executable of an arbitrary already-known pid" -- flagging this as a
      // genuine scoping limit, not a silent omission.
      const freshBirthObservation = resolveProcessBirthObserver()(retiredInstanceRecord.pid);
      if (freshBirthObservation.status === 'UNAVAILABLE') {
        return { ok: false, reason: 'CLEANUP_REAP_LIVENESS_OBSERVATION_UNAVAILABLE' };
      }
      if (freshBirthObservation.status === 'PRESENT') {
        if (freshBirthObservation.birthToken === retiredInstanceRecord.os_birth_token) {
          return { ok: false, reason: 'CLEANUP_REAP_LIVENESS_PROBE_CONTRADICTED' };
        }
        return { ok: false, reason: 'CLEANUP_REAP_LIVE_CHILD_PRESENT' };
      }
    } else {
      // CORRECTION PASS ROUND 6 (Finding D item 2) / ROUND 8 (Finding 2): the
      // instance record is absent from BOTH the live and tombstone locations
      // at this point -- classifyGenuineNeverSpawnedAbsence (shared with
      // isValidCleanupAuthorization's own NEVER_SPAWNED branch, factored out
      // this round rather than kept as a third independent copy) applies
      // PLAN.md ~L1182's own spawn-intent/v1 vs spawn-failed-before-process/v1
      // distinction.
      const classification = classifyGenuineNeverSpawnedAbsence({ repoId, instanceId });
      if (classification.status === 'CHECK_FAILED') {
        return { ok: false, reason: 'CLEANUP_REAP_SPAWN_INTENT_CHECK_FAILED' };
      }
      if (classification.status === 'SPAWN_OUTCOME_UNKNOWN') {
        if (classification.quarantineData) {
          writeQuarantineRecord({
            repoId, instanceId, runId: classification.quarantineData.runId,
            reason: 'SPAWN_OUTCOME_UNKNOWN', correlatedRecordBytes: classification.quarantineData.correlatedRecordBytes,
          });
        }
        return { ok: false, reason: 'CLEANUP_REAP_SPAWN_OUTCOME_UNKNOWN' };
      }
      if (classification.status === 'MALFORMED_SPAWN_FAILED_RECORD') {
        return { ok: false, reason: 'CLEANUP_REAP_SPAWN_FAILED_' + classification.malformedReason };
      }
      // classification.status === 'NEVER_SPAWNED' || 'CONFIRMED_SAFE_SPAWN_FAILURE' -- proceed.
    }
    // CORRECTION ROUND Section D: intentExists && completeExists, no
    // integrity-failure -- a genuinely complete, non-ambiguous cleanup. Reap:
    // read the complete record's own finalPath and remove the already-
    // renamed-away root if it still physically exists there (cleanupRoot
    // already moved it into this same containerDir; reaping is the LAST step
    // once it's safe to do so). Absence at finalPath is never an error (it may
    // already be reaped, or never have physically existed). finalPath is only
    // ever trusted -- and only ever acted on -- when it is genuinely WITHIN
    // this container directory (never an arbitrary caller-recorded path):
    // never blindly rm -rf whatever a JSON field happens to name.
    let completeRecord;
    try {
      completeRecord = JSON.parse(completeCheck.text);
    } catch (err) {
      return { ok: false, reason: 'CLEANUP_COMPLETE_UNREADABLE' };
    }
    // THIRD HARD NO-GO RESPONSE Block C: validate the record's own schema and
    // correlation (instanceId/repoId) BEFORE trusting anything else about it
    // -- a record found at the expected container path is not, by itself,
    // proof it is the genuine, correctly-correlated record for THIS container.
    if (completeRecord.schema !== 'coordination/cleanup-complete/v1') {
      return { ok: false, reason: 'CLEANUP_COMPLETE_SCHEMA_INVALID' };
    }
    // ROUND 9 (P0-2b): runId correlation added (cross-checked against
    // cleanup-intent/v1's own already-validated runId -- the only "truth"
    // available here, since reapTombstonedRoot itself receives no runId
    // parameter) -- both durable records belong to the SAME cleanup
    // operation and must agree.
    if (completeRecord.instanceId !== instanceId || completeRecord.repoId !== repoId || completeRecord.runId !== intentRecord.runId) {
      return { ok: false, reason: 'CLEANUP_COMPLETE_CORRELATION_MISMATCH' };
    }
    // ROUND 9 (P0-2b): closed-field-set check, sibling of
    // isValidCleanupAuthorization's own CLEANUP_AUTHORIZATION_CLOSED_FIELDS
    // pattern, plus rootInodeAfter shape and completedAt non-empty-string
    // validation -- previously only schema+instanceId+repoId were checked.
    const completeUnexpectedKey = Object.keys(completeRecord).find((key) => !CLEANUP_COMPLETE_CLOSED_FIELDS.has(key));
    if (completeUnexpectedKey !== undefined) {
      return { ok: false, reason: 'CLEANUP_COMPLETE_FIELD_INVALID' };
    }
    // ROUND 10 (Block B, team-lead-directed correction): a PRIOR round argued
    // rootInodeAfter's own value never needed cross-checking because both
    // writers only publish cleanup-complete/v1 AFTER their own `inodeMatches`
    // check already passed, making it "transitively" re-verified by the
    // intent-side check below -- that reasoning assumed a genuine writer, but
    // a durable record is validated as though it could be forged independent
    // of any writer's own behavior. A completeRecord.rootInodeAfter holding
    // an ARBITRARY, internally-consistent-looking value (disagreeing with
    // BOTH the intent's own rootInode and the current on-disk identity) was
    // never actually caught by any existing check -- contradiction between
    // two durable records is tamper/corruption evidence and must fail closed,
    // never be dismissed as redundant. Cross-checked explicitly below,
    // immediately after rootInodeAfter's own shape validation.
    // ROUND 10.1 (P1): exactly {dev,ino}, canonical non-negative decimal
    // strings -- same tightening as cleanup-intent/v1's own rootInode.
    if (!hasExactKeys(completeRecord.rootInodeAfter, ['dev', 'ino'])
      || !CANONICAL_NONNEGATIVE_DECIMAL_STRING_PATTERN.test(completeRecord.rootInodeAfter.dev)
      || !CANONICAL_NONNEGATIVE_DECIMAL_STRING_PATTERN.test(completeRecord.rootInodeAfter.ino)) {
      return { ok: false, reason: 'CLEANUP_COMPLETE_FIELD_INVALID' };
    }
    if (typeof completeRecord.completedAt !== 'string' || completeRecord.completedAt.length === 0) {
      return { ok: false, reason: 'CLEANUP_COMPLETE_FIELD_INVALID' };
    }
    // ROUND 9 (P0-2c): every legitimate cleanup-complete/v1 producer
    // (cleanupRoot, the crash-recovery tombstone path) ALWAYS writes a real,
    // non-null finalPath string -- confirmed against both writers directly.
    // A missing/non-string finalPath on an otherwise schema/correlation/
    // shape-valid record is therefore itself evidence of tampering, not a
    // "nothing to do" state -- previously this silently fell through to
    // {ok:true,reaped:false}, the SAME class of silent-success gap Finding 4
    // item 1 already fixed for the retired-instance-record's own missing pid.
    if (typeof completeRecord.finalPath !== 'string' || completeRecord.finalPath.length === 0) {
      return { ok: false, reason: 'CLEANUP_COMPLETE_FINAL_PATH_MISSING' };
    }
    // FOURTH HARD NO-GO RESPONSE fix: `reaped` must reflect whether a removal
    // was GENUINELY attempted, never a hardcoded true regardless of whether
    // finalPath was even a string or genuinely contained -- a skipped removal
    // (finalPath absent/non-string, or present but resolving outside this
    // container) is not the same outcome as a real, attempted (even if it
    // turned out to be a no-op because the path was already gone) removal.
    let removalAttempted = false;
    if (typeof completeRecord.finalPath === 'string') {
      // ADVERSARIAL RE-AUDIT (HARD NO-GO, 2026-07-21): the prior containment
      // check accepted the container DIRECTORY ITSELF (resolvedFinalPath ===
      // resolvedContainerDir) or ANY descendant at any depth (startsWith the
      // container prefix) -- but every legitimate cleanup-complete/v1 producer
      // (cleanupRoot and this file's own crash-recovery tombstone path) always
      // writes finalPath as EXACTLY <container>/root, nothing else. Requiring
      // exact equality to that one expected path closes the gap without
      // affecting any genuine record; both sides are still resolved via
      // path.resolve/path.join (unchanged posture) so a
      // "<container>/../../victim"-shaped finalPath cannot escape the check by
      // textual trickery.
      const resolvedFinalPath = path.resolve(completeRecord.finalPath);
      const expectedFinalPath = path.join(path.resolve(containerDir), 'root');
      const genuinelyContained = resolvedFinalPath === expectedFinalPath;
      // ROUND 9 (P0-2c sibling, team-lead-directed follow-up): a finalPath
      // that is a well-formed string but resolves OUTSIDE this container is
      // the SAME class of anomaly as the missing/non-string case just fixed
      // above -- every legitimate producer always writes finalPath as EXACTLY
      // <container>/root, so a present-but-uncontained value is itself
      // evidence of tampering, not a "nothing to do here" state. Previously
      // this silently fell through to {ok:true,reaped:false} instead of
      // failing closed.
      if (!genuinelyContained) {
        return { ok: false, reason: 'CLEANUP_COMPLETE_FINAL_PATH_NOT_CONTAINED' };
      }
      if (genuinelyContained) {
        // Best-effort, same-process liveness veto, mirroring cleanupRoot's own
        // liveChildRootIdentityKeys check -- genuinely meaningful only when
        // this reap call happens to run in the same process that observed a
        // child reach BORN against this exact root (rename preserves inode,
        // so the identity key survives the earlier cleanupRoot rename intact);
        // vacuous (always empty) in the cross-process/recovery-sweep case,
        // exactly like every other same-process-only tracking set in this
        // file. Not a substitute for the pre-rename liveness check cleanupRoot
        // and the crash-recovery tombstone path already perform before EVER
        // producing this record -- defense in depth on top of that, never the
        // sole guard.
        try {
          // Match cleanupRoot's lossless identity check. A rounded NTFS inode
          // must never bypass this same-process live-child veto.
          const preRemovalStat = fs.statSync(completeRecord.finalPath, { bigint: true });
          const liveKey = rootIdentityKeyFor({ dev: preRemovalStat.dev, ino: preRemovalStat.ino });
          if (liveKey && liveChildRootIdentityKeys.has(liveKey)) {
            return { ok: false, reason: 'CLEANUP_REAP_LIVE_CHILD_PRESENT' };
          }
        } catch (err) {
          // Not present (or unreadable) -- the removal attempt below already
          // treats absence as a safe no-op via force:true.
        }
        // CORRECTION PASS ROUND 5 (Finding 3, precondition 2 of 3, approved
        // design): a fresh fd-bound identity re-check of the tombstoned
        // directory, immediately before removal, against root-provision-
        // complete/v1's own DURABLY-CAPTURED finalIdentitySnapshot.
        // topologyIdentity.root -- captured at finalizeRunRoot time, BEFORE
        // any possible post-tombstone substitution, so it defeats an attack
        // staged before reapTombstonedRoot is ever invoked (a same-process
        // capture-then-recheck window, unlike cleanupRoot's own pre-rename
        // pattern, could never catch this: the substitution here happens
        // BETWEEN separate calls, not within one function's own execution).
        // No new schema field -- reusing an existing durable record.
        //
        // CORRECTION PASS ROUND 5 (Finding 3, precondition 2 NEVER_SPAWNED
        // fix, mirrors precondition 1's own already-corrected NEVER_SPAWNED
        // handling): root-provision-complete/v1 is published ONLY on a
        // successful finalizeRunRoot (READY transition) -- a root abandoned
        // while still PROFILE_PENDING (a genuine NEVER_SPAWNED cleanup) never
        // publishes it, so treating absence as an unconditional hard failure
        // would leak that root's tombstoned directory forever (a real
        // resource leak, not just a theoretical gap). Absence is therefore
        // NOT, by itself, treated as "safe to skip the check" -- it is
        // independently VERIFIED as a genuine never-reached-READY case first
        // (root-provision-intent/v1 exists -- a real createRunRoot call
        // happened for this instanceId -- but root-provision-complete/v1
        // does not), mirroring cleanupRoot's own justified PROFILE_PENDING
        // exception ("there is no snapshot to compare against -- this root
        // never reached READY"). Anything else absent/malformed for BOTH
        // records still fails closed -- an unrecognized, unexplained state is
        // never silently treated as "fine, proceed."
        const provisioningCompletePath = path.join(registryRepoDir({ repoId }), 'root-provisioning', instanceId + '.complete.json');
        const provisioningCompleteRead = readDurableRegistryRecordFd(provisioningCompletePath, REGISTRY_RECORD_MAX_BYTES);
        if (!provisioningCompleteRead.ok) return { ok: false, reason: 'CLEANUP_REAP_IDENTITY_CHECK_FAILED' };
        let expectedRootIdentity = null;
        if (!provisioningCompleteRead.exists) {
          const provisioningIntentPath = path.join(registryRepoDir({ repoId }), 'root-provisioning', instanceId + '.intent.json');
          // ROUND 9 (P0-2d) / ROUND 10 (Block C): previously existence-only
          // (fdBoundRecordExists) -- a malformed file at this path sufficed to
          // skip the inode-swap defense entirely. Now fully, closedly
          // validated (validateRootProvisionIntentRecord: closed keys, schema,
          // correlation, runId grammar, intendedPath, ownerIdentity, canonical
          // timestamps, exact 300s lifetime relationship) before treating its
          // presence as genuine never-reached-READY evidence.
          const provisioningIntentRead = readDurableRegistryRecordFd(provisioningIntentPath, REGISTRY_RECORD_MAX_BYTES);
          if (!provisioningIntentRead.ok) return { ok: false, reason: 'CLEANUP_REAP_IDENTITY_CHECK_FAILED' };
          if (!provisioningIntentRead.exists) {
            // Neither intent nor complete exists -- not a recognized,
            // legitimate NEVER_SPAWNED pattern (a genuine createRunRoot call
            // always publishes intent first); fail closed rather than assume.
            return { ok: false, reason: 'CLEANUP_REAP_IDENTITY_RECORD_MISSING' };
          }
          const provisioningIntentValidation = validateRootProvisionIntentRecord(provisioningIntentRead.text, { repoId, instanceId });
          if (!provisioningIntentValidation.ok) {
            return { ok: false, reason: 'CLEANUP_REAP_IDENTITY_RECORD_MALFORMED:' + provisioningIntentValidation.reason };
          }
          if (provisioningIntentValidation.record.runId !== intentRecord.runId) {
            return { ok: false, reason: 'CLEANUP_REAP_IDENTITY_RECORD_MALFORMED' };
          }
          // Genuinely verified never-reached-READY -- proceed without the
          // inode-swap defense (expectedRootIdentity stays null), same
          // justified exception cleanupRoot itself already has for
          // PROFILE_PENDING handles.
        } else {
          // ROUND 10 (Block C): root-provision-complete/v1 is now fully,
          // closedly validated (validateRootProvisionCompleteRecord: closed
          // keys, schema+correlation, finalPath-vs-intent, the literal
          // 'IsolationProvider' writer, correlatedIntentDigest against the
          // intent's own fd-bound bytes, the COMPLETE 3-layer
          // finalIdentitySnapshot, canonical completedAt+ordering) -- a
          // partial record containing only a nested topologyIdentity.root
          // must never authorize recovery merely because that ONE nested
          // value happens to look plausible.
          const provisioningIntentPathForComplete = path.join(registryRepoDir({ repoId }), 'root-provisioning', instanceId + '.intent.json');
          const provisioningIntentReadForComplete = readDurableRegistryRecordFd(provisioningIntentPathForComplete, REGISTRY_RECORD_MAX_BYTES);
          if (!provisioningIntentReadForComplete.ok) return { ok: false, reason: 'CLEANUP_REAP_IDENTITY_CHECK_FAILED' };
          if (!provisioningIntentReadForComplete.exists) {
            return { ok: false, reason: 'CLEANUP_REAP_IDENTITY_RECORD_MISSING' };
          }
          const provisioningIntentValidationForComplete = validateRootProvisionIntentRecord(provisioningIntentReadForComplete.text, { repoId, instanceId });
          if (!provisioningIntentValidationForComplete.ok) {
            return { ok: false, reason: 'CLEANUP_REAP_IDENTITY_RECORD_MALFORMED:' + provisioningIntentValidationForComplete.reason };
          }
          const provisioningCompleteValidation = validateRootProvisionCompleteRecord(
            provisioningCompleteRead.text, { repoId, instanceId },
            provisioningIntentValidationForComplete.record, Buffer.from(provisioningIntentReadForComplete.text, 'utf8'));
          if (!provisioningCompleteValidation.ok) {
            return { ok: false, reason: 'CLEANUP_REAP_IDENTITY_RECORD_MALFORMED:' + provisioningCompleteValidation.reason };
          }
          if (provisioningCompleteValidation.record.runId !== intentRecord.runId) {
            return { ok: false, reason: 'CLEANUP_REAP_IDENTITY_RECORD_MALFORMED' };
          }
          expectedRootIdentity = provisioningCompleteValidation.record.finalIdentitySnapshot.topologyIdentity.root;
        }
        // ROUND 9 (P0-2a): freshRootIdentity is now computed unconditionally
        // (previously only when expectedRootIdentity was non-null) since
        // cleanup-intent/v1's OWN rootInode (captured by the writer BEFORE
        // the rename, always present regardless of outcome per this round's
        // P1-1 fix) is a SEPARATE, additional source of truth to cross-check
        // against -- confirmed against PLAN.md's own recovery table
        // (wp3-item-c3-design-r4.md:381), ADDITIONAL to the existing
        // root-provision-complete/v1-sourced check above, not a replacement
        // for it.
        let freshRootIdentity;
        try {
          freshRootIdentity = fdBoundIdentityTuple(completeRecord.finalPath);
        } catch (err) {
          return { ok: false, reason: 'CLEANUP_REAP_IDENTITY_CHECK_FAILED' };
        }
        if (expectedRootIdentity) {
          if (freshRootIdentity.dev !== expectedRootIdentity.dev || freshRootIdentity.ino !== expectedRootIdentity.ino) {
            return { ok: false, reason: 'CLEANUP_REAP_IDENTITY_MISMATCH' };
          }
        }
        if (freshRootIdentity.dev !== intentRecord.rootInode.dev || freshRootIdentity.ino !== intentRecord.rootInode.ino) {
          return { ok: false, reason: 'CLEANUP_REAP_INTENT_ROOT_INODE_MISMATCH' };
        }
        // ROUND 10 (Block B): completeRecord.rootInodeAfter's own VALUE, not
        // just its shape, must agree with BOTH the intent's own rootInode
        // (the two durable records must tell the same story) and the fresh
        // on-disk identity just re-derived above (freshRootIdentity is
        // already proven to match intentRecord.rootInode by the check just
        // above, so this transitively also proves agreement with the fresh
        // identity -- checked explicitly regardless, so a future change to
        // either check's own logic can never silently reintroduce the gap).
        if (completeRecord.rootInodeAfter.dev !== intentRecord.rootInode.dev || completeRecord.rootInodeAfter.ino !== intentRecord.rootInode.ino
          || completeRecord.rootInodeAfter.dev !== freshRootIdentity.dev || completeRecord.rootInodeAfter.ino !== freshRootIdentity.ino) {
          return { ok: false, reason: 'CLEANUP_COMPLETE_ROOT_INODE_AFTER_MISMATCH' };
        }
        try {
          // force:true already makes an ABSENT path a silent no-op (never
          // throws for ENOENT) -- any exception that still reaches this catch
          // is a genuine removal failure (e.g. a real permission error), never
          // swallowed unconditionally the way the prior code did.
          fs.rmSync(completeRecord.finalPath, { recursive: true, force: true });
          removalAttempted = true;
        } catch (err) {
          return { ok: false, reason: 'CLEANUP_REAP_REMOVAL_FAILED' };
        }
        // Durability barrier on the removal itself, matching every other
        // mutating operation in this file -- without it, a crash immediately
        // after rmSync could leave the directory-entry removal unconfirmed on
        // some filesystems/crash scenarios even though the syscall returned.
        if (removalAttempted && !fsyncDirSync(path.dirname(completeRecord.finalPath))) {
          return { ok: false, reason: 'CLEANUP_REAP_FSYNC_FAILED' };
        }
      }
    }
    return { ok: true, reaped: removalAttempted };
  }

  return Object.freeze({ reapTombstonedRoot });
}

module.exports = Object.freeze({ createTombstoneReaper });
