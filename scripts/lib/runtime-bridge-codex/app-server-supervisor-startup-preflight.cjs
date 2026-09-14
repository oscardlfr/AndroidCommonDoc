'use strict';

// Extracted behaviorally from runtime-bridge-codex.cjs's
// startOwnedAppServerSupervisorEngine/runStartup: the one-time startup
// context (read-view authority, isolation provider, child registry, stderr
// capture, spawn command resolution) and the per-role root-provisioning
// checkpoint (createRunRoot, ledger registration, read-view root creation).
// Each function either returns {ok:true, ...} or has already called
// `shutdown` itself and returns {ok:false} -- callers must stop on
// {ok:false} without calling shutdown a second time. Never requires the
// facade or either sibling facade, directly or transitively.

function createSupervisorStartupPreflight({
  createSessionRunReadViewAuthority, createIsolationProvider, strictConfigValidatorForSessionRun,
  createSupervisorOwnedChildRegistry, createCaptureRegistry, resolveSessionRunSpawnCommand,
  shutdown, projectRoot, ledger,
}) {
  /** One-time, whole-batch startup context -- constructed once before the per-role loop. */
  function buildStartupContext(testBackend) {
    const readViewAuthority = createSessionRunReadViewAuthority();
    const isolationProvider = createIsolationProvider({
      projectRoot,
      strictConfigValidator: strictConfigValidatorForSessionRun,
      readViewAuthority,
    });
    const childRegistry = createSupervisorOwnedChildRegistry();
    const stderrCapture = createCaptureRegistry();
    const spawnCommand = resolveSessionRunSpawnCommand(testBackend);
    if (!spawnCommand || typeof spawnCommand.command !== 'string' || spawnCommand.command.length === 0) {
      shutdown('APP_SERVER_SPAWN_COMMAND_UNRESOLVED');
      return { ok: false };
    }
    return { ok: true, readViewAuthority, isolationProvider, childRegistry, stderrCapture, spawnCommand };
  }

  /**
   * Allocate/register the private handle/token and mark no-spawn ownership
   * before any creation that can leave a root -- this exact mkdir already
   * succeeded (createRunRoot's own contract) by the time the ledger entry
   * is registered, synchronously, before any later checkpoint/await can
   * orphan it.
   */
  function provisionRoleRoot({
    role, roleInstanceId, repoDescriptor, rendezvousInstanceId, pidIdentity,
    isolationProvider, readViewAuthority, fs, path,
  }) {
    const roleReadCapability = Object.freeze(Object.create(null));
    // pidIdentity is already the SAME requireProvenProcessIdentity()-proven
    // identity cmdSessionRun itself required before anything else, so every
    // field here is already guaranteed non-empty/well-typed.
    const rootOwnerIdentity = { pid: pidIdentity.pid, birthToken: pidIdentity.birth_observed_at, executableIdentity: pidIdentity.executable };
    const createRootResult = isolationProvider.createRunRoot({
      instanceId: roleInstanceId, repoId: repoDescriptor.repoId, runId: rendezvousInstanceId, ownerIdentity: rootOwnerIdentity, role,
    });
    if (!createRootResult.ok) {
      // A durable intent/leaf/topology/config failure inside createRunRoot
      // can still leave a genuine, owned PARTIAL root on disk --
      // createRunRoot itself returns its own already-registered partial
      // handle for exactly that case. The ledger must still learn about it
      // so stage4's NEVER_SPAWNED cleanup authorization can genuinely reap
      // it. A handle is present ONLY once SOME physical leaf state actually
      // exists; a rejection before any mkdir correctly registers no ledger
      // row -- there is genuinely nothing to reap.
      if (createRootResult.handle) {
        ledger.set(roleInstanceId, {
          role, instanceId: roleInstanceId, rootHandle: createRootResult.handle, ownerToken: createRootResult.ownerToken || null,
          spawnState: 'NOT_ATTEMPTED', child: null, bornRecord: null, creationComplete: false,
          stopConfirmed: false,
        });
      }
      shutdown('APP_SERVER_ROOT_PROVISION_FAILED:' + (createRootResult.reason || 'unknown'));
      return { ok: false };
    }
    const rootHandle = createRootResult.handle;
    const ledgerEntry = {
      role, instanceId: roleInstanceId, rootHandle, ownerToken: createRootResult.ownerToken,
      spawnState: 'NOT_ATTEMPTED', child: null, bornRecord: null,
      // True ONLY once stopChild's own stopOwnedAppServerChildBounded call
      // genuinely reports {stopped:true} for THIS exact adopted child --
      // never inferred from a complete BORN identity record alone.
      stopConfirmed: false,
      // Real, per-entry evidence -- true HERE because createRunRoot just
      // returned ok:true for this exact instanceId. Receipts derive their
      // own creation_complete field from THIS, never a hardcoded constant.
      creationComplete: true,
    };
    ledger.set(roleInstanceId, ledgerEntry);
    const readViewRoot = path.join(rootHandle.intendedPath, 'role-read-view');
    try {
      fs.mkdirSync(readViewRoot, { mode: 0o700 });
    } catch (err) {
      shutdown('APP_SERVER_READ_VIEW_ROOT_FAILED');
      return { ok: false };
    }
    const registeredReadView = readViewAuthority.register(roleReadCapability, {
      runId: rendezvousInstanceId, role, readViewRoot,
    });
    if (!registeredReadView.ok) {
      shutdown('APP_SERVER_READ_VIEW_AUTHORITY_FAILED:' + registeredReadView.reason);
      return { ok: false };
    }
    let rootIdentityForSpawn = null;
    try {
      const rootStat = fs.statSync(rootHandle.intendedPath);
      rootIdentityForSpawn = { dev: rootStat.dev, ino: rootStat.ino };
    } catch (err) { /* best-effort -- spawnWithIntent tolerates a null rootIdentity */ }
    return {
      ok: true, roleReadCapability, createRootResult, rootHandle, ledgerEntry, readViewRoot, rootIdentityForSpawn,
    };
  }

  return Object.freeze({ buildStartupContext, provisionRoleRoot });
}

module.exports = Object.freeze({ createSupervisorStartupPreflight });
