'use strict';

// Extracted behaviorally from runtime-role-lifecycle.cjs: host-private
// RequesterBinding/v1+v2 (the binding role-command-grant/v1's REQUESTER
// authority resolves through). Depends one-way on the Claude authority
// identity/fence primitives (injected, never required directly) and on the
// Claude authority classifier/admission and CLAUDE-ID-01 startup proof
// (also injected) -- never requires the facade or a sibling module, and is
// never itself required by them.

function createRequesterBindingModule({
  path, fs, crypto, registryRepoDir, readRegistryRecord, writeRegistryRecordReplace,
  withRegistryLock, canonicalJSONStringify, resolveSessionGeneration, peekSessionGeneration, sessionGenerationPathFor,
  nowIsoForRegistry, isoPlusSecondsForRegistry, isoToMsForRegistry, currentClockMsForRegistry,
  isCanonicalIsoUtc, isHexActionId, isHexDigest64, isHexCsprng32, hasExactKeys,
  IDENTITY_PROVIDER_ENUM, CANONICAL_ROLES, isIntInRangeNum, sha256String,
  CLAUDE_AUTHORITY_IDENTITY_SCHEMA, resolveM7RepoId, computeClaudeAuthorityIdentityId, readClaudeAuthorityFence,
  classifyClaudeAuthorityForIdentity, checkClaudeAuthorityClassificationAgainstExpected,
  checkClaudeId01ProofComplete, admitClaudeAuthorityOperation, writeGuardedByClaudeAuthorityAdmission,
  testM7Rendezvous,
  // These four are pure, side-effect-free constants a sibling module
  // (claudeAuthorityClassifier) also needs BEFORE this module itself can be
  // composed (it needs classifyClaudeAuthorityForIdentity, produced BY that
  // classifier) -- so the facade declares them once, early, and injects the
  // SAME frozen values here rather than this module declaring a second copy.
  REQUESTER_BINDING_SCHEMA, REQUESTER_BINDING_KEYS, REQUESTER_BINDING_SCHEMA_V2,
  REQUESTER_BINDING_KEYS_V2, REQUESTER_BINDING_SCAN_CAP,
}) {
// ─────────────────────────────────────────────────────────────────────────────
// M7/WP4 second-pass correction (PLAN.md §15, ~L578): Host-private requester
// binding (`requester-binding/v1`) -- the binding role-command-grant/v1's
// REQUESTER authority resolves through. Deliberately NOT
// MainOrchestratorBinding/v1: PLAN.md ~L594 is explicit -- "It is not a
// RequesterIdentityProvider peer binding, has no canonical role, ... cannot
// mint role-command-grant/v1." Deliberately NOT RoleActorBinding/v1 either:
// that type is target-scoped (its own section header above: production
// issuer is subagent-start-context-bundle.js; runtime-consultation-
// target-gate.js resolves/validates it) and requires a canonical role,
// which the main orchestrator (empty agent_type) never has -- and
// PLAN.md ~L590's RequesterIdentityProvider must resolve for the main
// orchestrator too (confirmed empirically by this pass's own
// RCG-ADMIN-ROOTINIT-ROUNDTRIP/RQ1 tests, both issued by agent_type:'').
//
// Claude-hook requester bindings are gated on the current generation's
// CLAUDE-ID-01 runtime capability both when minted and whenever read. The
// capability is established only from the full action-correlated primary
// sequence plus a distinct same-role peer; Codex-supervisor bindings use
// their retained supervisor identity instead. The main orchestrator has no
// canonical role and therefore cannot mint this binding type.
// ─────────────────────────────────────────────────────────────────────────────

// REQUESTER_BINDING_SCHEMA(_V2)/REQUESTER_BINDING_KEYS(_V2)/REQUESTER_BINDING_SCAN_CAP
// are injected (see the factory's own param-list comment above).

function requesterBindingPathFor(projectRootOrRepoDescriptor, bindingId) {
  return path.join(registryRepoDir(projectRootOrRepoDescriptor), 'requester-bindings', bindingId + '.json');
}

/**
 * M6+M7 requester-authority closure (Group A): the deterministic per-exact-
 * tuple lock `createRequesterBinding`'s own lookup-or-create critical section
 * runs under. Keyed by a hash of the FULL identity+scope tuple (never used as
 * the authorizing identity itself, purely a lookup/serialization key -- same
 * discipline as `sessionLookupKey` above) so two calls for the identical
 * tuple -- sequential or genuinely concurrent, single process or racing
 * separate processes -- always serialize against the SAME lock directory,
 * while two calls for DIFFERENT tuples never contend. Deliberately a
 * SEPARATE top-level registry namespace from `requester-bindings/` itself
 * (never nested inside it) so this lock directory can never be picked up by
 * that directory's own enumeration below.
 */
function requesterBindingLookupLockDirFor(projectRoot, identity, agentKey, role, worktreeId, planDigest) {
  const key = sha256String(
    'requester-binding-lookup-v1:' + identity.provider + ':' + identity.runtime_session_key + ':'
    + agentKey + ':' + role + ':' + worktreeId + ':' + planDigest
  );
  return path.join(registryRepoDir(projectRoot), 'requester-binding-locks', key + '.lock');
}

/**
 * Windows performs an owner/ACL confinement check while each process holds
 * this cross-process lock. Under ordinary host contention that check can take
 * longer than the POSIX-local 2 s budget, even though the holder is healthy.
 * Keep POSIX fail-fast behavior and give Windows the same bounded allowance as
 * the supervisor's other ACL-backed cross-process transaction.
 */
function requesterBindingContentionBudgetMs() {
  return process.platform === 'win32' ? 30_000 : 2_000;
}

/**
 * Atomic lookup-or-create for RequesterBinding/v1 (PLAN.md ~L578, ~L592:
 * "The host atomically creates/looks up this mapping from validated runtime
 * input... Same tuple+PLAN+worktree returns the same live binding (including
 * wake); tuple/PLAN/worktree/role/expiry change mints a new instance.").
 * @param {string} projectRoot
 * @param {{ok:true,provider:string,runtime_session_key:string}} identity
 * @param {string} agentKey - the observed agent_id (PLAN.md ~L578
 *   "runtime/runtime_session_key/agent_key" tuple). M6+M7 requester-authority
 *   closure (Group A): MUST be a genuinely non-empty string -- the ONLY
 *   caller that legitimately carried an empty agent_id (the main
 *   orchestrator) is already structurally excluded before ever reaching this
 *   function (see the `role` param doc below), so an empty string here is
 *   never a legitimate case, only a caller bug.
 * @param {string} role - a single canonical role. M7 completeness (2026-08-09):
 *   NEVER null -- the main-orchestrator/null-role path is removed. PLAN.md
 *   ~L588's CLAUDE-ID-01 gate makes persistent native-hook requester-binding
 *   creation unavailable for the main orchestrator by construction (it never
 *   receives a SubagentStart about itself, and CLAUDE-ID-01's own
 *   correlation trace requires one); the sole caller of this function
 *   (context-provider-gate.js's tryInjectRequesterGrant) now excludes
 *   agent_type==='' before ever reaching here, so a real canonical role is
 *   always supplied. Kept as a hard validation (not merely a caller
 *   convention) so a null role is rejected here too, never silently
 *   tolerated by a future caller that forgets the exclusion.
 * @param {string} worktreeId
 * @param {string} planDigest
 * @param {number} ttlSeconds - the ceiling for a freshly-MINTED binding only;
 *   also capped to the backing session generation's own remaining lifetime
 *   (a requester binding must never legitimately outlive the session
 *   identity that justified minting it). Ignored when an existing live
 *   binding is reused -- its own already-durable expiry stands.
 * @returns {{ok:true,binding:object}|{ok:false,reason:string}}
 */
function createRequesterBinding(projectRoot, identity, agentKey, role, worktreeId, planDigest, ttlSeconds) {
  if (!CANONICAL_ROLES.includes(role)) return { ok: false, reason: 'invalid-role' };
  if (!isHexDigest64(worktreeId)) return { ok: false, reason: 'invalid-worktree-id' };
  if (!isHexDigest64(planDigest)) return { ok: false, reason: 'invalid-plan-digest' };
  if (typeof agentKey !== 'string' || agentKey.length === 0) return { ok: false, reason: 'invalid-agent-key' };
  // No ceiling bound here -- unlike RoleActorBinding (bounded by its own
  // ROLE_ACTOR_BINDING_TTL_CEILING_SECONDS, a genuinely persistent
  // support-plane concept) or a role-spawn/rebind ACTION (bounded by
  // ACTION_TTL_CEILING_SECONDS), RequesterBinding is used the SAME way
  // MainOrchestratorBinding is (a long-lived, hook-observed session
  // identity; createMainOrchestratorBinding itself has no ttl ceiling check
  // at all), so only a positive integer is required here.
  if (!isIntInRangeNum(ttlSeconds, 1, Number.MAX_SAFE_INTEGER)) return { ok: false, reason: 'invalid-ttl' };

  const lockDir = requesterBindingLookupLockDirFor(projectRoot, identity, agentKey, role, worktreeId, planDigest);
  const lockResult = withRegistryLock(lockDir, () => {
    // The binding's lifecycle is meaningless without a live session generation
    // for this identity tuple -- mirrors createMainOrchestratorBinding exactly
    // (and gives this constructor the SAME internal failure surface, e.g. a
    // tampered `sessions/` registry directory). Re-resolved under THIS lock so
    // a concurrent caller can never observe a torn/partial generation.
    const genResult = resolveSessionGeneration(projectRoot, identity);
    if (!genResult.ok) return { ok: false, reason: genResult.reason };

    // Boundedly enumerate every existing binding record and reuse the SINGLE
    // live exact match; mint on zero; fail closed on ambiguity (more than one
    // live exact match, or a `.json` record so malformed it cannot be safely
    // classified as matching or not -- a skip-on-malformed policy here could
    // let a corrupted/forged record hide a genuine duplicate).
    const bindingsDir = path.join(registryRepoDir(projectRoot), 'requester-bindings');
    let entries;
    try {
      entries = fs.readdirSync(bindingsDir, { withFileTypes: true });
    } catch (err) {
      entries = []; // no registry directory yet -- routine, zero existing bindings.
    }
    if (entries.length > REQUESTER_BINDING_SCAN_CAP) {
      return { ok: false, reason: 'requester-binding-registry-overflow' };
    }
    const liveMatches = [];
    for (const entry of entries) {
      if (!entry.isFile() || entry.name.startsWith('.') || !entry.name.endsWith('.json')) continue;
      const candidateId = entry.name.slice(0, -'.json'.length);
      const candidateResult = validateRequesterBindingFor(projectRoot, candidateId, role, worktreeId, planDigest);
      if (candidateResult.ok) {
        const binding = candidateResult.binding;
        if (
          binding.runtime === identity.provider
          && binding.runtime_session_key === identity.runtime_session_key
          && binding.agent_key === agentKey
        ) {
          liveMatches.push(binding);
          continue;
        }
        // A different runtime_session_key is a different exact tuple. PLAN
        // requires a fresh binding for it; an agent_key is not globally unique
        // across independent sessions and must never be treated as a collision.
        continue;
      }
      if (
        candidateResult.reason === 'requester-binding-scope-mismatch'
        || candidateResult.reason === 'requester-binding-expired'
        || candidateResult.reason === 'requester-binding-absent'
        // M6+M7 FINAL AUTHORITY CORRECTION (agent_id binding closure): a
        // structurally well-formed OTHER binding whose backing CLAUDE-ID-01
        // attestation is no longer proof-complete (e.g. its {session,
        // worktree,plan,role} slot has since been overwritten by a genuinely
        // different peer's fresh trace, per
        // recordClaudeId01SubagentStartObservation's own begin-fresh-on-
        // different-agent handling) is no longer LIVE -- routine and
        // skippable, exactly like an expired one, never registry corruption.
        || candidateResult.reason === 'requester-binding-claude-id01-unproven'
        // M7 section 4.4: a well-formed legacy v1 record is a stale
        // diagnostic, never a candidate and never registry corruption.
        || candidateResult.reason === 'requester-binding-legacy-v1'
        // M7 section 5 point 4: a fenced binding is real but no longer
        // authoritative -- routine and skippable, exactly like an expired
        // one, never registry corruption.
        || candidateResult.reason === 'authority-fenced'
        || candidateResult.reason === 'requester-binding-generation-mismatch'
      ) {
        continue; // not malformed -- a different-tuple, stale, or no-longer-proven record, routine.
      }
      return { ok: false, reason: 'requester-binding-registry-malformed' };
    }
    if (liveMatches.length > 1) {
      return { ok: false, reason: 'requester-binding-ambiguous' };
    }
    if (liveMatches.length === 1) {
      const reuseBinding = liveMatches[0];
      // M7 CORRECTION C5 (Codex final ruling): for claude-hook identities
      // only, run the canonical cross-family classifier before returning a
      // requester-only reuse -- reuse succeeds only for an exact
      // ONE/requester/matching-binding classification; FENCED, error,
      // foreign family, or ambiguity denies. codex-supervisor identities
      // keep their existing, unchanged retained-host proof path (M7 defect
      // 11: the Claude fence/classifier/admission path applies ONLY to a
      // claude-hook identity).
      if (identity.provider === 'claude-hook') {
        const reuseAuthorityIdentity = {
          schema: CLAUDE_AUTHORITY_IDENTITY_SCHEMA, provider: 'claude-hook',
          repo_id: resolveM7RepoId(projectRoot), runtime_session_key: identity.runtime_session_key, agent_id: agentKey,
        };
        const reuseClassification = classifyClaudeAuthorityForIdentity(projectRoot, reuseAuthorityIdentity);
        if (!reuseClassification.ok) return reuseClassification;
        const reuseCheck = checkClaudeAuthorityClassificationAgainstExpected(reuseClassification, { state: 'ONE', family: 'requester', bindingId: reuseBinding.binding_id });
        if (!reuseCheck.ok) return reuseCheck;
      }
      return { ok: true, binding: reuseBinding };
    }

    // M6+M7 FINAL AUTHORITY CORRECTION (agent_id binding closure): about to
    // mint a genuinely NEW claude-hook binding -- require the CLAUDE-ID-01
    // attestation for this exact tuple (including agentKey) to be
    // proof-complete first. Never gates a codex-supervisor identity
    // (CLAUDE-ID-01 is a Claude-hook-specific capability probe).
    if (identity.provider === 'claude-hook') {
      const claudeId01Result = checkClaudeId01ProofComplete(projectRoot, identity.runtime_session_key, worktreeId, planDigest, role, agentKey);
      if (!claudeId01Result.ok) {
        if (claudeId01Result.reason === 'claude-id01-actor-fenced') {
          return { ok: false, reason: 'authority-fenced' };
        }
        return { ok: false, reason: 'requester-binding-claude-id01-unproven' };
      }
    }

    // M7 section 7 / section 8.1 steps 2-4: obtain create-binding admission
    // through the canonical classifier's full final predicate pass -- a
    // durably-fenced identity is rejected here, cut-first. M7 defect 11: the
    // Claude fence/classifier/admission path applies ONLY to a claude-hook
    // identity -- a codex-supervisor identity keeps its existing retained-host
    // proof path completely untouched (contract section 4.1/12), including
    // zero read of any Claude fence file for it.
    const bindingId = crypto.randomBytes(16).toString('hex');
    const nowStr = nowIsoForRegistry();
    let expiry = isoPlusSecondsForRegistry(nowStr, ttlSeconds);
    const sessGenRead = readRegistryRecord(sessionGenerationPathFor(projectRoot, identity));
    if (sessGenRead.ok && !sessGenRead.absent && sessGenRead.obj && isCanonicalIsoUtc(sessGenRead.obj.expires_at)) {
      if (isoToMsForRegistry(sessGenRead.obj.expires_at) < isoToMsForRegistry(expiry)) {
        expiry = sessGenRead.obj.expires_at;
      }
    }
    const binding = {
      schema: REQUESTER_BINDING_SCHEMA_V2,
      binding_id: bindingId,
      runtime: identity.provider,
      runtime_session_key: identity.runtime_session_key,
      agent_key: agentKey,
      actor_instance_id: crypto.randomBytes(16).toString('hex'),
      role,
      worktree_id: worktreeId,
      plan_digest: planDigest,
      session_generation_id: genResult.generationId,
      created_at: nowStr,
      expiry,
    };
    const bindingPath = requesterBindingPathFor(projectRoot, bindingId);
    const publishBinding = () => writeRegistryRecordReplace(bindingPath, Buffer.from(canonicalJSONStringify(binding), 'utf8'));

    if (identity.provider !== 'claude-hook') {
      const writeResult = publishBinding();
      if (!writeResult.ok) return { ok: false, reason: writeResult.reason };
      return { ok: true, binding };
    }

    const authorityIdentity = {
      schema: CLAUDE_AUTHORITY_IDENTITY_SCHEMA, provider: identity.provider,
      repo_id: resolveM7RepoId(projectRoot), runtime_session_key: identity.runtime_session_key, agent_id: agentKey,
    };
    const admission = admitClaudeAuthorityOperation(projectRoot, authorityIdentity, 'create-binding', expiry);
    if (!admission.ok) return { ok: false, reason: admission.reason };
    const authorityIdentityId = admission.capability.authorityIdentityId;
    testM7Rendezvous('create-after-admission-before-write', projectRoot);
    const writeResult = writeGuardedByClaudeAuthorityAdmission(admission.capability, 'create-binding', publishBinding);
    if (!writeResult.ok) return { ok: false, reason: writeResult.reason };
    // M7 section 7 / defect 4 (GREEN section 4.2): rerun the full predicate
    // -- the cross-family classifier, not just the fence -- after the write
    // and before returning success. A fence OR a concurrent conflicting/
    // ambiguous write that lands during the admission-to-write window must
    // still deny the operation, leaving only the already-written record as
    // an inert artifact (RED: M7-REQUESTER-CREATE-RACE-CROSS-FAMILY-AMBIGUOUS,
    // admission-first race variant).
    const postClassification = classifyClaudeAuthorityForIdentity(projectRoot, authorityIdentity);
    if (!postClassification.ok) return postClassification;
    const postCheck = checkClaudeAuthorityClassificationAgainstExpected(postClassification, { state: 'ONE', family: 'requester', bindingId });
    if (!postCheck.ok) return postCheck;
    return { ok: true, binding };
  }, { maxWaitMs: requesterBindingContentionBudgetMs() });
  if (!lockResult.ok) return { ok: false, reason: lockResult.reason };
  return lockResult.value;
}

/**
 * Closed validator for RequesterBinding/v1, structurally parallel to
 * `validateRoleActorBindingFor`: exact key-set closure, exact schema
 * literal, path<->field id correlation, hex-shaped id fields, canonical-ISO-
 * UTC timestamps with created_at<=expiry and never in the future, not
 * expired, and scope correlation against the caller's expected
 * role/worktree/plan.
 * @param {string|{repoId:string}} repoDescriptor
 * @param {string} bindingId
 * @param {string} expectedRole - never null (M7 completeness).
 * @param {string} expectedWorktreeId
 * @param {string} expectedPlanDigest
 * @returns {{ok:true,binding:object}|{ok:false,reason:string}}
 */
function validateRequesterBindingFor(repoDescriptor, bindingId, expectedRole, expectedWorktreeId, expectedPlanDigest) {
  if (!isHexActionId(bindingId)) return { ok: false, reason: 'requester-binding-id-invalid' };
  const bindingRead = readRegistryRecord(requesterBindingPathFor(repoDescriptor, bindingId));
  if (!bindingRead.ok) return { ok: false, reason: 'requester-binding-read-failed:' + bindingRead.reason };
  if (bindingRead.absent) return { ok: false, reason: 'requester-binding-absent' };
  const binding = bindingRead.obj;
  // M7 section 4.4: exact well-formed v1 is LEGACY_STALE, never a backing or
  // candidate -- recognized and reported distinctly from a genuinely
  // malformed record (reason below is on the createRequesterBinding scan's
  // own routine-skip allowlist, unlike -shape-invalid/-schema-invalid).
  if (binding && hasExactKeys(binding, REQUESTER_BINDING_KEYS) && binding.schema === REQUESTER_BINDING_SCHEMA) {
    return { ok: false, reason: 'requester-binding-legacy-v1' };
  }
  if (!binding || !hasExactKeys(binding, REQUESTER_BINDING_KEYS_V2)) return { ok: false, reason: 'requester-binding-shape-invalid' };
  if (binding.schema !== REQUESTER_BINDING_SCHEMA_V2) return { ok: false, reason: 'requester-binding-schema-invalid' };
  if (binding.binding_id !== bindingId) return { ok: false, reason: 'requester-binding-id-path-mismatch' };
  if (!isHexActionId(binding.actor_instance_id)) return { ok: false, reason: 'requester-binding-shape-invalid' };
  // M7 completeness: role is NEVER null (see createRequesterBinding's own
  // doc comment -- the main-orchestrator/null-role path is removed).
  if (!CANONICAL_ROLES.includes(binding.role)) return { ok: false, reason: 'requester-binding-shape-invalid' };
  if (!isHexDigest64(binding.worktree_id) || !isHexDigest64(binding.plan_digest)) return { ok: false, reason: 'requester-binding-shape-invalid' };
  if (typeof binding.runtime_session_key !== 'string' || binding.runtime_session_key.length === 0) return { ok: false, reason: 'requester-binding-shape-invalid' };
  // M6+M7 requester-authority closure (Group D follow-up): agent_key must be
  // a genuinely non-empty string -- the main-orchestrator/empty-agentKey
  // path is removed (see createRequesterBinding's own doc comment). Checked
  // again HERE, at read time, so a forged or legacy durable record with
  // agent_key:"" written directly to disk is rejected on READ too, never
  // only at construction.
  if (typeof binding.agent_key !== 'string' || binding.agent_key.length === 0) return { ok: false, reason: 'requester-binding-shape-invalid' };
  if (!IDENTITY_PROVIDER_ENUM.includes(binding.runtime)) return { ok: false, reason: 'requester-binding-shape-invalid' };
  if (!isHexCsprng32(binding.session_generation_id)) return { ok: false, reason: 'requester-binding-shape-invalid' };
  if (!isCanonicalIsoUtc(binding.created_at) || !isCanonicalIsoUtc(binding.expiry)) return { ok: false, reason: 'requester-binding-timestamp-shape-invalid' };
  const createdAtMs = isoToMsForRegistry(binding.created_at);
  const expiryMs = isoToMsForRegistry(binding.expiry);
  if (!Number.isFinite(createdAtMs) || !Number.isFinite(expiryMs) || createdAtMs > expiryMs) {
    return { ok: false, reason: 'requester-binding-timestamp-invalid' };
  }
  const nowMs = currentClockMsForRegistry();
  if (createdAtMs > nowMs) return { ok: false, reason: 'requester-binding-created-in-future' };
  if (nowMs >= expiryMs) return { ok: false, reason: 'requester-binding-expired' };
  if (
    binding.role !== expectedRole || binding.worktree_id !== expectedWorktreeId
    || binding.plan_digest !== expectedPlanDigest
  ) {
    return { ok: false, reason: 'requester-binding-scope-mismatch' };
  }
  // M7 section 5 point 2: exact current live SessionGeneration -- a direct
  // session_generation_id VALUE comparison (never the old timestamp-window
  // heuristic this replaces), applied uniformly regardless of provider
  // (every RequesterBinding, claude-hook or codex-supervisor, is minted
  // under a live SessionGeneration -- resolveSessionGeneration is called
  // unconditionally by createRequesterBinding). peekSessionGeneration is a
  // pure lookup: validation must never create or rotate state as a side
  // effect.
  const generation = peekSessionGeneration(repoDescriptor, { provider: binding.runtime, runtime_session_key: binding.runtime_session_key });
  if (!generation.ok || generation.generationId !== binding.session_generation_id) {
    return { ok: false, reason: 'requester-binding-generation-mismatch' };
  }
  // M7 section 4.1/12 (defect 11): the Claude actor fence applies ONLY to a
  // claude-hook backing -- Codex-supervisor validation keeps its existing
  // retained-host proof path untouched; the Claude fence is never consulted
  // for it (a real fence is never planted for a codex-supervisor identity in
  // production, but the check itself must still be gated, not merely
  // coincidentally inert).
  if (binding.runtime === 'claude-hook') {
    const authorityIdentityId = computeClaudeAuthorityIdentityId(repoDescriptor, binding.runtime, binding.runtime_session_key, binding.agent_key);
    const fenceRead = readClaudeAuthorityFence(repoDescriptor, authorityIdentityId);
    if (!fenceRead.ok) return { ok: false, reason: 'authority-fence-invalid' };
    if (!fenceRead.absent) return { ok: false, reason: 'authority-fenced' };
  }
  // M6+M7 FINAL AUTHORITY CORRECTION (agent_id binding closure) / M7 section
  // 5 point 5 (family proof: current CLAUDE-ID-01): a claude-hook binding
  // remains valid ONLY while its backing peer's CLAUDE-ID-01 attestation is
  // CURRENTLY proof-complete -- re-checked on EVERY validate call, never
  // merely trusted from mint time (PLAN.md ~L588 gates persistent
  // native-hook requester-binding creation behind CLAUDE-ID-01 entirely, not
  // just at the moment of creation). The identity to check is derived FROM
  // the binding record itself, never a caller-supplied parameter. A
  // codex-supervisor binding has no CLAUDE-ID-01 concept and is unaffected.
  if (binding.runtime === 'claude-hook') {
    const claudeId01Result = checkClaudeId01ProofComplete(
      repoDescriptor, binding.runtime_session_key, binding.worktree_id, binding.plan_digest, binding.role, binding.agent_key
    );
    if (!claudeId01Result.ok) {
      return { ok: false, reason: 'requester-binding-claude-id01-unproven' };
    }
  }
  return { ok: true, binding };
}

  return Object.freeze({
    REQUESTER_BINDING_SCHEMA, REQUESTER_BINDING_KEYS, REQUESTER_BINDING_SCHEMA_V2,
    REQUESTER_BINDING_KEYS_V2, REQUESTER_BINDING_SCAN_CAP, requesterBindingPathFor,
    requesterBindingLookupLockDirFor, requesterBindingContentionBudgetMs,
    createRequesterBinding, validateRequesterBindingFor,
  });
}

module.exports = { createRequesterBindingModule };
