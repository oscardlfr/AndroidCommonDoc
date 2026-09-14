'use strict';

// Extracted behaviorally from runtime-bridge-codex.cjs's
// startOwnedAppServerSupervisorEngine/runStartup: the per-role app-server
// RPC bootstrap sequence -- connection creation, initialize, root
// finalization, login, canonical role profile resolution, the bootstrap
// turn (with its one disposable retry), thread archive, worker-presence
// publication and the retained-worker record itself. Every abandonment
// checkpoint ("shuttingDown || engineStopRequested || Date.now() >=
// startupDeadlineMs") and every shutdown reason string is preserved
// byte-for-byte and in the exact original order. Never requires the facade
// or either sibling facade, directly or transitively.

function createSupervisorRoleBootstrap({
  createAppServerConnection, resolveSessionRunCredentialSource, resolveCanonicalRoleProfile,
  supervisorBootstrapDeveloperInstructions, supervisorBaseInstructions,
  bootstrapTurnTimeoutMs, bootstrapArchiveTimeoutMs, waitForValidatedTurnCompletion,
  describeThreadStartFailure, describeInitializeFailure, captureRegistryTailText,
  publishWorkerPresenceReady, roleProfileDigestFor,
  isShuttingDown, getEngineStopRequested, settleReadyOnStartupFailure, shutdown, fs,
}) {
  function abandonedAtCheckpoint(startupDeadlineMs) {
    if (isShuttingDown() || getEngineStopRequested() || Date.now() >= startupDeadlineMs) {
      settleReadyOnStartupFailure('startup-abandoned-at-checkpoint');
      return true;
    }
    return false;
  }

  async function bootstrapRoleWorker(ctx) {
    const {
      role, roleInstanceId, testBackend, createRootResult, isolationProvider, rootHandle,
      roleReadCapability, readViewRoot, credentialSource, startupDeadlineMs, action, projectRoot,
      supervisorInstanceId, rendezvousInstanceId, waveActivation, coordinationRootReal, repoDescriptor,
      childRegistry, ownedChildRef, stopSignal, registerRawMcpPromise, hasPendingRawMcpPromise,
      child, bornRecord, stderrCapture,
    } = ctx;

    const connection = createAppServerConnection({
      stdin: child.stdin,
      stdout: child.stdout,
      refreshProvider: () => {
        const refreshed = resolveSessionRunCredentialSource(testBackend);
        if (!refreshed.ok) return { ok: false };
        return {
          ok: true,
          accessToken: refreshed.credentials.accessToken,
          chatgptAccountId: refreshed.credentials.chatgptAccountId,
          chatgptPlanType: refreshed.credentials.chatgptPlanType || null,
        };
      },
    });
    const initializeStartedAtMs = Date.now();
    const initResult = await connection.initialize();
    if (abandonedAtCheckpoint(startupDeadlineMs)) return { ok: false };
    if (!initResult || initResult.ok !== true) {
      shutdown(describeInitializeFailure(
        initResult, Date.now() - initializeStartedAtMs, captureRegistryTailText(stderrCapture, 65536),
      ));
      return { ok: false };
    }

    // Finalized only once the child is genuinely BORN and INITIALIZED --
    // the role-bound permissions profile it materializes has no reason to
    // exist before that point.
    const finalizeResult = isolationProvider.finalizeRunRoot(rootHandle, { role, capability: roleReadCapability });
    if (!finalizeResult.ok) {
      shutdown('APP_SERVER_ROOT_FINALIZE_FAILED:' + (finalizeResult.reason || 'unknown'));
      return { ok: false };
    }
    try { fs.chmodSync(readViewRoot, 0o500); } catch (err) {
      shutdown('APP_SERVER_READ_VIEW_HARDEN_FAILED');
      return { ok: false };
    }

    const loginResult = await connection.login({
      accessToken: credentialSource.credentials.accessToken,
      chatgptAccountId: credentialSource.credentials.chatgptAccountId,
      chatgptPlanType: credentialSource.credentials.chatgptPlanType || null,
    });
    if (abandonedAtCheckpoint(startupDeadlineMs)) return { ok: false };
    if (!loginResult || loginResult.ok !== true) {
      shutdown('APP_SERVER_LOGIN_FAILED:' + String((loginResult && loginResult.reason) || 'unknown'));
      return { ok: false };
    }

    // The role's own canonical template bytes as developerInstructions, and
    // the ONE fixed, bounded runtime base contract as baseInstructions.
    const profileResult = resolveCanonicalRoleProfile(role);
    if (!profileResult.ok) {
      shutdown('APP_SERVER_ROLE_PROFILE_UNRESOLVED:'
        + String((profileResult && profileResult.reason) || 'no-reason-reported'));
      return { ok: false };
    }
    const threadStartedAtMs = Date.now();
    const threadResult = await connection.threadStart({
      role, developerInstructions: supervisorBootstrapDeveloperInstructions,
      baseInstructions: supervisorBaseInstructions, cwd: createRootResult.cwd,
    });
    if (abandonedAtCheckpoint(startupDeadlineMs)) return { ok: false };
    if (!threadResult || threadResult.ok !== true) {
      shutdown(describeThreadStartFailure(
        threadResult, Date.now() - threadStartedAtMs, captureRegistryTailText(stderrCapture, 65536),
      ));
      return { ok: false };
    }

    function bootstrapTurnInput() {
      return [
        'Bootstrap the canonical ' + role + ' runtime profile.',
        'Return exactly one JSON object with the sole key envelope, whose value is the requested RuntimeTurnEnvelope terminal ANSWERED result with result_kind role-bootstrap and content READY.',
        'Do not execute tools, write files, emit prose, or request approval.',
      ].join('\n');
    }
    const isValidBootstrapCompletion = (candidate) => Boolean(
      candidate && candidate.ok && candidate.envelope
      && candidate.envelope.kind === 'terminal-result'
      && candidate.envelope.result.status === 'ANSWERED'
      && candidate.envelope.result.result_kind === 'role-bootstrap'
      && candidate.envelope.result.content === 'READY',
    );

    // Bootstrap is a real, bounded model turn, but it is not a synthetic
    // consultation transaction and therefore never writes a scheduler
    // claim/WAL. READY requires the complete turn envelope, not merely a
    // successful turn/start response. The thread is archived immediately
    // afterward so an idle READY worker advertises thread_id:null.
    const bootstrapDeadlineMs = Math.min(startupDeadlineMs - 1000, Date.now() + bootstrapTurnTimeoutMs);
    const turnResult = await connection.turnStart({
      threadId: threadResult.threadId, inputText: bootstrapTurnInput(),
      expectedResultKind: 'role-bootstrap', allowedChildRoles: [], purpose: 'bootstrap-ready', cwd: createRootResult.cwd,
    }, { backendDeadlineMs: bootstrapDeadlineMs });
    if (abandonedAtCheckpoint(startupDeadlineMs)) return { ok: false };
    if (!turnResult || turnResult.ok !== true) {
      shutdown('APP_SERVER_TURN_START_FAILED');
      return { ok: false };
    }

    const bootstrapCompletion = await waitForValidatedTurnCompletion(
      connection, threadResult.threadId, turnResult.turnId,
      'role-bootstrap', [], bootstrapDeadlineMs, undefined, undefined, stopSignal,
    );
    if (abandonedAtCheckpoint(startupDeadlineMs)) return { ok: false };
    let readyThreadResult = threadResult;
    if (!isValidBootstrapCompletion(bootstrapCompletion)) {
      // A completed-but-invalid (or otherwise unsuccessful) first bootstrap
      // turn gets exactly one fresh disposable retry window, still capped
      // by startupDeadlineMs, before this role gives up. The failed thread
      // is archived best-effort only and is never reused for real work.
      try {
        await connection.threadArchive(
          threadResult.threadId, { backendDeadlineMs: bootstrapDeadlineMs, timeoutMs: bootstrapArchiveTimeoutMs },
        );
      } catch (err) { /* best-effort: see comment above */ }
      let retryBootstrapCompletion = null;
      let retryThreadResult = null;
      if (!isShuttingDown() && !getEngineStopRequested() && Date.now() < startupDeadlineMs) {
        const retryBootstrapDeadlineMs = Math.min(startupDeadlineMs - 1000, Date.now() + bootstrapTurnTimeoutMs);
        if (retryBootstrapDeadlineMs > Date.now()) {
          retryThreadResult = await connection.threadStart({
            role, developerInstructions: supervisorBootstrapDeveloperInstructions,
            baseInstructions: supervisorBaseInstructions, cwd: createRootResult.cwd,
          }, { timeoutMs: Math.max(1, retryBootstrapDeadlineMs - Date.now()) });
          if (abandonedAtCheckpoint(startupDeadlineMs)) return { ok: false };
          if (retryThreadResult && retryThreadResult.ok === true) {
            const retryTurnResult = await connection.turnStart({
              threadId: retryThreadResult.threadId, inputText: bootstrapTurnInput(),
              expectedResultKind: 'role-bootstrap', allowedChildRoles: [], purpose: 'bootstrap-ready', cwd: createRootResult.cwd,
            }, { backendDeadlineMs: retryBootstrapDeadlineMs });
            if (abandonedAtCheckpoint(startupDeadlineMs)) return { ok: false };
            if (retryTurnResult && retryTurnResult.ok === true) {
              retryBootstrapCompletion = await waitForValidatedTurnCompletion(
                connection, retryThreadResult.threadId, retryTurnResult.turnId,
                'role-bootstrap', [], retryBootstrapDeadlineMs, undefined, undefined, stopSignal,
              );
              if (abandonedAtCheckpoint(startupDeadlineMs)) return { ok: false };
            }
          }
        }
      }
      if (!isValidBootstrapCompletion(retryBootstrapCompletion)) {
        shutdown('APP_SERVER_BOOTSTRAP_COMPLETION_INVALID');
        return { ok: false };
      }
      readyThreadResult = retryThreadResult;
    }
    // The successful thread may be the RETRY, by which point the original
    // bootstrapDeadlineMs -- fixed before either attempt started -- can
    // already be at or past "now": this archive call needs its own fresh
    // deadline/timeout in that case, never the stale one, still capped by
    // startupDeadlineMs.
    const readyArchiveDeadlineMs = readyThreadResult === threadResult
      ? bootstrapDeadlineMs
      : Math.min(startupDeadlineMs - 1000, Date.now() + bootstrapArchiveTimeoutMs);
    await connection.threadArchive(readyThreadResult.threadId, {
      backendDeadlineMs: readyArchiveDeadlineMs,
      timeoutMs: Math.max(1, Math.min(bootstrapArchiveTimeoutMs, readyArchiveDeadlineMs - Date.now())),
    });
    if (abandonedAtCheckpoint(startupDeadlineMs)) return { ok: false };

    // The retained worker identity itself is the root-ingress authority. A
    // second random actor would make WAL recovery impossible to correlate
    // and would let the bridge accidentally speak as two actors.
    const actorInstanceId = roleInstanceId;
    const capabilityScope = {
      projectRoot, supervisorInstanceId, workerSessionId: roleInstanceId, actorInstanceId, role,
      worktreeId: action.worktree_id, planDigest: action.plan_digest, expiresAt: ctx.p.sessionExpiry,
    };

    // The completed bootstrap thread is already archived; idle is
    // explicitly represented by null.
    const presenceResult = publishWorkerPresenceReady(
      repoDescriptor, role, roleInstanceId, action.worktree_id, null, roleProfileDigestFor(role),
    );
    if (!presenceResult.ok) {
      shutdown('APP_SERVER_PRESENCE_PUBLISH_FAILED');
      return { ok: false };
    }
    const retainedWorkerRecord = {
      role, workerSessionId: roleInstanceId, actorInstanceId, worktreeId: action.worktree_id,
      profileDigest: profileResult.digest, profileBytes: profileResult.bytes, cwd: createRootResult.cwd,
      isolatedHome: createRootResult.env.HOME, projectRoot, readViewRoot, waveSlug: waveActivation.waveSlug,
      connection, bornRecord: Object.freeze(Object.assign({}, bornRecord)), capability: null, capabilityScope,
      // The SAME coordinator-owned registerRawMcpPromise this worker object
      // itself carries -- lets runContextProviderInternalSearch separately
      // retain its own internal operation/close-settlement promises too.
      mcpChildOwnership: { registry: childRegistry, children: ownedChildRef.children, registerPromise: registerRawMcpPromise },
      coordinationRoot: coordinationRootReal, repoDescriptor, repoId: action.repo_id, supervisorInstanceId,
      rendezvousInstanceId, planDigest: action.plan_digest, sessionGenerationId: action.session_generation_id,
      bindingId: null, presenceStartedAt: presenceResult.record.started_at, lastPresenceHeartbeatMs: Date.now(),
      lastLeaseHeartbeatMs: 0, threadId: null, knownRequests: new Set(), queue: [], activePromise: null,
      // The SAME t0 cancellation channel the bootstrap turn above already
      // races -- without this, startAndAwaitWorkerTurn's own
      // waitForValidatedTurnCompletion call always saw `undefined` and a
      // mid-turn retained-worker request could never be genuinely unstuck
      // by a stop, only by its own backend deadline.
      stopSignal, registerRawMcpPromise, hasPendingRawMcpPromise,
    };
    return { ok: true, readyEvidenceEntry: { role, worker_session_id: roleInstanceId }, retainedWorkerRecord };
  }

  return Object.freeze({ bootstrapRoleWorker });
}

module.exports = Object.freeze({ createSupervisorRoleBootstrap });
