'use strict';

// Extracted behaviorally from runtime-role-lifecycle.cjs: MainOrchestratorBinding/v1,
// RoleActorBinding/v1, and the M7 Claude authority identity/fence record --
// three structurally-parallel host-private registry record families. Never
// requires the facade or the bridge/consultation facades, directly or
// transitively.

function createOrchestratorRoleBindings({
  path, fs, crypto, registryRepoDir, readRegistryRecord, writeRegistryRecordReplace,
  publishNoClobber, canonicalJSONStringify, resolveSessionGeneration, peekSessionGeneration,
  nowIsoForRegistry, isoPlusSecondsForRegistry, isoToMsForRegistry, currentClockMsForRegistry,
  isCanonicalIsoUtc, isHexActionId, isHexDigest64, isHexCsprng32, hasExactKeys, isIntInRangeNum,
  IDENTITY_PROVIDER_ENUM, MAX_RUNTIME_SESSION_KEY_BYTES, CANONICAL_ROLES, computeRepoId,
  sha256String, MAIN_ORCHESTRATOR_BINDING_HOOK_SCAN_CAP,
}) {
const MAIN_BINDING_KEYS = Object.freeze([
  'actor_instance_id', 'binding_id', 'created_at', 'expiry', 'plan_digest',
  'runtime', 'runtime_session_key', 'schema', 'worktree_id',
]);

function mainOrchestratorBindingPathFor(projectRoot, bindingId) {
  return path.join(registryRepoDir(projectRoot), 'orchestrator-bindings', bindingId + '.json');
}

/**
 * @param {string} projectRoot
 * @param {{ok:true,provider:string,runtime_session_key:string}} identity
 * @param {string} worktreeId
 * @param {string} planDigest
 * @param {number} ttlSeconds
 * @returns {{ok:true,binding:object}|{ok:false,reason:string}}
 */
function createMainOrchestratorBinding(projectRoot, identity, worktreeId, planDigest, ttlSeconds) {
  // Ensures a live session generation exists for this identity tuple (the
  // binding's lifecycle is meaningless without one) -- but per PLAN.md ~L574
  // the generation id itself is never stored on the binding; see the section
  // header comment above.
  const genResult = resolveSessionGeneration(projectRoot, identity);
  if (!genResult.ok) return { ok: false, reason: genResult.reason };
  const bindingId = crypto.randomBytes(16).toString('hex');
  const nowStr = nowIsoForRegistry();
  const binding = {
    schema: 'runtime/main-orchestrator-binding/v1',
    binding_id: bindingId,
    runtime: identity.provider,
    runtime_session_key: identity.runtime_session_key,
    actor_instance_id: crypto.randomBytes(16).toString('hex'),
    worktree_id: worktreeId,
    plan_digest: planDigest,
    created_at: nowStr,
    expiry: isoPlusSecondsForRegistry(nowStr, ttlSeconds),
  };
  const bindingPath = mainOrchestratorBindingPathFor(projectRoot, bindingId);
  const writeResult = writeRegistryRecordReplace(bindingPath, Buffer.from(canonicalJSONStringify(binding), 'utf8'));
  if (!writeResult.ok) return { ok: false, reason: writeResult.reason };
  return { ok: true, binding };
}

/**
 * Draft->final PLAN rebind (PLAN.md ~L167): the session generation is PRESERVED;
 * only `plan_digest` (and a fresh `binding_id`/`expiry`) change. Never mints a new
 * session_generation_id for a draft->final transition.
 * @param {string} projectRoot
 * @param {object} oldBinding - a previously-created MainOrchestratorBinding/v1.
 * @param {string} newPlanDigest
 * @param {number} ttlSeconds
 * @returns {{ok:true,binding:object}|{ok:false,reason:string}}
 */
function rebindMainOrchestratorBindingForNewPlan(projectRoot, oldBinding, newPlanDigest, ttlSeconds) {
  const bindingId = crypto.randomBytes(16).toString('hex');
  const nowStr = nowIsoForRegistry();
  const binding = {
    schema: 'runtime/main-orchestrator-binding/v1',
    binding_id: bindingId,
    runtime: oldBinding.runtime,
    runtime_session_key: oldBinding.runtime_session_key, // PRESERVED tuple -> re-derives to the SAME generation, never re-minted
    actor_instance_id: oldBinding.actor_instance_id,
    worktree_id: oldBinding.worktree_id,
    plan_digest: newPlanDigest,
    created_at: nowStr,
    expiry: isoPlusSecondsForRegistry(nowStr, ttlSeconds),
  };
  const bindingPath = mainOrchestratorBindingPathFor(projectRoot, bindingId);
  const writeResult = writeRegistryRecordReplace(bindingPath, Buffer.from(canonicalJSONStringify(binding), 'utf8'));
  if (!writeResult.ok) return { ok: false, reason: writeResult.reason };
  return { ok: true, binding };
}

/**
 * WP3/M6-M7-PRODUCTION-REACHABILITY-20260819 (dispatchCanonical's own
 * claude-agent branch, runtime-consultation.cjs): a read-only, scope-only
 * liveness predicate over MainOrchestratorBinding/v1 -- "does EXACTLY ONE
 * genuine, current, unexpired, runtime==='claude-hook' binding for this
 * EXACT worktree_id+plan_digest exist right now". Deliberately NOT
 * session-scoped, unlike the sibling findLiveMainOrchestratorBindingForSession
 * below (which resolves a SPECIFIC session's own binding for
 * context-provider-gate.js's execution-claim path) -- dispatchCanonical has
 * no session identity to check here, only the request's own
 * requester_worktree_id/plan_digest.
 *
 * R2-EXACT-CLAUDE-HOST (Codex ruling, M6-M7-PRODUCTION-REACHABILITY-20260819
 * round 2 "continue_same_stage"): this must mean EXACTLY one fully valid
 * candidate, never "any scope-matched file exists" -- round 1's own
 * existence-only version (a) never inspected binding.runtime at all (any
 * IDENTITY_PROVIDER_ENUM value scope-matched identically, wrongly letting a
 * codex-supervisor-provider binding authorize claude-agent); (b) `return
 * true`d on the FIRST live scope match, never checking whether a SECOND
 * equally-live match also existed (zero-or-ambiguous was not distinguished
 * from exactly-one, and made a coexisting malformed sibling's fail-closed
 * outcome depend on undefined `fs.readdirSync` order); (c) never called
 * peekSessionGeneration, so a binding's own session-generation liveness was
 * entirely unchecked; (d) silently `continue`d past a `.json` symlink/
 * non-regular directory entry via `!entry.isFile()` rather than treating it
 * as the structural anomaly it is. Fixed by scanning the COMPLETE bounded
 * set unconditionally (never short-circuiting on a match), collecting every
 * genuine live candidate, and returning true only when EXACTLY ONE was
 * found -- zero or more than one both mean false.
 *
 * A candidate is a genuine live match only once it clears BOTH tiers below:
 *  1. STRUCTURAL (any failure fails the WHOLE scan closed immediately, never
 *     skips past it -- a corrupted/tampered registry entry must never be
 *     silently stepped over while searching for a "better" one elsewhere):
 *     exact MainOrchestratorBinding/v1 keyset, schema, path<->id
 *     correlation, `runtime` a genuine IDENTITY_PROVIDER_ENUM member,
 *     bounded nonempty `runtime_session_key` (mirrors getRuntimeIdentity's
 *     own MAX_RUNTIME_SESSION_KEY_BYTES bound), valid CSPRNG
 *     `actor_instance_id` and sha256-digest-shaped `worktree_id`/
 *     `plan_digest` (isHexCsprng32/isHexDigest64 -- the exact shapes
 *     createMainOrchestratorBinding always mints/receives), canonical ISO-UTC
 *     `created_at`/`expiry` with created_at<=expiry and created_at not in
 *     the future, and (new) a `.json`-named directory entry that is not a
 *     genuine regular file (a symlink or any other non-regular type) --
 *     never merely skipped via `!entry.isFile()` as if it were routine.
 *  2. ROUTINE (skippable -- the scan simply continues past it, still
 *     scanning for another candidate): `runtime !== 'claude-hook'`, a
 *     foreign worktree_id/plan_digest, a since-expired binding, or a
 *     structurally-fine candidate whose OWN session generation is not
 *     currently live per a lookup-only `peekSessionGeneration(provider,
 *     runtime_session_key)` call for that exact tuple (never
 *     resolveSessionGeneration, which may mint -- this is a pure read).
 *
 * Mirrors findLiveMainOrchestratorBindingForSession's bounded-scan
 * discipline over the SAME orchestrator-bindings/ directory (same cap, same
 * closed-shape/schema/timestamp checks, same full-scan-then-count-matches
 * shape) -- arch-platform-confirmed posture, extended here with the
 * runtime/session-key/id-shape/session-generation checks that function does
 * not need for ITS OWN already-session-scoped contract. Never throws to the
 * caller.
 * @param {string|{repoId:string}} projectRootOrRepoDescriptor
 * @param {string} worktreeId
 * @param {string} planDigest
 * @returns {boolean}
 */
function findLiveMainOrchestratorBindingForScope(projectRootOrRepoDescriptor, worktreeId, planDigest) {
  const bindingsDir = path.join(registryRepoDir(projectRootOrRepoDescriptor), 'orchestrator-bindings');
  let entries;
  try {
    entries = fs.readdirSync(bindingsDir, { withFileTypes: true });
  } catch (err) {
    return { ok: false, reason: 'main-binding-scope-none' }; // absent/unreadable directory -- no live binding possible.
  }
  if (entries.length > MAIN_ORCHESTRATOR_BINDING_HOOK_SCAN_CAP) return { ok: false, reason: 'main-binding-scope-invalid' }; // scan-cap exceeded -- fail closed.
  const matches = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') || !entry.name.endsWith('.json')) continue; // not a candidate at all -- benign skip.
    if (!entry.isFile()) return { ok: false, reason: 'main-binding-scope-invalid' }; // R2-EXACT-CLAUDE-HOST: a `.json`-named symlink/non-regular entry is a structural anomaly -- fail the whole scan closed, never silently skip it.
    const candidateId = entry.name.slice(0, -'.json'.length);
    let bindingRead;
    try {
      bindingRead = readRegistryRecord(mainOrchestratorBindingPathFor(projectRootOrRepoDescriptor, candidateId));
    } catch (err) {
      return { ok: false, reason: 'main-binding-scope-invalid' }; // unexpected throw is never routine -- fail the whole scan closed.
    }
    if (!bindingRead.ok) return { ok: false, reason: 'main-binding-scope-invalid' }; // durability/tamper anomaly (incl. 'pending') -- fail closed.
    if (bindingRead.absent) continue; // benign race: unlinked between readdir and read.
    const binding = bindingRead.obj;
    if (
      !binding || !hasExactKeys(binding, MAIN_BINDING_KEYS)
      || binding.schema !== 'runtime/main-orchestrator-binding/v1'
      || binding.binding_id !== candidateId
      || !IDENTITY_PROVIDER_ENUM.includes(binding.runtime)
      || typeof binding.runtime_session_key !== 'string' || binding.runtime_session_key.length === 0
      || Buffer.byteLength(binding.runtime_session_key, 'utf8') > MAX_RUNTIME_SESSION_KEY_BYTES
      || !isHexCsprng32(binding.actor_instance_id)
      || !isHexDigest64(binding.worktree_id) || !isHexDigest64(binding.plan_digest)
      || !isCanonicalIsoUtc(binding.created_at) || !isCanonicalIsoUtc(binding.expiry)
    ) {
      return { ok: false, reason: 'main-binding-scope-invalid' }; // structural corruption -- fail the whole scan closed, never skip past it.
    }
    // R2-A (M6-M7-R2-INTEGRITY-CLOSURE-20260820): chronology is a STRUCTURAL
    // property of the entry itself -- it must be validated for EVERY entry,
    // BEFORE the routine runtime/scope-mismatch skip below, never after.
    // Checking it after that skip let a foreign-scope/wrong-runtime entry
    // with impossible chronology be silently `continue`d past (its
    // chronology never inspected at all), so a corrupted registry entry
    // could hide behind an unrelated routine mismatch while a SEPARATE,
    // genuinely valid candidate elsewhere still won -- exactly the
    // "skip past a corrupted entry while searching for a better one
    // elsewhere" outcome this function's own fail-closed contract forbids.
    const createdAtMs = isoToMsForRegistry(binding.created_at);
    const expiryMs = isoToMsForRegistry(binding.expiry);
    if (!Number.isFinite(createdAtMs) || !Number.isFinite(expiryMs) || createdAtMs > expiryMs) return { ok: false, reason: 'main-binding-scope-invalid' }; // structural corruption.
    const nowMs = currentClockMsForRegistry();
    if (createdAtMs > nowMs) return { ok: false, reason: 'main-binding-scope-invalid' }; // structural corruption (binding minted "in the future").
    if (binding.runtime !== 'claude-hook' || binding.worktree_id !== worktreeId || binding.plan_digest !== planDigest) {
      continue; // routine mismatch -- wrong runtime, or a different worktree/plan's own binding.
    }
    if (nowMs >= expiryMs) continue; // routine expiry -- skippable, keep scanning for another live one.

    // R2-EXACT-CLAUDE-HOST: a lookup-only, non-minting liveness proof for
    // this EXACT (runtime, runtime_session_key) tuple -- never
    // resolveSessionGeneration (which may mint). R2-A: only a GENUINELY
    // benign outcome (absence, or ordinary expiry) is a routine "not
    // currently live" mismatch the scan may skip past -- every other
    // peekSessionGeneration failure (pending/malformed/tampered/durability
    // anomaly) is a structural anomaly on a registry this function must
    // otherwise trust, and fails the WHOLE scan closed exactly like a
    // corrupted binding record does above, never silently skipped while a
    // different candidate is still considered.
    const genResult = peekSessionGeneration(projectRootOrRepoDescriptor, {
      provider: binding.runtime,
      runtime_session_key: binding.runtime_session_key,
    });
    if (!genResult.ok) {
      if (genResult.reason === 'session-generation-absent' || genResult.reason === 'session-generation-expired') continue;
      return { ok: false, reason: 'main-binding-scope-invalid' }; // structural anomaly -- fail the whole scan closed, never skip past it.
    }

    matches.push({ binding, generation: genResult }); // genuine, current, unexpired, scope-matched, session-live candidate.
  }
  if (matches.length === 0) return { ok: false, reason: 'main-binding-scope-none' }; // zero -- never guess.
  if (matches.length > 1) return { ok: false, reason: 'main-binding-scope-ambiguous' }; // more than one -- never select on ambiguity.
  return { ok: true, binding: matches[0].binding, generation: matches[0].generation };
}

function hasLiveMainOrchestratorBindingForScope(projectRootOrRepoDescriptor, worktreeId, planDigest) {
  return findLiveMainOrchestratorBindingForScope(
    projectRootOrRepoDescriptor, worktreeId, planDigest,
  ).ok;
}

// R4 round 3 (block 1a): RoleActorBinding/v1 -- structurally parallel to
// MainOrchestratorBinding/v1 above but genuinely distinct (PLAN.md ~L574
// forbids resolving role-actor identity through a MainOrchestratorBinding).
// Unlike MainOrchestratorBinding, a role-actor has no hook-observed runtime
// identity tuple of its own, so `session_generation_id` is stamped directly
// from the confirming action (by `subagent-start-context-bundle.js`, after
// B1/B2 reserve/commit correlation) and compared as-is, never re-derived.
// `runtime-consultation-target-gate.js` resolves/validates the live binding
// (never creates one) before minting target/lifecycle grants.

const ROLE_ACTOR_BINDING_SCHEMA = 'runtime/role-actor-binding/v1';
const ROLE_ACTOR_BINDING_KEYS = Object.freeze([
  'actor_instance_id', 'binding_id', 'created_at', 'expiry', 'plan_digest',
  'role', 'schema', 'session_generation_id', 'worktree_id',
]);
// P4 correction (clean9 live evidence): RoleActorBinding is a PERSISTENT
// support-plane lifecycle primitive (READY/WAITING/BUSY across idle gaps --
// a canonical role WAITING after an idle gap wakes/reuses the SAME healthy
// binding, never a fresh spawn), genuinely separate in kind from a
// role-spawn/rebind ACTION's own short-lived correlation window. It must
// therefore NOT share ACTION_TTL_CEILING_SECONDS (120) -- that forced every
// parked resume handle down to a two-minute lifetime regardless of how long
// the actor may legitimately sit idle, observed live expiring the binding
// (and its handle) before the same top-level session even finished
// init-session. This ceiling instead mirrors SESSION_GENERATION_TTL_SECONDS
// (3600, one hour): generous enough for a real idle gap, still a hard
// bound, never unbounded -- and every park/consume/finder path still
// independently re-validates a LIVE exact SessionGeneration on every call
// (peekSessionGeneration), so no binding or handle ever outlives session
// expiry/restart regardless of its own stored expiry field.
const ROLE_ACTOR_BINDING_TTL_CEILING_SECONDS = 3600;

function roleActorBindingPathFor(projectRootOrRepoDescriptor, bindingId) {
  return path.join(registryRepoDir(projectRootOrRepoDescriptor), 'role-actor-bindings', bindingId + '.json');
}

/**
 * Registry infrastructure (schema + create + read/validate); production
 * issuer is `subagent-start-context-bundle.js` (SubagentStart, after
 * confirmed B2 reservation/correlation). `role` is a SINGLE canonical role
 * (never null/array -- a role-actor represents exactly one role, unlike a
 * grant's more general role union), matching the only admitted subcommand
 * (`ready`, always called with a single-role action per `handleReady`'s own
 * `action.role`). R4 round 3 (round 4 correction): every input is
 * independently validated BEFORE anything is written -- this type has no
 * hook-observed identity to re-derive from (unlike MainOrchestratorBinding's
 * `resolveSessionGeneration` call; its scope instead comes directly from the
 * caller's already-confirmed action object), so this mint path is the ONLY
 * gate standing between a caller bug (test fixture or the real issuer) and a
 * durably-published, semantically-false RoleActorBinding record.
 * @param {string} projectRoot
 * @param {string} role
 * @param {string} worktreeId
 * @param {string} planDigest
 * @param {string} sessionGenerationId
 * @param {number} ttlSeconds
 * @returns {{ok:true,binding:object}|{ok:false,reason:string}}
 */
function createRoleActorBinding(projectRoot, role, worktreeId, planDigest, sessionGenerationId, ttlSeconds) {
  if (!CANONICAL_ROLES.includes(role)) return { ok: false, reason: 'invalid-role' };
  if (!isHexDigest64(worktreeId)) return { ok: false, reason: 'invalid-worktree-id' };
  if (!isHexDigest64(planDigest)) return { ok: false, reason: 'invalid-plan-digest' };
  if (!isHexCsprng32(sessionGenerationId)) return { ok: false, reason: 'invalid-session-generation-id' };
  if (!isIntInRangeNum(ttlSeconds, 1, ROLE_ACTOR_BINDING_TTL_CEILING_SECONDS)) return { ok: false, reason: 'invalid-ttl' };
  const bindingId = crypto.randomBytes(16).toString('hex');
  const nowStr = nowIsoForRegistry();
  const binding = {
    schema: ROLE_ACTOR_BINDING_SCHEMA,
    binding_id: bindingId,
    actor_instance_id: crypto.randomBytes(16).toString('hex'),
    role,
    worktree_id: worktreeId,
    plan_digest: planDigest,
    session_generation_id: sessionGenerationId,
    created_at: nowStr,
    expiry: isoPlusSecondsForRegistry(nowStr, ttlSeconds),
  };
  const bindingPath = roleActorBindingPathFor(projectRoot, bindingId);
  const writeResult = writeRegistryRecordReplace(bindingPath, Buffer.from(canonicalJSONStringify(binding), 'utf8'));
  if (!writeResult.ok) return { ok: false, reason: writeResult.reason };
  return { ok: true, binding };
}

/**
 * Closed validator for RoleActorBinding/v1, structurally parallel to
 * `validateAndConsumeLifecycleCommandGrant`'s own INLINE main-orchestrator
 * binding resolution (never `validateMainOrchestratorBindingFor`, which is
 * the SEPARATE SupervisorExecutionClaim validator and correlates against an
 * action's session generation -- a correlation this function deliberately
 * leaves to the caller, exactly like the inline main-orchestrator path
 * does): exact key-set closure, exact schema literal, path<->field id
 * correlation, hex-shaped id fields, canonical-ISO-UTC timestamps with
 * created_at<=expiry and never in the future, not expired, and scope
 * correlation against the GRANT's own fields (role/worktree/plan) only.
 * `session_generation_id` is returned on the binding for the caller
 * (`handleReady`) to cross-check against the ACTION's own value itself,
 * mirroring exactly how the main-orchestrator path re-derives and checks
 * its session generation AFTER grant-consumption, not during it.
 * @param {string|{repoId:string}} repoDescriptor
 * @param {string} bindingId
 * @param {string} expectedRole
 * @param {string} expectedWorktreeId
 * @param {string} expectedPlanDigest
 * @returns {{ok:true,binding:object}|{ok:false,reason:string}}
 */
function validateRoleActorBindingFor(repoDescriptor, bindingId, expectedRole, expectedWorktreeId, expectedPlanDigest) {
  if (!isHexActionId(bindingId)) return { ok: false, reason: 'role-actor-binding-id-invalid' };
  const bindingRead = readRegistryRecord(roleActorBindingPathFor(repoDescriptor, bindingId));
  if (!bindingRead.ok) return { ok: false, reason: 'role-actor-binding-read-failed:' + bindingRead.reason };
  if (bindingRead.absent) return { ok: false, reason: 'role-actor-binding-absent' };
  const binding = bindingRead.obj;
  if (!binding || !hasExactKeys(binding, ROLE_ACTOR_BINDING_KEYS)) return { ok: false, reason: 'role-actor-binding-shape-invalid' };
  if (binding.schema !== ROLE_ACTOR_BINDING_SCHEMA) return { ok: false, reason: 'role-actor-binding-schema-invalid' };
  if (binding.binding_id !== bindingId) return { ok: false, reason: 'role-actor-binding-id-path-mismatch' };
  if (!isHexActionId(binding.actor_instance_id)) return { ok: false, reason: 'role-actor-binding-shape-invalid' };
  if (!CANONICAL_ROLES.includes(binding.role)) return { ok: false, reason: 'role-actor-binding-shape-invalid' };
  if (!isHexDigest64(binding.worktree_id) || !isHexDigest64(binding.plan_digest)) return { ok: false, reason: 'role-actor-binding-shape-invalid' };
  if (typeof binding.session_generation_id !== 'string' || binding.session_generation_id.length === 0) return { ok: false, reason: 'role-actor-binding-shape-invalid' };
  if (!isCanonicalIsoUtc(binding.created_at) || !isCanonicalIsoUtc(binding.expiry)) return { ok: false, reason: 'role-actor-binding-timestamp-shape-invalid' };
  const createdAtMs = isoToMsForRegistry(binding.created_at);
  const expiryMs = isoToMsForRegistry(binding.expiry);
  if (!Number.isFinite(createdAtMs) || !Number.isFinite(expiryMs) || createdAtMs > expiryMs) {
    return { ok: false, reason: 'role-actor-binding-timestamp-invalid' };
  }
  const nowMs = currentClockMsForRegistry();
  if (createdAtMs > nowMs) return { ok: false, reason: 'role-actor-binding-created-in-future' };
  if (nowMs >= expiryMs) return { ok: false, reason: 'role-actor-binding-expired' };
  if (
    binding.role !== expectedRole || binding.worktree_id !== expectedWorktreeId
    || binding.plan_digest !== expectedPlanDigest
  ) {
    return { ok: false, reason: 'role-actor-binding-scope-mismatch' };
  }
  return { ok: true, binding };
}

// ─────────────────────────────────────────────────────────────────────────────
// M7 LIFECYCLE section 3: Claude actor identity and fence. `authority_identity_id`
// is a pure function of {schema,provider,repo_id,runtime_session_key,agent_id}
// -- generation/PLAN/worktree/role are deliberately excluded from this domain
// (section 3.1: "A delayed stop cannot be misattributed to a newer generation,
// and PLAN rotation cannot hide a same-process authority"). The fence record
// is immutable and is never removed or replaced once durably written.
// ─────────────────────────────────────────────────────────────────────────────

const CLAUDE_AUTHORITY_IDENTITY_SCHEMA = 'runtime/claude-authority-identity/v1';
const CLAUDE_AUTHORITY_FENCE_SCHEMA = 'runtime/claude-authority-fence/v1';
const CLAUDE_AUTHORITY_FENCE_KEYS = Object.freeze(['authority_identity_id', 'fenced_at', 'reason', 'schema'].sort());
const CLAUDE_AUTHORITY_FENCE_REASON_ENUM = Object.freeze(['agent-return']);

/** Mirrors registryRepoDir's own {repoId}-or-projectRoot resolution exactly. */
function resolveM7RepoId(projectRootOrRepoId) {
  return (
    projectRootOrRepoId && typeof projectRootOrRepoId === 'object' && typeof projectRootOrRepoId.repoId === 'string'
  ) ? projectRootOrRepoId.repoId : computeRepoId(projectRootOrRepoId);
}

/**
 * M7 section 3.1: sha256(canonicalJSONStringify({schema,provider,repo_id,
 * runtime_session_key,agent_id})) over exactly that closed object -- no
 * delimiter-joined encoding.
 */
function computeClaudeAuthorityIdentityId(projectRootOrRepoId, provider, sessionId, agentId) {
  const identity = {
    schema: CLAUDE_AUTHORITY_IDENTITY_SCHEMA,
    provider,
    repo_id: resolveM7RepoId(projectRootOrRepoId),
    runtime_session_key: sessionId,
    agent_id: agentId,
  };
  return sha256String(canonicalJSONStringify(identity));
}

function claudeAuthorityFencePathFor(projectRootOrRepoId, authorityIdentityId) {
  return path.join(registryRepoDir(projectRootOrRepoId), 'authority-identity-fences', authorityIdentityId + '.json');
}

/**
 * Closed read of the fence at its own path. {ok:true,absent:true} when
 * genuinely absent; {ok:true,absent:false,fence} for a valid fence;
 * {ok:false,reason:'authority-fence-invalid'} for ANY malformed/unsafe/
 * unreadable state (M7 section 3.2: "Different, malformed, pending, unsafe,
 * or unreadable state is an error").
 */
function readClaudeAuthorityFence(projectRootOrRepoId, authorityIdentityId) {
  const read = readRegistryRecord(claudeAuthorityFencePathFor(projectRootOrRepoId, authorityIdentityId));
  if (!read.ok) return { ok: false, reason: 'authority-fence-invalid' };
  if (read.absent) return { ok: true, absent: true };
  const fence = read.obj;
  if (
    !fence || !hasExactKeys(fence, CLAUDE_AUTHORITY_FENCE_KEYS)
    || fence.schema !== CLAUDE_AUTHORITY_FENCE_SCHEMA
    || fence.authority_identity_id !== authorityIdentityId
    || !CLAUDE_AUTHORITY_FENCE_REASON_ENUM.includes(fence.reason)
    || !isCanonicalIsoUtc(fence.fenced_at)
  ) {
    return { ok: false, reason: 'authority-fence-invalid' };
  }
  return { ok: true, absent: false, fence };
}

/**
 * Publishes the fence, no-clobber (fd-accredited publishNoClobber, M7 section
 * 3.2). A genuine EEXIST is idempotent ONLY after a fresh fd-bound read
 * proves the exact key set/schema/identity id/reason enum/canonical
 * timestamp -- any other failure, or a reread that does not prove a valid
 * fence, is an error. Only AUTHORITY_INVALID (publishNoClobber's own default
 * race-loss detail code) is ever treated as a success candidate.
 */
function publishClaudeAuthorityFence(projectRootOrRepoId, authorityIdentityId) {
  const fence = {
    schema: CLAUDE_AUTHORITY_FENCE_SCHEMA,
    authority_identity_id: authorityIdentityId,
    reason: 'agent-return',
    fenced_at: nowIsoForRegistry(),
  };
  try {
    publishNoClobber(claudeAuthorityFencePathFor(projectRootOrRepoId, authorityIdentityId), Buffer.from(canonicalJSONStringify(fence), 'utf8'), {});
    return { ok: true, fence };
  } catch (err) {
    if (err && err.detailCode === 'AUTHORITY_INVALID') {
      const reread = readClaudeAuthorityFence(projectRootOrRepoId, authorityIdentityId);
      if (reread.ok && !reread.absent) return { ok: true, fence: reread.fence };
    }
    return { ok: false, reason: 'authority-fence-invalid' };
  }
}

  return Object.freeze({
    MAIN_BINDING_KEYS, mainOrchestratorBindingPathFor, createMainOrchestratorBinding,
    rebindMainOrchestratorBindingForNewPlan, findLiveMainOrchestratorBindingForScope,
    hasLiveMainOrchestratorBindingForScope,
    ROLE_ACTOR_BINDING_SCHEMA, ROLE_ACTOR_BINDING_KEYS, ROLE_ACTOR_BINDING_TTL_CEILING_SECONDS,
    roleActorBindingPathFor, createRoleActorBinding, validateRoleActorBindingFor,
    CLAUDE_AUTHORITY_IDENTITY_SCHEMA, CLAUDE_AUTHORITY_FENCE_SCHEMA, CLAUDE_AUTHORITY_FENCE_KEYS,
    CLAUDE_AUTHORITY_FENCE_REASON_ENUM, resolveM7RepoId, computeClaudeAuthorityIdentityId,
    claudeAuthorityFencePathFor, readClaudeAuthorityFence, publishClaudeAuthorityFence,
  });
}

module.exports = { createOrchestratorRoleBindings };
