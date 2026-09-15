'use strict';

// Extracted behaviorally from runtime-role-lifecycle.cjs: SupervisorExecutionClaim/v1
// -- proof the top-level spawn-gate admitted a supervisor-start action for
// execution -- plus the MainOrchestratorBinding validator/retained-service
// checks it (and its siblings) share. Depends one-way on
// orchestrator-role-bindings.cjs (injected). Never requires the facade.

function createExecutionClaimModule({
  path, fs, crypto, registryRepoDir, readRegistryRecord, ensureSecureRegistryDir,
  publishNoClobber, canonicalJSONStringify, sha256String, isHexActionId, isHexDigest64,
  isCanonicalIsoUtc, isoToMsForRegistry, currentClockMsForRegistry, nowIsoForRegistry,
  resolveSessionGeneration, peekSessionGeneration, readLiveSessionGenerationById,
  IDENTITY_PROVIDER_ENUM, MAX_RUNTIME_SESSION_KEY_BYTES, hasExactKeys, CANONICAL_ROLES,
  computeWorktreeId, discoverPlan, resolvePolicyPair, actionTtlPolicyLimitSeconds,
  validateSupervisorStartAction, isFakeExecutorCapability, isIntInRangeNum, withRegistryLock,
  mainOrchestratorBindingPathFor, MAIN_BINDING_KEYS, createMainOrchestratorBinding,
  MAIN_ORCHESTRATOR_BINDING_HOOK_SCAN_CAP,
}) {
const EXECUTION_CLAIM_SCHEMA = 'runtime/supervisor-execution-claim/v1';
const EXECUTION_CLAIM_KEYS = Object.freeze([
  'action_id', 'canonical_argv_digest', 'created_at', 'execution_state', 'expiry',
  'main_binding_id', 'plan_digest', 'schema', 'session_generation_id', 'worktree_id',
]);

function executionClaimPathFor(projectRootOrRepoId, actionId) {
  return path.join(registryRepoDir(projectRootOrRepoId), 'execution-claims', actionId + '.json');
}

function executionClaimConsumedMarkerPathFor(projectRootOrRepoId, actionId) {
  return path.join(registryRepoDir(projectRootOrRepoId), 'execution-claims', actionId + '.consumed');
}

/**
 * Closed validator for MainOrchestratorBinding/v1 (PLAN.md ~L574): exact
 * nine-key closure, exact schema literal, `runtime` in the frozen provider
 * enum, non-empty `runtime_session_key`/`actor_instance_id`, well-formed
 * `created_at<=expiry` with `created_at` never in the future, not expired,
 * and full scope correlation (binding_id/worktree/plan) against `action`.
 * `session_generation_id` is never stored on the binding (see the section
 * header comment above) -- it is re-derived fresh from the binding's own
 * `(runtime, runtime_session_key)` tuple via `resolveSessionGeneration` and
 * compared against `action.session_generation_id`, so a since-expired or
 * rotated session tuple is caught here rather than against a stale snapshot.
 */
function validateMainOrchestratorBindingFor(repoDescriptor, bindingId, action) {
  // main_binding_id becomes a path segment (mainOrchestratorBindingPathFor) --
  // it must be a safe CSPRNG hex id, NEVER a free-form segment (rejects
  // traversal/absolute-path/symlink-name style forgeries before any fs call).
  if (!isHexActionId(bindingId)) return { ok: false, reason: 'main-binding-id-invalid' };
  const bindingRead = readRegistryRecord(mainOrchestratorBindingPathFor(repoDescriptor, bindingId));
  if (!bindingRead.ok) return { ok: false, reason: bindingRead.reason };
  if (bindingRead.absent) return { ok: false, reason: 'main-binding-absent' };
  const binding = bindingRead.obj;
  if (!binding || !hasExactKeys(binding, MAIN_BINDING_KEYS)) return { ok: false, reason: 'main-binding-shape-mismatch' };
  if (
    binding.schema !== 'runtime/main-orchestrator-binding/v1' || binding.binding_id !== bindingId
    || !IDENTITY_PROVIDER_ENUM.includes(binding.runtime)
    // runtime_session_key is an OPAQUE host-observed value (Claude's
    // session_id, Codex's supervisor_instance_id) -- never guaranteed
    // hex-shaped by design, so it stays a loose non-empty-string check.
    || typeof binding.runtime_session_key !== 'string' || binding.runtime_session_key.length === 0
    // R4 round 2, point 4 (tightened R4 round 3, block 2d): actor_instance_id
    // is crypto-random (32-hex, `isHexActionId`); worktree_id/plan_digest are
    // sha256 DIGESTS (64-hex, `isHexDigest64`) -- distinct contracts, per
    // PLAN.md ~L574, never validated via the SAME loose "32+" check.
    || !isHexActionId(binding.actor_instance_id)
    || !isHexDigest64(binding.worktree_id) || !isHexDigest64(binding.plan_digest)
    || binding.worktree_id !== action.worktree_id || binding.plan_digest !== action.plan_digest
  ) {
    return { ok: false, reason: 'main-binding-shape-mismatch' };
  }
  if (!isCanonicalIsoUtc(binding.created_at) || !isCanonicalIsoUtc(binding.expiry)) {
    return { ok: false, reason: 'main-binding-timestamp-shape-invalid' };
  }
  const createdAtMs = isoToMsForRegistry(binding.created_at);
  const expiryMs = isoToMsForRegistry(binding.expiry);
  if (createdAtMs > expiryMs) {
    return { ok: false, reason: 'main-binding-expiry-invalid' };
  }
  const nowMs = currentClockMsForRegistry();
  if (createdAtMs > nowMs) return { ok: false, reason: 'main-binding-created-in-future' };
  if (nowMs >= expiryMs) return { ok: false, reason: 'main-binding-expired' };
  // Point A.4: lookup-only -- a validation never mints a fresh generation
  // as a side effect of merely checking one.
  const genResult = peekSessionGeneration(repoDescriptor, { provider: binding.runtime, runtime_session_key: binding.runtime_session_key });
  if (!genResult.ok || genResult.generationId !== action.session_generation_id) {
    return { ok: false, reason: 'main-binding-shape-mismatch' };
  }
  return { ok: true, binding };
}

function supervisorRetainedServiceExpiryFromAction(action) {
  const argv = action && action.payload && action.payload.bridge_argv;
  if (!Array.isArray(argv) || argv.length < 2 || argv[argv.length - 2] !== '--session-expiry') return null;
  return argv[argv.length - 1];
}

/**
 * Re-derives the retained supervisor service boundary from both live host
 * authorities. The action argv may carry the value, but never chooses it: it
 * must byte-equal min(MainOrchestratorBinding.expiry, SessionGeneration.expires_at)
 * and remain strictly later than the separate startup/readiness deadline.
 */
function validateRetainedServiceAuthority(repoDescriptor, action, binding) {
  if (!binding || !isCanonicalIsoUtc(binding.expiry)) {
    return { ok: false, reason: 'retained-service-binding-expiry-invalid' };
  }
  const generation = readLiveSessionGenerationById(repoDescriptor, action && action.session_generation_id);
  if (!generation.ok) return { ok: false, reason: 'retained-service-' + generation.reason };
  const sessionExpiry = supervisorRetainedServiceExpiryFromAction(action);
  if (!isCanonicalIsoUtc(sessionExpiry)) return { ok: false, reason: 'retained-service-expiry-invalid' };
  const bindingExpiryMs = isoToMsForRegistry(binding.expiry);
  const generationExpiryMs = isoToMsForRegistry(generation.expiresAt);
  const expectedExpiry = bindingExpiryMs <= generationExpiryMs ? binding.expiry : generation.expiresAt;
  if (sessionExpiry !== expectedExpiry) return { ok: false, reason: 'retained-service-expiry-authority-mismatch' };
  if (!(isoToMsForRegistry(sessionExpiry) > isoToMsForRegistry(action.expires_at))) {
    return { ok: false, reason: 'retained-service-expiry-not-after-action' };
  }
  return { ok: true, expiresAt: sessionExpiry, generation: generation.record };
}

/**
 * Re-derives the live session_generation_id for `binding`'s own tuple and
 * attaches it as a call-local convenience (PLAN.md ~L574's binding is never
 * persisted with this field). Never written back to disk. Lookup-only --
 * never mints a fresh generation as a side effect.
 * @returns {{ok:true}|{ok:false}}
 */
function attachDerivedSessionGenerationId(projectRootOrRepoDescriptor, binding) {
  const genResult = peekSessionGeneration(projectRootOrRepoDescriptor, { provider: binding.runtime, runtime_session_key: binding.runtime_session_key });
  if (!genResult.ok) return { ok: false };
  binding.session_generation_id = genResult.generationId;
  return { ok: true };
}

/**
 * Mints one no-clobber SupervisorExecutionClaim/v1 for a `supervisor-start`
 * action -- proof that the top-level spawn-gate admitted
 * this exact action for execution. THE capability gate lives HERE, at the
 * actual mint point (not merely in the `fakeHostExecutorExecute` wrapper) --
 * a caller reaching this function directly without the double capability is
 * rejected identically to one going through the wrapper. Resolves+validates
 * the referenced MainOrchestratorBinding end to end (existence, exact
 * schema, binding_id/repo/worktree/plan/session correlation, not expired)
 * and bounds the claim's own expiry by `min(action.expires_at,
 * binding.expiry, now+policy.ready_timeout_seconds)` -- never a fixed
 * constant, per the user's own correction.
 * @param {{repoId:string}} repoDescriptor
 * @param {object} action
 * @param {string} mainBindingId
 * @param {number} readyTimeoutSeconds - the resolved policy's own bound; caller resolves it (this function has no `projectRoot` path to resolve policy itself).
 * @returns {{ok:true,claimPath:string,record:object}|{ok:false,reason:string}}
 */
function mintSupervisorExecutionClaim(repoDescriptor, action, mainBindingId, readyTimeoutSeconds) {
  if (!isFakeExecutorCapability()) return { ok: false, reason: 'fake-executor-capability-absent' };
  return mintSupervisorExecutionClaimCore(repoDescriptor, action, mainBindingId, readyTimeoutSeconds);
}

/**
 * M6 GROUP A: the exact post-gate body of `mintSupervisorExecutionClaim`
 * above, extracted so the real production entrypoint
 * (`mintSupervisorExecutionClaimForSession` below, which context-provider-
 * gate.js calls) shares this IDENTICAL validation/mint logic byte-for-byte
 * rather than a second, independently-drifting copy -- `mintSupervisorExecutionClaim`
 * itself stays completely unchanged in behavior/signature for its own
 * existing (fake-executor-capability-gated) callers/tests. This function
 * itself carries NO capability gate of any kind -- callers decide whether a
 * gate applies before ever reaching it.
 * @param {{repoId:string}} repoDescriptor
 * @param {object} action
 * @param {string} mainBindingId
 * @param {number} readyTimeoutSeconds
 * @returns {{ok:true,claimPath:string,record:object}|{ok:false,reason:string}}
 */
function mintSupervisorExecutionClaimCore(repoDescriptor, action, mainBindingId, readyTimeoutSeconds) {
  const actionValidation = validateSupervisorStartAction(action, null);
  if (!actionValidation.ok) return { ok: false, reason: actionValidation.reason };
  if (!Number.isInteger(readyTimeoutSeconds) || readyTimeoutSeconds < 1) return { ok: false, reason: 'ready-timeout-seconds-invalid' };

  const bindingResult = validateMainOrchestratorBindingFor(repoDescriptor, mainBindingId, action);
  if (!bindingResult.ok) return { ok: false, reason: bindingResult.reason };
  const retainedAuthority = validateRetainedServiceAuthority(repoDescriptor, action, bindingResult.binding);
  if (!retainedAuthority.ok) return retainedAuthority;

  const nowMs = currentClockMsForRegistry();
  const actionExpiryMs = isoToMsForRegistry(action.expires_at);
  const bindingExpiryMs = isoToMsForRegistry(bindingResult.binding.expiry);
  const policyBoundMs = nowMs + readyTimeoutSeconds * 1000;
  const expiryMs = Math.min(actionExpiryMs, bindingExpiryMs, policyBoundMs);
  if (!(expiryMs > nowMs)) return { ok: false, reason: 'no-positive-ttl-remaining' };

  const claimPath = executionClaimPathFor(repoDescriptor, action.action_id);
  const dirResult = ensureSecureRegistryDir(path.dirname(claimPath));
  if (!dirResult.ok) return { ok: false, reason: dirResult.reason };
  const record = {
    schema: EXECUTION_CLAIM_SCHEMA,
    action_id: action.action_id,
    main_binding_id: mainBindingId,
    session_generation_id: action.session_generation_id,
    plan_digest: action.plan_digest,
    worktree_id: action.worktree_id,
    canonical_argv_digest: sha256String(canonicalJSONStringify(action.payload.bridge_argv)),
    created_at: nowIsoForRegistry(),
    expiry: new Date(expiryMs).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    execution_state: 'ISSUED',
  };
  if (!hasExactKeys(record, EXECUTION_CLAIM_KEYS)) return { ok: false, reason: 'internal-key-set-mismatch' };
  try {
    publishNoClobber(claimPath, Buffer.from(canonicalJSONStringify(record), 'utf8'), {});
  } catch (err) {
    return { ok: false, reason: 'execution-claim-already-issued' };
  }
  return { ok: true, claimPath, record };
}

// MAIN_ORCHESTRATOR_BINDING_HOOK_SCAN_CAP (injected) bounds
// findLiveMainOrchestratorBindingForSession below -- shared with
// orchestrator-role-bindings.cjs's own findLiveMainOrchestratorBindingForScope,
// which scans the SAME orchestrator-bindings/ directory; owned at facade
// level, never a per-module duplicate.
// Mirrors context-provider-gate.js's own MAIN_ORCHESTRATOR_BINDING_TTL_SECONDS
// rationale exactly (sized so it is never the limiting factor for a
// subsequently-minted claim's own TTL) -- this file cannot import that hook
// constant (hooks are never a library dependency of this module), so it is
// re-declared here under its own name rather than shared.
const SUPERVISOR_HOOK_MAIN_BINDING_TTL_SECONDS = 3600;

/**
 * M6 GROUP A: scans this repo's OWN `orchestrator-bindings/` registry for a
 * CURRENTLY LIVE MainOrchestratorBinding matching the exact (runtime:
 * 'claude-hook', session, worktree, plan) tuple -- mirrors context-provider-
 * gate.js's own `resolveArchitectRequesterBinding` scan-for-one-live-match
 * discipline (applied there to requester-bindings), applied here to this
 * sibling binding type. A session's own live MainOrchestratorBinding is the
 * SAME authority regardless of which earlier caller minted it (e.g. the
 * `ensure` call that originally produced the supervisor-start action being
 * claimed here) -- exactly one live match is reused; zero is reported as
 * `'absent'` (caller mints fresh); more than one is `'ambiguous'` and fails
 * closed (never guesses).
 * @param {{repoId:string}} repoDescriptor
 * @param {string} sessionId
 * @param {string} worktreeId
 * @param {string} planDigest
 * @returns {{ok:true,binding:object}|{ok:false,reason:'absent'|'ambiguous'|string}}
 */
function findLiveMainOrchestratorBindingForSession(repoDescriptor, sessionId, worktreeId, planDigest) {
  const bindingsDir = path.join(registryRepoDir(repoDescriptor), 'orchestrator-bindings');
  let entries;
  try {
    entries = fs.readdirSync(bindingsDir, { withFileTypes: true });
  } catch (err) {
    return { ok: false, reason: 'absent' };
  }
  if (entries.length > MAIN_ORCHESTRATOR_BINDING_HOOK_SCAN_CAP) {
    return { ok: false, reason: 'orchestrator-bindings-registry-overflow' };
  }
  const matches = [];
  for (const entry of entries) {
    if (!entry.isFile() || entry.name.startsWith('.') || !entry.name.endsWith('.json')) continue;
    const candidateId = entry.name.slice(0, -'.json'.length);
    let bindingRead;
    try {
      bindingRead = readRegistryRecord(mainOrchestratorBindingPathFor(repoDescriptor, candidateId));
    } catch {
      // Confirmed by arch-platform (mirrors resolveArchitectRequesterBinding's
      // own Group 2 bullet 4 correction): an unexpected throw is never
      // routine -- fail the WHOLE resolution closed rather than silently
      // treating a candidate as "not a match".
      return { ok: false, reason: 'orchestrator-bindings-registry-malformed' };
    }
    if (!bindingRead.ok) return { ok: false, reason: 'orchestrator-bindings-registry-malformed' };
    if (bindingRead.absent) continue; // benign race: unlinked between readdir and read.
    const binding = bindingRead.obj;
    // Shape/schema/id-path/timestamp-SHAPE corruption is never routine --
    // fails the WHOLE resolution closed, distinct from a well-formed
    // candidate that simply belongs to a different scope (routine, skipped
    // below) or has genuinely expired (also routine, skipped below).
    if (
      !binding || !hasExactKeys(binding, MAIN_BINDING_KEYS)
      || binding.schema !== 'runtime/main-orchestrator-binding/v1'
      || binding.binding_id !== candidateId
      || !isCanonicalIsoUtc(binding.created_at) || !isCanonicalIsoUtc(binding.expiry)
    ) {
      return { ok: false, reason: 'orchestrator-bindings-registry-malformed' };
    }
    if (
      binding.runtime !== 'claude-hook'
      || binding.runtime_session_key !== sessionId
      || binding.worktree_id !== worktreeId
      || binding.plan_digest !== planDigest
    ) continue; // routine scope mismatch -- a different session/worktree/plan's own binding.
    const createdAtMs = isoToMsForRegistry(binding.created_at);
    const expiryMs = isoToMsForRegistry(binding.expiry);
    if (!Number.isFinite(createdAtMs) || !Number.isFinite(expiryMs) || createdAtMs > expiryMs) {
      return { ok: false, reason: 'orchestrator-bindings-registry-malformed' };
    }
    const nowMs = currentClockMsForRegistry();
    if (createdAtMs > nowMs) return { ok: false, reason: 'orchestrator-bindings-registry-malformed' };
    if (nowMs >= expiryMs) continue; // routine expiry -- skippable.
    matches.push(binding);
  }
  if (matches.length === 0) return { ok: false, reason: 'absent' };
  // Confirmed by arch-platform: more than one live match fails closed,
  // never guesses -- mirrors resolveArchitectRequesterBinding's own
  // ambiguous-bindings precedent and this file's own locked-in
  // GROUP2-CASE7 discipline (two exactly-matching live bindings for the
  // identical scope must remain ambiguous, never silently pick one).
  if (matches.length > 1) return { ok: false, reason: 'ambiguous' };
  return { ok: true, binding: matches[0] };
}

function mainOrchestratorBindingLookupLockDirFor(repoDescriptor, sessionId, worktreeId, planDigest) {
  const key = sha256String(
    'main-orchestrator-binding-lookup-v1:claude-hook:' + sessionId + ':' + worktreeId + ':' + planDigest
  );
  return path.join(registryRepoDir(repoDescriptor), 'orchestrator-binding-locks', key + '.lock');
}

/**
 * Atomic lookup-or-create for the hook-observed Claude main context. A
 * lifecycle session owns one live MainOrchestratorBinding for the exact
 * {runtime,session,worktree,PLAN} tuple, regardless of how many distinct
 * lifecycle commands it issues. This is deliberately separate from
 * createMainOrchestratorBinding(), whose low-level fresh-record semantics are
 * retained for explicit fixtures and draft->final rebind machinery.
 *
 * The per-tuple lock closes both the sequential probe/status/ensure collision
 * and parallel PreToolUse races. Existing multiple live matches remain a
 * fail-closed ambiguity; this function never guesses or silently retires a
 * record it did not create inside this critical section.
 *
 * @returns {{ok:true,binding:object}|{ok:false,reason:string}}
 */
function getOrCreateMainOrchestratorBindingForSession(repoDescriptor, sessionId, worktreeId, planDigest, ttlSeconds) {
  if (typeof sessionId !== 'string' || sessionId.length === 0 || Buffer.byteLength(sessionId, 'utf8') > MAX_RUNTIME_SESSION_KEY_BYTES) {
    return { ok: false, reason: 'session-id-invalid' };
  }
  if (!isHexDigest64(worktreeId)) return { ok: false, reason: 'invalid-worktree-id' };
  if (!isHexDigest64(planDigest)) return { ok: false, reason: 'invalid-plan-digest' };
  if (!isIntInRangeNum(ttlSeconds, 1, Number.MAX_SAFE_INTEGER)) return { ok: false, reason: 'invalid-ttl' };

  const identity = { ok: true, provider: 'claude-hook', runtime_session_key: sessionId };
  const lockDir = mainOrchestratorBindingLookupLockDirFor(repoDescriptor, sessionId, worktreeId, planDigest);
  const locked = withRegistryLock(lockDir, () => {
    // Re-resolve the backing generation inside the same critical section;
    // binding reuse is meaningless after generation expiry/rotation.
    const generation = resolveSessionGeneration(repoDescriptor, identity);
    if (!generation.ok) return { ok: false, reason: generation.reason };

    const existing = findLiveMainOrchestratorBindingForSession(repoDescriptor, sessionId, worktreeId, planDigest);
    if (existing.ok) return existing;
    if (existing.reason !== 'absent') return existing;
    return createMainOrchestratorBinding(repoDescriptor, identity, worktreeId, planDigest, ttlSeconds);
  // Windows ACL application can make each registry write materially slower
  // than on POSIX. Allow the five concurrent role hooks to serialize without
  // spuriously failing a valid identity admission.
  }, { maxWaitMs: 10000 });
  if (!locked.ok) return { ok: false, reason: locked.reason };
  return locked.value;
}

/**
 * M6 GROUP A: the REAL production, host-private entrypoint context-provider-
 * gate.js calls -- NO capability gate, NO CLI surface, NO caller-selected
 * binding id: the binding is resolved entirely from the CURRENT environment
 * (`projectRoot`/`sessionId`, hook-observed, never from `action`), reused
 * via `findLiveMainOrchestratorBindingForSession` or freshly minted via
 * `createMainOrchestratorBinding`. Since the binding's own worktree/plan are
 * the CURRENT real values, `mintSupervisorExecutionClaimCore`'s own
 * cross-check against `action` naturally rejects any tamper mismatch.
 * @returns {{ok:true,claimPath:string,record:object}|{ok:false,reason:string}}
 */
function mintSupervisorExecutionClaimForSession(repoDescriptor, action, projectRoot, sessionId) {
  if (typeof sessionId !== 'string' || sessionId.length === 0) return { ok: false, reason: 'session-id-invalid' };

  const actionValidation = validateSupervisorStartAction(action, projectRoot);
  if (!actionValidation.ok) return { ok: false, reason: actionValidation.reason };

  let worktreeId;
  let planResult;
  try {
    worktreeId = computeWorktreeId(projectRoot);
    planResult = discoverPlan(projectRoot);
  } catch (err) {
    return { ok: false, reason: 'scope-resolution-failed' };
  }
  if (!planResult.ok) return { ok: false, reason: 'plan-not-discoverable' };

  const bindingResult = getOrCreateMainOrchestratorBindingForSession(
    repoDescriptor, sessionId, worktreeId, planResult.planDigest, SUPERVISOR_HOOK_MAIN_BINDING_TTL_SECONDS
  );
  if (!bindingResult.ok) return { ok: false, reason: 'main-binding-resolution-' + bindingResult.reason };
  const mainBindingId = bindingResult.binding.binding_id;

  const policyPair = resolvePolicyPair(projectRoot);
  if (!policyPair.ok) return { ok: false, reason: 'policy-invalid' };
  const readyTimeoutSeconds = Math.min(policyPair.policy.ready_timeout_seconds, 120);

  return mintSupervisorExecutionClaimCore(repoDescriptor, action, mainBindingId, readyTimeoutSeconds);
}

/**
 * Validates+atomically-consumes the execution claim for `action.action_id`
 * against the exact expected scope -- `session-run`'s own gate BEFORE any
 * OTHER registry write. Every field is checked independently and fails
 * closed: exact key-set closure, schema, `execution_state==='ISSUED'`,
 * action/session/plan/worktree/argv correlation, finite ISO timestamps with
 * `created_at<=expiry`, and a FULL independent re-resolution of the
 * referenced MainOrchestratorBinding (never merely trusting the claim's own
 * recorded fields) -- a missing/forged/expired/cross-scope binding is
 * rejected before consumption. Consumption uses the same no-clobber
 * `.consumed`-marker idiom as `lifecycle-command-grant` so a replayed
 * `session-run` for the same action collides EEXIST.
 * @param {{repoId:string}} repoDescriptor
 * @param {object} action
 * @param {string} expectedArgvDigest - sha256(canonicalJSONStringify(the FULL bridge_argv this session-run process actually received)).
 * @returns {{ok:true,claim:object}|{ok:false,reason:string}}
 */
function validateAndConsumeExecutionClaim(repoDescriptor, action, expectedArgvDigest, projectRoot) {
  const actionValidation = validateSupervisorStartAction(action, projectRoot);
  if (!actionValidation.ok) return { ok: false, reason: actionValidation.reason };

  const claimRead = readRegistryRecord(executionClaimPathFor(repoDescriptor, action.action_id));
  if (!claimRead.ok) return { ok: false, reason: claimRead.reason };
  if (claimRead.absent) return { ok: false, reason: 'execution-claim-absent' };
  const claim = claimRead.obj;

  if (!hasExactKeys(claim, EXECUTION_CLAIM_KEYS)) return { ok: false, reason: 'execution-claim-key-set-invalid' };
  if (claim.schema !== EXECUTION_CLAIM_SCHEMA) return { ok: false, reason: 'execution-claim-schema-invalid' };
  if (claim.execution_state !== 'ISSUED') return { ok: false, reason: 'execution-claim-not-issued' };
  if (typeof claim.action_id !== 'string' || claim.action_id !== action.action_id) return { ok: false, reason: 'execution-claim-action-id-mismatch' };
  if (claim.session_generation_id !== action.session_generation_id) return { ok: false, reason: 'execution-claim-session-mismatch' };
  if (claim.plan_digest !== action.plan_digest) return { ok: false, reason: 'execution-claim-plan-mismatch' };
  if (claim.worktree_id !== action.worktree_id) return { ok: false, reason: 'execution-claim-worktree-mismatch' };
  if (claim.canonical_argv_digest !== expectedArgvDigest) return { ok: false, reason: 'execution-claim-argv-mismatch' };

  const createdAtMs = isoToMsForRegistry(claim.created_at);
  const expiryMs = isoToMsForRegistry(claim.expiry);
  if (!Number.isFinite(createdAtMs) || !Number.isFinite(expiryMs)) return { ok: false, reason: 'execution-claim-timestamp-invalid' };
  if (!(createdAtMs <= expiryMs)) return { ok: false, reason: 'execution-claim-timestamp-order-invalid' };
  const nowMsForClaim = currentClockMsForRegistry();
  if (createdAtMs > nowMsForClaim) return { ok: false, reason: 'execution-claim-created-in-future' };
  if (nowMsForClaim >= expiryMs) return { ok: false, reason: 'execution-claim-expired' };

  // Re-validate expiry against the CURRENT action and policy, not merely the
  // claim's own stored expiry -- a claim minted under a looser policy that has
  // since tightened (or an action whose own expiry has since been shortened)
  // must not outlive its governing bound.
  const actionExpiryMsForClaim = isoToMsForRegistry(action.expires_at);
  if (Number.isFinite(actionExpiryMsForClaim) && expiryMs > actionExpiryMsForClaim) {
    return { ok: false, reason: 'execution-claim-expiry-exceeds-action' };
  }
  const policyPairForClaim = resolvePolicyPair(projectRoot);
  if (!policyPairForClaim.ok) return { ok: false, reason: 'execution-claim-policy-invalid' };
  const policyBoundMsForClaim = createdAtMs + actionTtlPolicyLimitSeconds(policyPairForClaim.policy, {
    kind: action.kind, runtime: action.runtime,
  }) * 1000;
  if (expiryMs > policyBoundMsForClaim) return { ok: false, reason: 'execution-claim-expiry-exceeds-policy' };

  const bindingResult = validateMainOrchestratorBindingFor(repoDescriptor, claim.main_binding_id, action);
  if (!bindingResult.ok) return { ok: false, reason: 'execution-claim-' + bindingResult.reason };
  const retainedAuthority = validateRetainedServiceAuthority(repoDescriptor, action, bindingResult.binding);
  if (!retainedAuthority.ok) return { ok: false, reason: 'execution-claim-' + retainedAuthority.reason };
  // WP3 item C correction pass R3 (point A.2): the claim's own expiry can
  // never exceed the binding's -- independent of "is the binding itself
  // still unexpired right now" (already checked inside
  // validateMainOrchestratorBindingFor), this is "did the claim's OWN
  // recorded lifetime ever legitimately outlive the authority that minted
  // it", re-verified here rather than merely trusted from mint time.
  const bindingExpiryMsForClaim = isoToMsForRegistry(bindingResult.binding.expiry);
  if (!Number.isFinite(bindingExpiryMsForClaim) || expiryMs > bindingExpiryMsForClaim) {
    return { ok: false, reason: 'execution-claim-expiry-exceeds-binding' };
  }

  // Atomic one-use consumption -- LAST, only after every other check passes.
  const dir = path.dirname(executionClaimConsumedMarkerPathFor(repoDescriptor, action.action_id));
  const dirResult = ensureSecureRegistryDir(dir);
  if (!dirResult.ok) return { ok: false, reason: dirResult.reason };
  try {
    publishNoClobber(executionClaimConsumedMarkerPathFor(repoDescriptor, action.action_id), Buffer.from(canonicalJSONStringify({ consumed_at: nowIsoForRegistry() }), 'utf8'), {});
  } catch (err) {
    return { ok: false, reason: 'execution-claim-replay' };
  }
  return { ok: true, claim };
}


  return Object.freeze({
    EXECUTION_CLAIM_SCHEMA, EXECUTION_CLAIM_KEYS, executionClaimPathFor,
    executionClaimConsumedMarkerPathFor, validateMainOrchestratorBindingFor,
    supervisorRetainedServiceExpiryFromAction, validateRetainedServiceAuthority,
    attachDerivedSessionGenerationId, mintSupervisorExecutionClaim, mintSupervisorExecutionClaimCore,
    findLiveMainOrchestratorBindingForSession, getOrCreateMainOrchestratorBindingForSession,
    mintSupervisorExecutionClaimForSession, validateAndConsumeExecutionClaim,
  });
}

module.exports = { createExecutionClaimModule };
