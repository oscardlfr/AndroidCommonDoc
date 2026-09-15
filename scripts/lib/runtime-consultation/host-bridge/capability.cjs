'use strict';

function createCapabilityModule(deps) {
  const {
    path,
    CliError,
    GRANT_CANONICAL_ROLES,
    hasExactKeys,
    isHex64,
    isIsoTimestamp,
    isoToMs,
    resolveSealedGitCache,
    gitRevParse,
    realpathOrSelf,
    computeWorktreeId,
    accreditCanonicalRequest,
    resolveActivationForRequestPath,
    resolveAbsolute,
    getRuntimeRoleLifecycle,
    getRuntimeBridgeCodex
  } = deps;

  // ─────────────────────────────────────────────────────────────────────────────
  // Retained Codex host capability (PLAN §15b) -- non-serializable and held only
  // by runtime-bridge-codex.cjs.  The capability object carries no enumerable
  // authority data; its exact scope lives solely in this module-private WeakMap.
  // ─────────────────────────────────────────────────────────────────────────────

  const hostBridgeCapabilityScopes = new WeakMap();
  const hostBridgeCommittedTurnIds = new WeakMap();
  const HOST_BRIDGE_SCOPE_KEYS = Object.freeze([
    'actorInstanceId', 'expiresAt', 'planDigest', 'projectRoot', 'role',
    'supervisorInstanceId', 'workerSessionId', 'worktreeId',
  ].sort());
  const HOST_BRIDGE_ID_RE = /^[a-f0-9]{32}$/;

  // M6+M7 SIXTEENTH CIERRE DEFINITIVO Phase 1 follow-up: requireHostBridgeCapability
  // (hence every rc.hostBridge* call pollRetainedWorkers makes, several times
  // per worker per ~250ms tick) reaches here on EVERY invocation, and this
  // function independently spawns `git rev-parse` twice more (once directly,
  // once again inside computeWorktreeId with the byte-identical
  // '--show-toplevel' args) -- a SEPARATE redundant-git-spawn source from
  // resolveLiveCodexAppServerWorkerUncached's own (already memoized, see
  // runtime-bridge-codex.cjs), not fixed by that change. Measured live (a
  // running retained supervisor's own POLLTICK/worker-start timing dump):
  // per-worker tick time up to ~5s even after that first fix, matching NO-GO
  // Correction B's own historical "~5s for a worker servicing a root-consult
  // intent" figure almost exactly -- this is the remaining source. Same
  // safety argument as that fix: scope.projectRoot's own git worktree
  // toplevel cannot change for the life of this process, so this is a pure,
  // immutable derivation (permitted), memoized once, forever, per distinct
  // projectRoot string -- never a TTL, and never covering discoverPlan (plan
  // CONTENT) or anything about owner/PID/birth/binding/presence/lease, all of
  // which stay fully fresh on every call exactly as before.
  const projectRealOnceForScope = new Map();
  function resolveProjectGitFactsOnceForScope(projectRoot) {
    const sealed = resolveSealedGitCache(projectRealOnceForScope, projectRoot, (root) => {
      const projectReal = gitRevParse(root, ['rev-parse', '--show-toplevel']);
      const gitCommonDirReal = realpathOrSelf(gitRevParse(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']));
      return { ok: true, projectReal, gitCommonDirReal, worktreeId: computeWorktreeId(projectReal) };
    });
    // Preserves this function's pre-existing throw-on-failure contract (its
    // one caller below already wraps it in try/catch) -- a sealed-cache
    // rejection (unresolvable OR a topology-seal mismatch) is exactly as fatal
    // to this caller as the git spawn itself throwing always was.
    if (!sealed.ok) throw new Error(sealed.reason);
    return { projectReal: sealed.derived.projectReal, worktreeId: sealed.derived.worktreeId };
  }

  function validateHostBridgeCapabilityScopeInput(scope, requireLiveWorker) {
    if (!scope || typeof scope !== 'object' || Array.isArray(scope) || !hasExactKeys(scope, HOST_BRIDGE_SCOPE_KEYS)) {
      return { ok: false, reason: 'host-bridge-scope-shape-invalid' };
    }
    if (
      typeof scope.projectRoot !== 'string' || !path.isAbsolute(scope.projectRoot)
      || !GRANT_CANONICAL_ROLES.includes(scope.role)
      || !HOST_BRIDGE_ID_RE.test(scope.supervisorInstanceId)
      || !HOST_BRIDGE_ID_RE.test(scope.workerSessionId)
      || !HOST_BRIDGE_ID_RE.test(scope.actorInstanceId)
      || !isHex64(scope.worktreeId) || !isHex64(scope.planDigest)
      || !isIsoTimestamp(scope.expiresAt) || Date.now() >= isoToMs(scope.expiresAt)
    ) return { ok: false, reason: 'host-bridge-scope-value-invalid' };

    let projectReal;
    let worktreeId;
    let rll;
    try {
      ({ projectReal, worktreeId } = resolveProjectGitFactsOnceForScope(scope.projectRoot));
      rll = getRuntimeRoleLifecycle();
    } catch (err) {
      return { ok: false, reason: 'host-bridge-project-unresolvable' };
    }
    const plan = rll.discoverPlan(projectReal);
    if (!plan.ok) return { ok: false, reason: 'host-bridge-plan-unresolvable' };
    if (
      worktreeId !== scope.worktreeId
      || plan.planDigest !== scope.planDigest
    ) return { ok: false, reason: 'host-bridge-scope-not-current' };
    let live = null;
    if (requireLiveWorker === true) {
      let bridge;
      try {
        bridge = getRuntimeBridgeCodex();
        live = bridge.resolveLiveCodexAppServerWorker(projectReal, scope.role);
      } catch (err) {
        return { ok: false, reason: 'host-bridge-worker-proof-unresolvable' };
      }
      if (!live || live.ok !== true || live.available !== true || !live.worker) {
        return { ok: false, reason: 'host-bridge-worker-not-live:' + ((live && live.reason) || 'unresolved') };
      }
      if (
        live.worker.pid !== process.pid
        || live.worker.worktreeId !== scope.worktreeId
        || live.worker.planDigest !== scope.planDigest
        || live.worker.role !== scope.role
        || live.worker.supervisorInstanceId !== scope.supervisorInstanceId
        || live.worker.workerSessionId !== scope.workerSessionId
      ) return { ok: false, reason: 'host-bridge-worker-process-mismatch' };
    }
    return { ok: true, projectReal, live };
  }

  /**
   * Mints one in-memory-only HostBridgeCapability.  The caller receives an
   * opaque frozen object; JSON/string/argv/disk cannot reconstruct its WeakMap
   * identity.  All transaction methods below revalidate current PLAN/worktree,
   * request/activation/attempt/epoch before invoking the canonical writers.
   */
  function createHostBridgeCapability(scope) {
    // Minting is allowed only inside the exact retained supervisor process
    // corroborated by the live worker proof.  Exporting this factory for the
    // sibling bridge module does not make it an ambient mint primitive for an
    // unrelated Node process that merely knows the public scope fields.
    const validated = validateHostBridgeCapabilityScopeInput(scope, true);
    if (!validated.ok) return validated;
    const capability = Object.freeze(Object.create(null));
    hostBridgeCapabilityScopes.set(capability, Object.freeze(Object.assign({}, scope, { projectRoot: validated.projectReal })));
    return { ok: true, capability };
  }

  // M6+M7 SIXTEENTH CIERRE DEFINITIVO Phase 1 follow-up: rootConsultIntentContext
  // (below) used to call requireHostBridgeCapability for scope, THEN
  // independently re-derive resolveLiveCodexAppServerWorker(scope.projectRoot,
  // scope.role) a few lines later for the EXACT SAME (projectRoot, role) pair
  // -- a second full owner/action/binding/processOwner/presence re-read within
  // the SAME synchronous function, not across operations. Measured live (a
  // running retained supervisor's own POLLTICK timing dump, after the git-
  // facts memoization fixes above): the ONE role servicing an active root-
  // consult intent still took ~5s per tick, versus ~1s for the four roles
  // with no intent to advance -- this redundant re-derivation, repeated across
  // hostBridgeListRootConsultIntents/hostBridgeAdvanceRootConsult/
  // hostBridgeObserveAndCompleteRootConsult each tick, is that remaining cost.
  // This variant returns the SAME live-worker proof requireHostBridgeCapability
  // itself already computed, so a caller that needs it immediately after
  // (rootConsultIntentContext) can pass it along explicitly instead of asking
  // the OS/disk the identical question again a few lines later -- explicit
  // per-operation reuse, never a cache surviving across two DECISIONS.
  // requireHostBridgeCapability's own return shape (bare scope) is unchanged
  // for its many other existing callers.
  function requireHostBridgeCapabilityWithLiveWorker(capability) {
    const scope = hostBridgeCapabilityScopes.get(capability);
    if (!scope) throw new CliError('INVALID', 'AUTHORITY_INVALID', 'unknown HostBridgeCapability');
    const current = validateHostBridgeCapabilityScopeInput(scope, true);
    if (!current.ok) throw new CliError('INVALID', 'AUTHORITY_INVALID', current.reason);
    return { scope, live: current.live };
  }

  function requireHostBridgeCapability(capability) {
    const scope = hostBridgeCapabilityScopes.get(capability);
    if (!scope) throw new CliError('INVALID', 'AUTHORITY_INVALID', 'unknown HostBridgeCapability');
    const current = validateHostBridgeCapabilityScopeInput(scope, true);
    if (!current.ok) throw new CliError('INVALID', 'AUTHORITY_INVALID', current.reason);
    return scope;
  }

  function requireHostBridgeRequestScope(capability, coordRootRaw, requestPathRaw) {
    const scope = requireHostBridgeCapability(capability);
    const coordRoot = resolveAbsolute(coordRootRaw);
    const requestPath = resolveAbsolute(requestPathRaw);
    const accredited = accreditCanonicalRequest(coordRoot, requestPath);
    const reqObj = accredited.obj;
    const resolved = resolveActivationForRequestPath(requestPath);
    if (
      !resolved.ok || !resolved.activation
      || resolved.activation.selected_driver !== 'codex-app-server'
      || resolved.targetRole !== scope.role
      || resolved.worktreeId !== scope.worktreeId
      || resolved.planDigest !== scope.planDigest
      || reqObj.target_role !== scope.role
      || reqObj.target_role_profile_digest !== resolved.activation.target_role_profile_digest
    ) throw new CliError('INVALID', 'AUTHORITY_INVALID', 'HostBridgeCapability does not match the current Codex activation');
    return { scope, coordRoot, requestPath, reqObj, requestDigest: accredited.digest, resolved };
  }


  return {
    HOST_BRIDGE_ID_RE,
    hostBridgeCommittedTurnIds,
    createHostBridgeCapability,
    requireHostBridgeCapabilityWithLiveWorker,
    requireHostBridgeCapability,
    requireHostBridgeRequestScope
  };
}

module.exports = { createCapabilityModule };

