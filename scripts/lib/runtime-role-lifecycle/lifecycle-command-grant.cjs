'use strict';

function createLifecycleCommandGrant(deps) {
  const {
    path, Buffer, CANONICAL_ROLES, MAIN_BINDING_KEYS, ROLE_ACTOR_BINDING_KEYS, ROLE_ACTOR_BINDING_SCHEMA, canonicalJSONStringify, crypto, currentClockMsForRegistry, ensureSecureRegistryDir,
    hasExactKeys, hasUniqueValues, isCanonicalIsoUtc, isHexActionId, isHexDigest64, isoPlusSecondsForRegistry, isoToMsForRegistry, mainOrchestratorBindingPathFor, nowIsoForRegistry, publishNoClobber,
    readRegistryRecord, registryRepoDir, validateRoleActorBindingFor,
  } = deps;

const LIFECYCLE_GRANT_SCHEMA = 'runtime/lifecycle-command-grant/v1';
const GRANT_TTL_SECONDS = 30; // PLAN.md ~L576: "All grants expire within 30 seconds" -- a hard ceiling, not a default.
const GRANT_KEYS = Object.freeze([
  'action_id', 'actor_instance_id', 'authority', 'binding_id', 'binding_kind',
  'canonical_argv_digest', 'created_at', 'expiry', 'grant_id', 'plan_digest',
  'profile', 'role', 'schema', 'subcommand', 'worktree_id',
].sort());
const GRANT_BINDING_KIND_ENUM = Object.freeze(['main-orchestrator', 'role-actor']);
const GRANT_AUTHORITY_ENUM = Object.freeze(['orchestrator', 'target']);
const GRANT_PROFILE_ENUM = Object.freeze(['bootstrap', 'normal', 'target']);
// PLAN.md ~L576's exact closed admission table -- "main+bootstrap admits
// only probe|ensure|action-failed|wait-ready|status; main+normal admits only
// probe|ensure|notify|action-failed|wait-ready|status|rotate|stop-owned;
// role-actor+target admits only ready". Keyed by profile alone since profile
// and binding_kind co-vary 1:1 in this closed table (bootstrap/normal are
// always main-orchestrator, target is always role-actor) -- binding_kind is
// still independently validated below, never inferred from profile.
const GRANT_PROFILE_ADMITTED_SUBCOMMANDS = Object.freeze({
  bootstrap: Object.freeze(['probe', 'ensure', 'action-failed', 'wait-ready', 'status']),
  normal: Object.freeze([
    'probe', 'ensure', 'notify', 'action-failed', 'wait-ready', 'status',
    'consult-root', 'consult-root-status', 'root-source', 'root-source-status',
    // P5 U2 live-wiring: mixed-review-request structurally mirrors consult-root
    // throughout (same s16ResolveMainContext call shape, same grant mechanism) --
    // without this admission entry, mintLifecycleCommandGrant rejects EVERY grant
    // attempt for it with subcommand-not-admitted-by-profile, making the whole
    // subcommand unreachable by any caller, not just tests. PLAN.md's own ~L576
    // table this list mirrors may need a matching follow-up update -- out of this
    // dispatch's files[] scope to edit directly.
    'mixed-review-request',
    'rotate', 'stop-owned',
  ]),
  target: Object.freeze(['ready']),
});
const GRANT_PROFILE_FOR_BINDING_KIND = Object.freeze({
  'main-orchestrator': Object.freeze(['bootstrap', 'normal']),
  'role-actor': Object.freeze(['target']),
});
// Point 1.2 (R4): binding_kind and authority co-vary 1:1 -- a
// main-orchestrator binding is never target authority and a role-actor
// binding is never orchestrator authority. Previously each enum was
// validated independently with no correlation between them, so a
// main-orchestrator+target (or role-actor+orchestrator) grant was
// structurally acceptable despite being semantically incoherent.
const GRANT_AUTHORITY_FOR_BINDING_KIND = Object.freeze({
  'main-orchestrator': 'orchestrator',
  'role-actor': 'target',
});
const GRANT_ACTION_ID_REQUIRED_SUBCOMMANDS = Object.freeze(['action-failed', 'ready', 'wait-ready', 'root-source-status']);

function grantPathFor(projectRoot, grantId) {
  return path.join(registryRepoDir(projectRoot), 'grants', grantId + '.json');
}

function grantConsumedMarkerPathFor(projectRoot, grantId) {
  return path.join(registryRepoDir(projectRoot), 'grants', grantId + '.consumed');
}

function grantArraysEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

/**
 * Structural well-formedness of a grant's `role` field, independent of any
 * specific caller's expectation (PLAN.md ~L576's closed union): a single
 * canonical role string, OR a sorted unique non-empty canonical-role array,
 * OR null. Array-vs-string CHOICE (single-role ensure as a string vs
 * multi-role ensure as an array) and the "null only for probe/status or a
 * current team/supervisor action" restriction are both caller-expectation
 * correlation, validated separately via `grantRoleMatchesExpectation` --
 * this function only rejects a structurally malformed value.
 */
function isWellFormedGrantRole(role) {
  if (role === null) return true;
  if (typeof role === 'string') return CANONICAL_ROLES.includes(role);
  if (Array.isArray(role)) {
    if (role.length === 0 || !hasUniqueValues(role)) return false;
    if (!role.every((r) => typeof r === 'string' && CANONICAL_ROLES.includes(r))) return false;
    return grantArraysEqual(role, role.slice().sort());
  }
  return false;
}

function grantRoleMatchesExpectation(grantRole, expectedRole) {
  if (Array.isArray(grantRole) || Array.isArray(expectedRole)) return grantArraysEqual(grantRole, expectedRole);
  return grantRole === expectedRole;
}

/**
 * Mints one no-clobber lifecycle-command-grant/v1 referencing `binding` for a
 * specific closed argv digest (the EXACT subcommand+role+project-root the grant
 * authorizes -- a grant minted for one argv shape can never authorize a
 * different one, closing a confused-deputy replay-with-different-args class).
 * `bindingKind`/`authority`/`profile` are never inferred/defaulted -- the
 * caller (a hook, or a test simulating one) declares them explicitly, and
 * minting fails closed if `subcommand` is not admitted by that exact
 * profile or `bindingKind`/`profile` do not co-vary per PLAN.md ~L576.
 * @param {string} projectRoot
 * @param {object} binding - a MainOrchestratorBinding/v1 (main-orchestrator
 *   grants) or a RoleActorBinding/v1 (role-actor grants, R4 round 3 block
 *   1a) -- `bindingKind` MUST genuinely match `binding`'s own declared
 *   schema (R4 round 3, round 4 correction, finding 1: schema-aware
 *   minting) -- a mismatch publishes nothing.
 * @param {string} argvDigest - sha256 over the canonical argv this grant authorizes.
 * @param {string|string[]|null} role
 * @param {string} subcommand
 * @param {'main-orchestrator'|'role-actor'} bindingKind
 * @param {'orchestrator'|'target'} authority
 * @param {'bootstrap'|'normal'|'target'} profile
 * @param {string|null} [actionId] - required (32+-hex) iff subcommand is
 *   action-failed|ready|wait-ready; must be null/omitted otherwise.
 * @returns {{ok:true,grantId:string}|{ok:false,reason:string}}
 */
function mintLifecycleCommandGrant(projectRoot, binding, argvDigest, role, subcommand, bindingKind, authority, profile, actionId) {
  if (!GRANT_BINDING_KIND_ENUM.includes(bindingKind)) return { ok: false, reason: 'invalid-binding-kind' };
  // R4 round 3 (round 4 correction, finding 1): schema-aware -- `binding`'s
  // OWN declared type must genuinely match `bindingKind`, checked via its
  // schema literal AND exact key-set (the two types are structurally
  // disjoint: a MainOrchestratorBinding has runtime/runtime_session_key,
  // never session_generation_id, and vice versa). Previously a
  // MainOrchestratorBinding object could be minted with bindingKind:
  // 'role-actor' -- consumption later correctly rejected it, but the mint
  // itself had ALREADY published a semantically false grant artifact. A
  // mismatch here publishes NOTHING.
  if (bindingKind === 'main-orchestrator') {
    if (!binding || binding.schema !== 'runtime/main-orchestrator-binding/v1' || !hasExactKeys(binding, MAIN_BINDING_KEYS)) {
      return { ok: false, reason: 'binding-kind-schema-mismatch' };
    }
  } else if (bindingKind === 'role-actor') {
    if (!binding || binding.schema !== ROLE_ACTOR_BINDING_SCHEMA || !hasExactKeys(binding, ROLE_ACTOR_BINDING_KEYS)) {
      return { ok: false, reason: 'binding-kind-schema-mismatch' };
    }
  }
  if (!GRANT_AUTHORITY_ENUM.includes(authority)) return { ok: false, reason: 'invalid-authority' };
  if (GRANT_AUTHORITY_FOR_BINDING_KIND[bindingKind] !== authority) return { ok: false, reason: 'binding-kind-authority-mismatch' };
  if (!GRANT_PROFILE_ENUM.includes(profile)) return { ok: false, reason: 'invalid-profile' };
  if (!GRANT_PROFILE_FOR_BINDING_KIND[bindingKind].includes(profile)) return { ok: false, reason: 'binding-kind-profile-mismatch' };
  if (!GRANT_PROFILE_ADMITTED_SUBCOMMANDS[profile].includes(subcommand)) return { ok: false, reason: 'subcommand-not-admitted-by-profile' };
  const resolvedActionId = actionId === undefined ? null : actionId;
  const needsActionId = GRANT_ACTION_ID_REQUIRED_SUBCOMMANDS.includes(subcommand);
  if (needsActionId && !isHexActionId(resolvedActionId)) return { ok: false, reason: 'action-id-required' };
  if (!needsActionId && resolvedActionId !== null) return { ok: false, reason: 'action-id-must-be-null' };
  if (!isWellFormedGrantRole(role)) return { ok: false, reason: 'invalid-role-shape' };

  const grantId = crypto.randomBytes(16).toString('hex');
  const nowStr = nowIsoForRegistry();
  const grant = {
    schema: LIFECYCLE_GRANT_SCHEMA,
    grant_id: grantId,
    binding_kind: bindingKind,
    binding_id: binding.binding_id,
    actor_instance_id: binding.actor_instance_id,
    authority,
    profile,
    subcommand,
    action_id: resolvedActionId,
    canonical_argv_digest: argvDigest,
    plan_digest: binding.plan_digest,
    worktree_id: binding.worktree_id,
    role,
    created_at: nowStr,
    expiry: isoPlusSecondsForRegistry(nowStr, GRANT_TTL_SECONDS),
  };
  const dir = path.dirname(grantPathFor(projectRoot, grantId));
  const dirResult = ensureSecureRegistryDir(dir);
  if (!dirResult.ok) return { ok: false, reason: dirResult.reason };
  try {
    publishNoClobber(grantPathFor(projectRoot, grantId), Buffer.from(canonicalJSONStringify(grant), 'utf8'), {});
  } catch (err) {
    return { ok: false, reason: 'grant-publish-failed' };
  }
  return { ok: true, grantId };
}

/**
 * Validates+atomically-consumes `grantId` for the given projectRoot/argv shape.
 * Every check is independent and fails closed: exact key-set, schema literal,
 * every enum (binding_kind/authority/profile), the profile-admission table,
 * action_id required-iff-{action-failed,ready,wait-ready} shape AND
 * correlation against `callerActionId`, role structural well-formedness AND
 * correlation against `role`, a hard <=30s TTL re-checked (never merely
 * trusted from mint time), created_at never in the future, expiry, and a
 * since-expired binding -- or a replay (the grant was already consumed --
 * the no-clobber consumed-marker already exists).
 * @param {string} projectRoot
 * @param {string} grantId
 * @param {string} argvDigest
 * @param {string|string[]|null} role
 * @param {string} subcommand
 * @param {string|null} [callerActionId] - the actual action_id this call is
 *   operating on (action-failed/ready/wait-ready); omitted/null otherwise.
 * @returns {{ok:true,binding:object}|{ok:false,reason:string}}
 */
function validateAndConsumeLifecycleCommandGrant(projectRoot, grantId, argvDigest, role, subcommand, callerActionId) {
  if (!isHexActionId(grantId)) return { ok: false, reason: 'malformed-grant-id' };
  const grantRead = readRegistryRecord(grantPathFor(projectRoot, grantId));
  if (!grantRead.ok) return { ok: false, reason: grantRead.reason };
  if (grantRead.absent) return { ok: false, reason: 'grant-absent' };
  const grant = grantRead.obj;

  if (!grant || !hasExactKeys(grant, GRANT_KEYS)) return { ok: false, reason: 'grant-key-set-invalid' };
  // Point 1.4 (R4): the record's OWN embedded grant_id must match the id
  // the PATH was constructed from -- never trusted implicitly merely
  // because the file happened to be found at that path. Mirrors the SAME
  // path<->field correlation point A.3 already closed for RoleBinding/v1.
  if (grant.grant_id !== grantId) return { ok: false, reason: 'grant-id-path-mismatch' };
  if (grant.schema !== LIFECYCLE_GRANT_SCHEMA) return { ok: false, reason: 'grant-schema-invalid' };
  // R4 round 2, point 4: reuse the SAME hex-ID + canonical-ISO-UTC rigor
  // RoleBinding/v1 now enforces -- every ID field on the grant is
  // independently well-formed, never merely non-empty-string or
  // Date.parse-able. binding_id in particular is used to derive a registry
  // PATH below; validating its shape before that use is defense in depth,
  // not merely cosmetic.
  if (!isHexActionId(grant.binding_id) || !isHexActionId(grant.actor_instance_id)) {
    return { ok: false, reason: 'grant-id-shape-invalid' };
  }
  if (!isHexDigest64(grant.worktree_id) || !isHexDigest64(grant.plan_digest)) {
    return { ok: false, reason: 'grant-scope-id-shape-invalid' };
  }
  if (!isCanonicalIsoUtc(grant.created_at) || !isCanonicalIsoUtc(grant.expiry)) {
    return { ok: false, reason: 'grant-timestamp-shape-invalid' };
  }
  if (!GRANT_BINDING_KIND_ENUM.includes(grant.binding_kind)) return { ok: false, reason: 'grant-binding-kind-invalid' };
  if (!GRANT_AUTHORITY_ENUM.includes(grant.authority)) return { ok: false, reason: 'grant-authority-invalid' };
  if (GRANT_AUTHORITY_FOR_BINDING_KIND[grant.binding_kind] !== grant.authority) return { ok: false, reason: 'grant-binding-kind-authority-mismatch' };
  if (!GRANT_PROFILE_ENUM.includes(grant.profile)) return { ok: false, reason: 'grant-profile-invalid' };
  if (!GRANT_PROFILE_FOR_BINDING_KIND[grant.binding_kind].includes(grant.profile)) return { ok: false, reason: 'grant-binding-kind-profile-mismatch' };
  if (!GRANT_PROFILE_ADMITTED_SUBCOMMANDS[grant.profile].includes(grant.subcommand)) return { ok: false, reason: 'grant-subcommand-not-admitted' };
  if (!isWellFormedGrantRole(grant.role)) return { ok: false, reason: 'grant-role-shape-invalid' };
  const needsActionId = GRANT_ACTION_ID_REQUIRED_SUBCOMMANDS.includes(grant.subcommand);
  if (needsActionId && !isHexActionId(grant.action_id)) return { ok: false, reason: 'grant-action-id-invalid' };
  if (!needsActionId && grant.action_id !== null) return { ok: false, reason: 'grant-action-id-must-be-null' };

  const resolvedCallerActionId = callerActionId === undefined ? null : callerActionId;
  if (
    grant.subcommand !== subcommand
    || !grantRoleMatchesExpectation(grant.role, role)
    || grant.canonical_argv_digest !== argvDigest
    || (needsActionId && grant.action_id !== resolvedCallerActionId)
  ) {
    return { ok: false, reason: 'grant-shape-mismatch' };
  }

  const createdAtMs = isoToMsForRegistry(grant.created_at);
  const expiryMs = isoToMsForRegistry(grant.expiry);
  if (!Number.isFinite(createdAtMs) || !Number.isFinite(expiryMs) || createdAtMs > expiryMs) {
    return { ok: false, reason: 'grant-timestamp-invalid' };
  }
  if (expiryMs - createdAtMs > GRANT_TTL_SECONDS * 1000) return { ok: false, reason: 'grant-ttl-exceeds-30s' };
  const nowMsForGrant = currentClockMsForRegistry();
  if (createdAtMs > nowMsForGrant) return { ok: false, reason: 'grant-created-in-future' };
  if (nowMsForGrant >= expiryMs) return { ok: false, reason: 'grant-expired' };

  // R4 round 3 (block 1a): a role-actor grant's identity now resolves
  // through RoleActorBinding/v1 -- a genuinely SEPARATE registry type, never
  // MainOrchestratorBinding/v1 (the masquerade PLAN.md ~L574 forbids: a
  // MainOrchestratorBinding "is not a RequesterIdentityProvider peer
  // binding, has no canonical role, ... cannot be registered as a target").
  // Production's issuer is subagent-start-context-bundle.js
  // (createRoleActorBinding, after confirmed B2 reservation/correlation) and
  // runtime-consultation-target-gate.js (mints the role-actor grant itself,
  // for `ready`) -- this validation path is what keeps that honest, not an
  // artificial gate that rejects binding_kind==='role-actor' outright
  // regardless of whether a genuine one exists.
  let binding;
  if (grant.binding_kind === 'role-actor') {
    const roleActorResult = validateRoleActorBindingFor(projectRoot, grant.binding_id, grant.role, grant.worktree_id, grant.plan_digest);
    if (!roleActorResult.ok) return { ok: false, reason: roleActorResult.reason };
    binding = roleActorResult.binding;
    if (binding.actor_instance_id !== grant.actor_instance_id) {
      return { ok: false, reason: 'role-actor-binding-actor-mismatch' };
    }
  } else {
    const bindingRead = readRegistryRecord(mainOrchestratorBindingPathFor(projectRoot, grant.binding_id));
    if (!bindingRead.ok) return { ok: false, reason: bindingRead.reason };
    if (bindingRead.absent) return { ok: false, reason: 'binding-absent' };
    binding = bindingRead.obj;
    if (
      !binding || !hasExactKeys(binding, MAIN_BINDING_KEYS) || binding.schema !== 'runtime/main-orchestrator-binding/v1'
      || binding.binding_id !== grant.binding_id || binding.actor_instance_id !== grant.actor_instance_id
      || binding.worktree_id !== grant.worktree_id || binding.plan_digest !== grant.plan_digest
    ) {
      return { ok: false, reason: 'binding-shape-mismatch' };
    }
    // R4 round 2, point 4: binding_id/actor_instance_id/worktree_id/plan_digest
    // are already transitively hex-validated above (equality against the
    // grant's own, now-independently-hex-checked fields) -- created_at/expiry
    // carry no such cross-check and need their OWN canonical-ISO-UTC validation.
    if (!isCanonicalIsoUtc(binding.created_at) || !isCanonicalIsoUtc(binding.expiry)) {
      return { ok: false, reason: 'binding-timestamp-shape-invalid' };
    }
    const bindingExpiryMs = isoToMsForRegistry(binding.expiry);
    if (nowMsForGrant >= bindingExpiryMs) return { ok: false, reason: 'binding-expired' };
  }

  // Atomic one-use consumption: a no-clobber marker create. EEXIST == replay.
  const dir = path.dirname(grantConsumedMarkerPathFor(projectRoot, grantId));
  const dirResult = ensureSecureRegistryDir(dir);
  if (!dirResult.ok) return { ok: false, reason: dirResult.reason };
  try {
    publishNoClobber(grantConsumedMarkerPathFor(projectRoot, grantId), Buffer.from(canonicalJSONStringify({ consumed_at: nowIsoForRegistry() }), 'utf8'), {});
  } catch (err) {
    return { ok: false, reason: 'grant-replay' };
  }
  return { ok: true, binding, bindingKind: grant.binding_kind };
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// WP3 item C: SupervisorExecutionClaim/v1 -- a THIRD, DISTINCT authority from
// (1) the lifecycle-command-grant/main-binding above, which authorizes the
// top-level orchestrator's `ensure` call that MINTS a `supervisor-start`
// action, and (2) the role-owner rendezvous record `session-run` later wins
// to prove PROCESS ownership after it starts. This is the one that proves the
// action was actually ADMITTED FOR EXECUTION -- PLAN.md ~L580's "atomically
// transitions that action to EXECUTING" -- as a real, independently-checkable
// artifact, never merely inferred from the spawn-gate's own one-use launch
// marker (`bash-cli-spawn-gate.js`'s `<action_id>.background-launch-consumed
// .json`, which is timestamp-only replay-protection at the LAUNCH boundary,
// not execution authority; it may stay as an anti-replay diagnostic but never
// substitutes for this claim).
//
// Production wiring is `context-provider-gate.js`: it mints this when it
// authorizes the sanctioned background launch. `session-run` independently
// consumes the claim before any owner/READY mutation. Tests may also mint a
// claim through `fakeHostExecutorExecute` under a DOUBLE capability gate
// (both the general `isTestCapability()` AND the narrower,
// purpose-specific `RUNTIME_ROLE_LIFECYCLE_FAKE_EXECUTOR_CAPABILITY` env var
// must be present) -- a test merely setting the general fake-capability seam
// does not get this unusually powerful "authorize execution" seam by
// accident.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


  return Object.freeze({
    LIFECYCLE_GRANT_SCHEMA, GRANT_TTL_SECONDS, GRANT_KEYS, GRANT_BINDING_KIND_ENUM, GRANT_AUTHORITY_ENUM, GRANT_PROFILE_ENUM, GRANT_PROFILE_ADMITTED_SUBCOMMANDS, GRANT_PROFILE_FOR_BINDING_KIND,
    GRANT_AUTHORITY_FOR_BINDING_KIND, GRANT_ACTION_ID_REQUIRED_SUBCOMMANDS, grantPathFor, grantConsumedMarkerPathFor, grantArraysEqual, isWellFormedGrantRole, grantRoleMatchesExpectation,
    mintLifecycleCommandGrant, validateAndConsumeLifecycleCommandGrant,
  });
}

module.exports = { createLifecycleCommandGrant };

