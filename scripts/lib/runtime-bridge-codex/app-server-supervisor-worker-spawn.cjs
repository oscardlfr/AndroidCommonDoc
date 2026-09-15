'use strict';

// Extracted behaviorally from runtime-bridge-codex.cjs's
// startOwnedAppServerSupervisorEngine/runStartup: the per-role app-server
// child spawn/adoption and BORN provenance record publication checkpoint.
// Deliberately has NO cooperative-abandonment (shuttingDown/
// engineStopRequested/deadline) checkpoints of its own between spawn and
// BORN publication -- genuine BORN proof must never be silently discarded
// by a concurrent stop, exactly as the original comments require. Returns
// {ok:true, child, bornRecord, onOwnedChildExit, ownedChildSpawnedAtMs} or
// has already called `shutdown` and returns {ok:false}. Never requires the
// facade or either sibling facade, directly or transitively.

function createSupervisorWorkerSpawn({
  spawn, spawnWithIntent, signalOwnedAppServerChild, resolveSessionRunBornProvenance, realpathOrSelf,
  publishBridgeRegistryRecord, canonicalJSONStringify, registryRepoDir, describeBornProvenanceFailure,
  describeOwnedChildState, describeOwnedChildExit, captureRegistryTailText, path, crypto,
  isolatedPathPosix, shutdown, isShuttingDown, getEngineStopRequested, bornVerificationPending,
  ownedChildRef, observerJobs,
}) {
  async function spawnRoleWorker({
    roleInstanceId, repoDescriptor, rendezvousInstanceId, testBackend, spawnCommand,
    createRootResult, rootIdentityForSpawn, stderrCapture, ledgerEntry, startupDeadlineMs, childRegistry,
  }) {
    const childEnv = Object.assign({ PATH: isolatedPathPosix }, createRootResult.env);
    for (const passthrough of ['LANG', 'USER', 'LOGNAME']) {
      if (typeof process.env[passthrough] === 'string') childEnv[passthrough] = process.env[passthrough];
    }
    if (testBackend === 'deterministic-app-server-v1' && process.platform === 'win32') {
      childEnv.PATH = path.dirname(process.execPath);
      childEnv.USERPROFILE = createRootResult.env.HOME;
      childEnv.APPDATA = createRootResult.env.XDG_CONFIG_HOME;
      childEnv.LOCALAPPDATA = createRootResult.env.XDG_CACHE_HOME;
      childEnv.TEMP = createRootResult.env.TMPDIR;
      childEnv.TMP = createRootResult.env.TMPDIR;
      for (const passthrough of ['SystemRoot', 'WINDIR', 'ComSpec', 'PATHEXT']) {
        if (typeof process.env[passthrough] === 'string') childEnv[passthrough] = process.env[passthrough];
      }
    }
    // Set SYNCHRONOUSLY inside spawnFn itself, the instant spawn() returns
    // -- lets the 'not BORN' branch below clear this exact pid's
    // bornVerificationPending membership even though spawnWithIntent's own
    // non-BORN settlement shapes carry no `child` field to recover a pid from.
    let pendingBirthPid = null;
    const spawnResult = await spawnWithIntent(
      { instanceId: roleInstanceId, repoId: repoDescriptor.repoId, runId: rendezvousInstanceId, rootIdentity: rootIdentityForSpawn },
      () => {
        const childStdio = testBackend === 'deterministic-app-server-v1' && process.platform === 'win32'
          ? ['overlapped', 'overlapped', 'inherit']
          : ['pipe', 'pipe', 'pipe'];
        const child = spawn(spawnCommand.command, spawnCommand.args, {
          shell: false, cwd: createRootResult.cwd, env: childEnv, stdio: childStdio,
          // Every console-subsystem child spawned on Windows gets its own
          // conhost window unless hidden here, and each takes keyboard
          // focus as it appears -- purely a window-creation flag, changes
          // no argument, stdio wiring, exit status or observable behaviour.
          windowsHide: true,
        });
        if (testBackend === 'deterministic-app-server-v1') child.__acdSpawnCwd = createRootResult.cwd;
        if (testBackend === 'deterministic-app-server-v1' && process.platform === 'win32' && child.stdout) {
          child.stdout.on('error', (err) => {
            if (!err || err.code !== 'ENOTCONN') child.emit('error', err);
          });
        }
        // The race is closed architecturally: this exact pid is marked
        // pending BORN verification the instant it becomes visible
        // (synchronously, in the SAME tick spawn() itself returns), and
        // the stop timeline's own stage1 defers stopping any child still
        // present in this Set to stage3 instead.
        bornVerificationPending.add(child.pid);
        pendingBirthPid = child.pid;
        // The ledger entry is updated to IN_FLIGHT, with the exact adopted
        // child already attached, SYNCHRONOUSLY -- the SAME instant this
        // coordinator itself admits the spawn.
        ledgerEntry.spawnState = 'IN_FLIGHT';
        ledgerEntry.child = child;
        // Ownership transfers to session-run synchronously with spawn(),
        // before spawnWithIntent awaits BORN accreditation. Shutdown
        // handlers were installed earlier and must be able to stop this
        // exact handle even if SIGTERM/START_DEADLINE arrives in the
        // pre-BORN window.
        ownedChildRef.children.push(child);
        ownedChildRef.child = child;
        if (child.stderr) child.stderr.on('data', (chunk) => { stderrCapture.register(chunk); });
        return child;
      },
      { registry: childRegistry, stopOwnedChild: signalOwnedAppServerChild },
    );
    if (spawnResult.state !== 'BORN') {
      // Genuinely attempted and failed, OR this exact child was stopped out
      // from under spawnWithIntent by this SAME coordinator's own stage1 --
      // either way this must never survive idle as though nothing had been
      // tried.
      if (pendingBirthPid !== null) bornVerificationPending.delete(pendingBirthPid);
      // Retain the ACTUAL spawn classification -- never fall back to
      // NOT_ATTEMPTED, which ledgerCleanupAuthorization would (wrongly)
      // treat as genuine no-spawn evidence.
      if (ledgerEntry.spawnState === 'IN_FLIGHT') {
        ledgerEntry.spawnState = spawnResult.state;
      }
      shutdown('APP_SERVER_SPAWN_FAILED:' + String(spawnResult.reason || spawnResult.state || 'unknown'));
      return { ok: false };
    }
    // BORN transfers the already-adopted handle out of spawnWithIntent's
    // private registry. Observe its later death directly.
    // Set only while the born-provenance failure branch below is composing
    // its signal, so a child death observed during that window is not a
    // second, competing cause.
    let composingBornProvenanceFailure = false;
    const ownedChildSpawnedAtMs = Date.now();
    const onOwnedChildExit = (code, signal) => {
      if (composingBornProvenanceFailure) return;
      if (!isShuttingDown() && !getEngineStopRequested()) {
        void shutdown(describeOwnedChildExit(
          code, signal,
          Date.now() - ownedChildSpawnedAtMs,
          captureRegistryTailText(stderrCapture, 65536),
        ));
      }
    };
    spawnResult.child.once('exit', onOwnedChildExit);
    // Genuinely BORN (spawnWithIntent's own proven-identity contract) is
    // proof enough to publish; this never waits for (or depends on)
    // initialize/login/thread-start/bootstrap.
    const expectedExecutablePath = realpathOrSelf(spawnCommand.command);
    const bornProvenanceStartedAtMs = Date.now();
    const bornProvenance = await resolveSessionRunBornProvenance(
      testBackend, spawnResult.child, expectedExecutablePath, startupDeadlineMs, observerJobs,
    );
    // Verification has now genuinely settled (success OR failure) for this
    // exact pid -- stage1 may safely stop it from this point forward.
    bornVerificationPending.delete(spawnResult.child.pid);
    if (!bornProvenance.ok) {
      // Honest failure, never a fabricated pgid/os_birth_token. The
      // observed spawn state genuinely WAS 'BORN' -- keeping it exactly
      // that (never a synthetic label) is what "preserves its observed
      // spawn state" means. identity_complete stays truthfully false
      // because bornRecord is never set below.
      ledgerEntry.spawnState = 'BORN';
      // Measured before the diagnostic turn below, so the reported
      // duration stays the duration of the proof itself.
      const bornProvenanceElapsedMs = Date.now() - bornProvenanceStartedAtMs;
      // The win32 proof runs its observations through execFileSync, which
      // blocks this event loop outright -- one turn of the loop delivers
      // the child's own queued 'exit'/stderr callbacks before this reports
      // a decision already made.
      composingBornProvenanceFailure = true;
      await new Promise((resolve) => { setImmediate(resolve); });
      shutdown(describeBornProvenanceFailure(
        bornProvenance,
        bornProvenanceElapsedMs,
        describeOwnedChildState(spawnResult.child),
        captureRegistryTailText(stderrCapture, 65536),
      ));
      return { ok: false };
    }
    const bornRecord = {
      instance_id: roleInstanceId,
      driver: 'codex-app-server',
      process_kind: 'app-server-worker',
      ephemeral_home_path: createRootResult.env.HOME,
      worker_session_id: roleInstanceId,
      worker_nonce: crypto.randomBytes(16).toString('hex'),
      pid: spawnResult.child.pid,
      executable_path: bornProvenance.executableIdentity,
      os_birth_token: bornProvenance.birthToken,
      pgid: bornProvenance.pgid,
      created_at: new Date().toISOString(),
    };
    const bornRecordPath = path.join(registryRepoDir({ repoId: repoDescriptor.repoId }), 'instances', roleInstanceId + '.json');
    try {
      publishBridgeRegistryRecord(bornRecordPath, Buffer.from(canonicalJSONStringify(bornRecord), 'utf8'));
    } catch (err) {
      // Same reasoning as the bornProvenance failure just above.
      ledgerEntry.spawnState = 'BORN';
      shutdown('APP_SERVER_BORN_RECORD_PUBLISH_FAILED');
      return { ok: false };
    }
    // The coordinator's own ledger entry, registered at createRunRoot time,
    // now carries the SAME live child handle and published record this
    // stop timeline's own cleanup pass needs -- never reconstructed from a
    // path.
    ledgerEntry.spawnState = 'BORN';
    ledgerEntry.child = spawnResult.child;
    ledgerEntry.bornRecord = bornRecord;
    if (
      (spawnResult.child.exitCode !== undefined && spawnResult.child.exitCode !== null)
      || (spawnResult.child.signalCode !== undefined && spawnResult.child.signalCode !== null)
    ) {
      onOwnedChildExit();
      return { ok: false };
    }
    return { ok: true, child: spawnResult.child, bornRecord, onOwnedChildExit, ownedChildSpawnedAtMs };
  }

  return Object.freeze({ spawnRoleWorker });
}

module.exports = Object.freeze({ createSupervisorWorkerSpawn });
