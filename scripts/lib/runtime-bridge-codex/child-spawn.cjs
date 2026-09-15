'use strict';

function createChildSpawn({
  fs,
  path,
  rc,
  registryRepoDir,
  canonicalJSONStringify,
  publishBridgeRegistryRecord,
  writeQuarantineRecord,
  isCoreGeneratedIdentifier,
  deriveTrueRootIdentity,
  rootIdentityKeyFor,
  liveChildRootIdentityKeys,
  requireProvenProcessIdentity,
  requireProvenChildIdentity,
}) {

  const DEFAULT_SPAWN_IDENTITY_TIMEOUT_MS = 5000;

  const DEFAULT_SPAWN_STOP_CONFIRM_TIMEOUT_MS = 5000;

  function spawnWithIntent(params, spawnFn, opts) {
    const { instanceId, repoId, runId, rootIdentity } = params || {};
    const options = opts || {};
    const registry = options.registry;
    const identityTimeoutMs = Number.isFinite(options.identityTimeoutMs) ? options.identityTimeoutMs : DEFAULT_SPAWN_IDENTITY_TIMEOUT_MS;
    const stopConfirmTimeoutMs = Number.isFinite(options.stopConfirmTimeoutMs) ? options.stopConfirmTimeoutMs : DEFAULT_SPAWN_STOP_CONFIRM_TIMEOUT_MS;
    // HARD NO-GO RESPONSE Block D: stopping a child goes through an
    // injectable authority a host must supply (PLAN.md ~L992 already names
    // `stopOwnedChild(handle)` as "the only operation allowed to signal a
    // process") -- MANDATORY, no fallback of any kind. The prior
    // `child.kill('SIGTERM')` default WAS ITSELF the violation Codex flagged
    // (not merely a gap reachable some other way): this wrapper must never
    // call child.kill() anywhere in its own code, not even as a default value.
    if (typeof options.stopOwnedChild !== 'function') {
      return Promise.resolve({ state: 'STOP_OWNED_CHILD_REQUIRED', reason: 'STOP_OWNED_CHILD_REQUIRED' });
    }
    const stopOwnedChild = options.stopOwnedChild;
    // CORRECTION ROUND: a malformed/missing registry must be caught here, fail-
    // closed, BEFORE spawnFn() can ever be reached below -- registry.register()
    // is only called AFTER a real child process may already exist (line
    // ~6555), so a throw there would surface as a silent Promise rejection
    // (none of the 4 documented outcome states) with a genuinely-spawned, live
    // child left with no registry entry and no way for any caller to ever
    // discover, stop, or account for it.
    if (!registry || typeof registry.register !== 'function' || typeof registry.resolve !== 'function' || typeof registry.unregister !== 'function') {
      return Promise.resolve({ state: 'REGISTRY_REQUIRED', reason: 'REGISTRY_REQUIRED' });
    }
    // CORRECTION PASS ROUND 6 (Finding F, entrypoint sweep): repoId/instanceId
    // reach registryRepoDir's own path.join below with ZERO validation --
    // worse than createRunRoot's prior (broad-but-nonempty) state, since this
    // exported entrypoint had no check at all. Same isCoreGeneratedIdentifier
    // grammar as createRunRoot/classify()/reconcile(), checked here before the
    // Promise executor (mirroring the STOP_OWNED_CHILD_REQUIRED/
    // REGISTRY_REQUIRED early-return style immediately above) so a malformed
    // repoId/instanceId never reaches a single path.join call.
    if (!isCoreGeneratedIdentifier(repoId) || !isCoreGeneratedIdentifier(instanceId)) {
      return Promise.resolve({ state: 'UNSAFE_IDENTIFIER_SEGMENT', reason: 'UNSAFE_IDENTIFIER_SEGMENT:core-generated-grammar' });
    }

    return new Promise((resolve) => {
      const intentPath = path.join(registryRepoDir({ repoId }), 'spawn-intents', instanceId + '.json');
      const intentRecord = {
        schema: 'coordination/spawn-intent/v1',
        instanceId, repoId, runId, rootIdentity,
        intentAt: new Date().toISOString(),
      };
      const intentBytes = Buffer.from(canonicalJSONStringify(intentRecord), 'utf8');
      try {
        publishBridgeRegistryRecord(intentPath, intentBytes);
      } catch (err) {
        // Fail-closed (PLAN.md ~L1163): spawnFn is NEVER called if the intent
        // publish itself fails. Not one of the diagram's 4 resolvable states
        // (this is a precondition failure, before WAITING even begins).
        resolve({ state: 'INTENT_PUBLISH_FAILED', reason: (err && err.detailCode) || 'INTENT_PUBLISH_FAILED' });
        return;
      }

      let settled = false;
      let spawnObserved = false;
      let stoppingStarted = false;
      let identityTimer = null;

      function clearIdentityTimer() {
        if (identityTimer) { clearTimeout(identityTimer); identityTimer = null; }
      }
      function finishOnce(result) {
        if (settled) return;
        settled = true;
        clearIdentityTimer();
        resolve(result);
      }
      /**
       * CORRECTION ROUND Section C: returns whether the durable publish
       * ACTUALLY succeeded -- a failed durable write is never silently
       * swallowed behind a falsely-clean FAILED_BEFORE_PROCESS settlement.
       * @returns {boolean}
       */
      function publishSpawnFailed(failureReason) {
        const failedRecord = {
          schema: 'coordination/spawn-failed-before-process/v1',
          instanceId, repoId, runId,
          intentDigest: rc.sha256Buffer(intentBytes),
          failureReason,
          failedAt: new Date().toISOString(),
        };
        const failedPath = path.join(registryRepoDir({ repoId }), 'spawn-intents', instanceId + '.failed.json');
        try {
          publishBridgeRegistryRecord(failedPath, Buffer.from(canonicalJSONStringify(failedRecord), 'utf8'));
          return true;
        } catch (err) {
          return false;
        }
      }

      let child;
      try {
        child = spawnFn();
      } catch (err) {
        const published = publishSpawnFailed('synchronous-throw');
        finishOnce({
          state: 'FAILED_BEFORE_PROCESS',
          ok: published,
          durableRecordFailed: !published,
          reason: String((err && (err.code || err.message)) || 'synchronous-throw'),
        });
        return;
      }

      const ownedChildId = registry.register(child); // SYNCHRONOUS, before any await (PLAN.md ~L1163).

      function startStopping() {
        if (stoppingStarted) return;
        stoppingStarted = true;
        clearIdentityTimer();
        let stopConfirmed = false;
        const stopTimer = setTimeout(() => {
          if (stopConfirmed || settled) return;
          // Unconfirmable within its own bound -> UNKNOWN_OWNED. Registry entry
          // RETAINED (never unregistered here) -- the retained ownedChildId
          // lets a later, separately-authorized recovery pass resolve the live
          // handle (PLAN.md ~L1174). CORRECTION ROUND Section C: the quarantine
          // publish's own success/failure is reflected in the result, never
          // silently swallowed behind a falsely-clean UNKNOWN_OWNED settlement.
          const quarantineResult = writeQuarantineRecord({ repoId, instanceId, runId, reason: 'STOP_UNCONFIRMED', correlatedRecordBytes: intentBytes });
          finishOnce({ state: 'UNKNOWN_OWNED', ownedChildId, durableRecordFailed: !quarantineResult.ok });
        }, stopConfirmTimeoutMs);
        function onExit() {
          if (stopConfirmed) return;
          stopConfirmed = true;
          clearTimeout(stopTimer);
          registry.unregister(ownedChildId);
          finishOnce({ state: 'STOPPED' });
        }
        child.once('exit', onExit);
        try {
          stopOwnedChild(child); // CORRECTION ROUND Section C: never child.kill() directly -- always through the injectable authority.
        } catch (err) { /* best-effort -- the bounded stopTimer above still governs the outcome either way */ }
      }

      child.once('spawn', () => {
        // CORRECTION ROUND Section C: once STOPPING has begun, a LATER 'spawn'
        // event must be structurally incapable of re-triggering BORN (the
        // timeout->late-spawn race) -- gated on stoppingStarted, not merely settled.
        // THIRD HARD NO-GO RESPONSE Block D: a late 'spawn' arriving AFTER this
        // wrapper already settled via a DIFFERENT path (e.g. FAILED_BEFORE_PROCESS
        // from an 'error' that fired with no prior 'spawn') proves the child is
        // genuinely alive despite being believed dead -- the outer promise has
        // ALREADY settled and cannot be re-resolved, but the now-known-live,
        // fully-untracked child must still be actively stopped rather than
        // silently abandoned with zero authority over it.
        if (settled && !stoppingStarted) {
          // CORRECTION PASS Block C item 4: the outer promise has ALREADY
          // settled (via a DIFFERENT path, e.g. FAILED_BEFORE_PROCESS from a
          // prior 'error' with no prior spawn) and can never be re-resolved --
          // but this now-known-alive child must not be left silently
          // untracked (the 'error' handler already unregistered it, so
          // nothing tracks it at all otherwise). Re-register it (mirroring
          // UNKNOWN_OWNED's own retained-ownedChildId precedent -- a later,
          // separately-authorized recovery pass can still resolve it) and
          // publish a durable quarantine record immediately via the SAME
          // shared writer every other quarantine-triggering path in this file
          // uses -- unlike startStopping()'s own bounded confirm-then-
          // quarantine wait, this is unconditionally anomalous the moment
          // it's observed, so waiting to quarantine it would add nothing
          // (already known-anomalous, never a plausible clean-exit-pending
          // case the way startStopping()'s own pre-quarantine wait is).
          // CORRECTION PASS ROUND 5 (Finding 5): the quarantine write's own
          // result is now captured (never a discarded bare statement), and
          // stopOwnedChild(child) now gets a REAL bounded confirmation --
          // mirroring startStopping()'s own stopTimer+onExit pattern -- rather
          // than fire-and-forget. There is no promise left to report either
          // outcome through, so an OPTIONAL, caller-supplied
          // opts.onLateSpawnRecovery(result) hook is the observation channel
          // (never invoked at all if the caller doesn't supply one -- this is
          // strictly additive, never a required new contract) -- a
          // non-schema-inventing way for same-process code to observe this
          // rather than it vanishing entirely; the genuinely cross-process
          // discoverability gap (a fresh reaper process finding this specific
          // child) remains open, same conclusion as the round-4 cleanupRoot
          // cross-process liveness gap (see block report).
          const lateOwnedChildId = registry.register(child);
          // CORRECTION PASS ROUND 6 (Finding D item 1): this now-known-alive
          // child was never marked in liveChildRootIdentityKeys at all (the
          // BORN branch's own equivalent wiring, just above, was never
          // mirrored here) -- cleanupRoot's own same-process live-child veto
          // had ZERO protection for a late-recovered child, even within THIS
          // SAME process. Mirrors the BORN branch's own exact pattern:
          // independently re-derived TRUE identity preferred over the
          // caller-supplied rootIdentity, released the moment the child
          // genuinely, observably exits.
          const lateTrueIdentity = deriveTrueRootIdentity({ repoId, instanceId }) || rootIdentity;
          const lateLiveKey = rootIdentityKeyFor(lateTrueIdentity);
          if (lateLiveKey) {
            liveChildRootIdentityKeys.add(lateLiveKey);
            child.once('exit', () => { liveChildRootIdentityKeys.delete(lateLiveKey); });
          }
          const lateQuarantineResult = writeQuarantineRecord({ repoId, instanceId, runId, reason: 'STOP_UNCONFIRMED', correlatedRecordBytes: intentBytes });
          const onLateSpawnRecovery = typeof options.onLateSpawnRecovery === 'function' ? options.onLateSpawnRecovery : null;
          let lateStopConfirmed = false;
          const lateStopTimer = setTimeout(() => {
            if (lateStopConfirmed) return;
            if (onLateSpawnRecovery) {
              try {
                onLateSpawnRecovery({ ownedChildId: lateOwnedChildId, stopConfirmed: false, quarantineOk: lateQuarantineResult.ok, quarantineReason: lateQuarantineResult.reason });
              } catch (err) { /* best-effort -- a caller's own hook must never crash this handler */ }
            }
          }, stopConfirmTimeoutMs);
          // Never blocks process exit on its own -- this is a best-effort,
          // same-process observability signal, not a durability barrier (the
          // quarantine record above already IS the durable barrier).
          if (typeof lateStopTimer.unref === 'function') lateStopTimer.unref();
          child.once('exit', () => {
            if (lateStopConfirmed) return;
            lateStopConfirmed = true;
            clearTimeout(lateStopTimer);
            registry.unregister(lateOwnedChildId);
            if (onLateSpawnRecovery) {
              try {
                onLateSpawnRecovery({ ownedChildId: lateOwnedChildId, stopConfirmed: true, quarantineOk: lateQuarantineResult.ok, quarantineReason: lateQuarantineResult.reason });
              } catch (err) { /* best-effort -- a caller's own hook must never crash this handler */ }
            }
          });
          try { stopOwnedChild(child); } catch (err) { /* best-effort -- the bounded lateStopTimer above still governs the outcome either way */ }
          return;
        }
        if (settled || stoppingStarted) return;
        spawnObserved = true;
        clearIdentityTimer();
        const identityResult = requireProvenProcessIdentity(); // the SUPERVISOR/HOST's own identity.
        // CORRECTION ROUND Section C: the CHILD's own identity -- a different
        // subject entirely. HARD NO-GO RESPONSE Block D (Group A):
        // options.expectedExecutable threads through to the canonical
        // executable-correlation check -- optional, since no real caller
        // exists yet (C4 territory); omitted, this degrades to the
        // existence-only check exactly as before this round.
        const childIdentityResult = requireProvenChildIdentity(child, { expectedExecutable: options.expectedExecutable });
        if (identityResult.ok && childIdentityResult.ok) {
          registry.unregister(ownedChildId); // BORN: ownership transfers directly to the caller, never left double-tracked.
          // THIRD HARD NO-GO RESPONSE Block C: mark this root's identity as
          // having a genuinely live child -- consulted by cleanupRoot below.
          // FOURTH HARD NO-GO RESPONSE: prefer the independently-re-derived
          // REAL identity over the caller-supplied rootIdentity param (see
          // deriveTrueRootIdentity's own docblock) -- falls back to the
          // caller-supplied value only when no durable root-provision-complete
          // record resolves at all, never the reverse.
          const trueIdentity = deriveTrueRootIdentity({ repoId, instanceId }) || rootIdentity;
          const liveKey = rootIdentityKeyFor(trueIdentity);
          if (liveKey) {
            liveChildRootIdentityKeys.add(liveKey);
            // FOURTH HARD NO-GO RESPONSE Block C item 2: release this exact key
            // the moment the child genuinely, observably exits -- the SAME
            // native 'exit' event startStopping's own onExit already trusts,
            // attached here even though the outer promise has already settled
            // and ownership of `child` has already transferred to the caller.
            child.once('exit', () => { liveChildRootIdentityKeys.delete(liveKey); });
          }
          // THIRD HARD NO-GO RESPONSE Block D: the already-computed, already-
          // validated childIdentity is now attached to what the caller
          // actually receives, never discarded.
          finishOnce({ state: 'BORN', child, childIdentity: childIdentityResult.childIdentity });
        } else {
          startStopping();
        }
      });

      child.once('error', (err) => {
        // CORRECTION ROUND Section C: same late-event gating as 'spawn' above --
        // once STOPPING has begun, a LATER 'error' must not re-trigger a transition.
        if (settled || spawnObserved || stoppingStarted) return;
        registry.unregister(ownedChildId);
        const published = publishSpawnFailed('error-event-before-spawn');
        finishOnce({
          state: 'FAILED_BEFORE_PROCESS',
          ok: published,
          durableRecordFailed: !published,
          reason: [
            String((err && (err.code || err.message)) || 'error-event-before-spawn'),
            String((err && err.syscall) || 'unknown-syscall'),
            String((err && err.path) || 'unknown-path'),
            'command-exists=' + fs.existsSync((err && err.path) || ''),
            'cwd-exists=' + fs.existsSync(child.__acdSpawnCwd || ''),
          ].join(','),
        });
      });

      identityTimer = setTimeout(() => {
        if (settled || spawnObserved || stoppingStarted) return;
        startStopping();
      }, identityTimeoutMs);
    });
  }

  return Object.freeze({ spawnWithIntent });
}

module.exports = Object.freeze({ createChildSpawn });
