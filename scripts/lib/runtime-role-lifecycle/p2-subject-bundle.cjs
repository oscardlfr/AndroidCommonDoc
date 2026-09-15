'use strict';

// Extracted behaviorally from runtime-role-lifecycle.cjs: R131 P2
// subject-bundle seed schema (runtime/p2-subject-bundle-seed/v1) -- closed
// caps/entries validator plus the production sealer. readSupervisorLifecycleOwnerState
// is injected (defined in the not-yet-extracted ensure/supervisor zone --
// forward reference, never a require() cycle). Never requires the facade or
// a sibling module.

function createP2SubjectBundle({
  path, rc, hasExactKeys, isHexCsprng32, isHexDigest64, isCanonicalIsoUtc, canonicalJSONStringify,
  discoverPlan, computeRepoId, computeWorktreeId, gitRevParse, findLiveMainOrchestratorBindingForScope,
  computeCoordinationRootId, readSupervisorLifecycleOwnerState, currentClockMsForRegistry,
  readRoleBindingState, roleProfileDigestFor, nowIsoForRegistry, registryRepoDir, publishNoClobber,
}) {
// ── R131 P2: subject-bundle seed schema (runtime/p2-subject-bundle-seed/v1) ────
// Frozen per sequence1-codex-audit.json's codex_binding block (correction1.md).
// Three fixed roles (arch-platform/arch-testing/arch-integration), exact fixed
// caps, and a flat sorted [{role,path},...] entries array. Reuses the SAME
// canonical relative-path predicate runtime-consultation.cjs already exports
// (isSafeRelativeEntryPath) rather than a second hand-written copy.

const P2_SUBJECT_BUNDLE_SEED_SCHEMA = 'runtime/p2-subject-bundle-seed/v1';
const P2_SUBJECT_BUNDLE_SEED_ROLES = Object.freeze(['arch-platform', 'arch-testing', 'arch-integration']);
const P2_SUBJECT_BUNDLE_SEED_CAPS = Object.freeze({
  max_files_per_role: 40,
  max_bytes_per_file: 1048576,
  max_total_bytes_per_role: 8388608,
});
const P2_SUBJECT_BUNDLE_SEED_KEYS = Object.freeze([
  'schema', 'main_binding_id', 'main_actor_instance_id', 'session_generation_id',
  'repo_id', 'worktree_id', 'head', 'plan_sha256', 'wave_slug', 'sealed_at',
  'caps', 'entries',
]);
const P2_SEAL_REQUIRED_ROLES = Object.freeze([
  'arch-integration', 'arch-platform', 'arch-testing',
  'context-provider', 'test-specialist',
]);

/**
 * Safe P2 subject-bundle relative entry-path predicate. Delegates verbatim to
 * runtime-consultation.cjs's own canonical isSafeRelativeEntryPath -- never a
 * second, independently-drifting reimplementation of that security-critical
 * grammar.
 * @param {unknown} v
 * @returns {boolean}
 */
function isSafeP2SubjectPath(v) {
  return rc.isSafeRelativeEntryPath(v);
}

/**
 * Pure, closed-shape validator for a `runtime/p2-subject-bundle-seed/v1`
 * record (P2-SEED-02/03/04). Every hostile shape must fail with its OWN
 * distinct, non-empty reason string -- never one shared bucket. Caps are
 * FIXED at their exact literal values, never merely bounded.
 * @param {unknown} record
 * @returns {{ok:true}|{ok:false,reason:string}}
 */
function validateP2SubjectBundleSeedRecord(record) {
  if (record === null || typeof record !== 'object' || Array.isArray(record)) {
    return { ok: false, reason: 'p2-seed-not-an-object' };
  }
  const keys = Object.keys(record);
  if (keys.length !== P2_SUBJECT_BUNDLE_SEED_KEYS.length
      || !P2_SUBJECT_BUNDLE_SEED_KEYS.every((k) => Object.prototype.hasOwnProperty.call(record, k))) {
    return { ok: false, reason: 'p2-seed-extra-or-missing-key' };
  }
  if (record.schema !== P2_SUBJECT_BUNDLE_SEED_SCHEMA) return { ok: false, reason: 'p2-seed-schema-mismatch' };
  if (!isHexCsprng32(record.main_binding_id)) return { ok: false, reason: 'p2-seed-main-binding-id-invalid' };
  if (!isHexCsprng32(record.main_actor_instance_id)) return { ok: false, reason: 'p2-seed-main-actor-instance-id-invalid' };
  if (!isHexCsprng32(record.session_generation_id)) return { ok: false, reason: 'p2-seed-session-generation-id-invalid' };
  if (!isHexDigest64(record.repo_id)) return { ok: false, reason: 'p2-seed-repo-id-invalid' };
  if (!isHexDigest64(record.worktree_id)) return { ok: false, reason: 'p2-seed-worktree-id-invalid' };
  if (typeof record.head !== 'string' || !/^[0-9a-f]{40}$/.test(record.head)) return { ok: false, reason: 'p2-seed-head-invalid' };
  if (!isHexDigest64(record.plan_sha256)) return { ok: false, reason: 'p2-seed-plan-sha256-invalid' };
  if (typeof record.wave_slug !== 'string' || record.wave_slug.length === 0) return { ok: false, reason: 'p2-seed-wave-slug-invalid' };
  if (!isCanonicalIsoUtc(record.sealed_at)) return { ok: false, reason: 'p2-seed-sealed-at-invalid' };

  const caps = record.caps;
  if (caps === null || typeof caps !== 'object' || Array.isArray(caps)) return { ok: false, reason: 'p2-seed-caps-not-an-object' };
  const capKeys = Object.keys(caps);
  const fixedCapKeys = Object.keys(P2_SUBJECT_BUNDLE_SEED_CAPS);
  if (capKeys.length !== fixedCapKeys.length || !fixedCapKeys.every((k) => Object.prototype.hasOwnProperty.call(caps, k))) {
    return { ok: false, reason: 'p2-seed-caps-extra-or-missing-key' };
  }
  for (const k of fixedCapKeys) {
    if (caps[k] !== P2_SUBJECT_BUNDLE_SEED_CAPS[k]) return { ok: false, reason: 'p2-seed-caps-not-fixed' };
  }

  const entries = record.entries;
  if (!Array.isArray(entries)) return { ok: false, reason: 'p2-seed-entries-not-an-array' };
  const seenRoles = new Set();
  const seenPairs = new Set();
  for (const entry of entries) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return { ok: false, reason: 'p2-seed-entry-not-an-object' };
    const entryKeys = Object.keys(entry);
    if (entryKeys.length !== 2 || !Object.prototype.hasOwnProperty.call(entry, 'role') || !Object.prototype.hasOwnProperty.call(entry, 'path')) {
      return { ok: false, reason: 'p2-seed-entry-extra-or-missing-key' };
    }
    if (!P2_SUBJECT_BUNDLE_SEED_ROLES.includes(entry.role)) return { ok: false, reason: 'p2-seed-entry-role-unknown' };
    if (!isSafeP2SubjectPath(entry.path)) return { ok: false, reason: 'p2-seed-entry-path-invalid' };
    const pairKey = canonicalJSONStringify([entry.role, entry.path]);
    if (seenPairs.has(pairKey)) return { ok: false, reason: 'p2-seed-entry-duplicate' };
    seenPairs.add(pairKey);
    seenRoles.add(entry.role);
  }
  for (const role of P2_SUBJECT_BUNDLE_SEED_ROLES) {
    if (!seenRoles.has(role)) return { ok: false, reason: 'p2-seed-role-missing' };
  }

  return { ok: true };
}

/**
 * Production P2 subject-bundle sealer (P2-SEED-05/06). Two-argument shape
 * only (`projectRoot`, `{waveSlug,entries,caps}`) -- no caller-identity
 * fields anywhere; the sealer itself must derive/revalidate a live
 * MainOrchestratorBinding + SessionGeneration for `projectRoot` before it may
 * seal anything. Zero live authority fails closed with ZERO seed writes, and
 * two unauthorized calls with different entries leave IDENTICAL zero seed
 * state (no partial or divergent write).
 * @param {string} projectRoot
 * @param {{waveSlug:string,entries:Array<{role:string,path:string}>,caps:object}} input
 * @returns {{ok:false,reason:string}}
 */
function sealP2SubjectBundleInput(projectRoot, input) {
  if (typeof projectRoot !== 'string' || projectRoot.length === 0 || !path.isAbsolute(projectRoot)) {
    return { ok: false, reason: 'p2-seal-project-root-invalid' };
  }
  if (
    input === null || typeof input !== 'object' || Array.isArray(input)
    || !hasExactKeys(input, ['caps', 'entries', 'waveSlug'])
  ) {
    return { ok: false, reason: 'p2-seal-input-invalid' };
  }

  const plan = discoverPlan(projectRoot);
  if (!plan.ok) return { ok: false, reason: 'p2-seal-plan-invalid' };
  const waveSlug = path.basename(path.dirname(plan.planPath)).replace(/^wave-/, '');
  if (waveSlug !== input.waveSlug) return { ok: false, reason: 'p2-seal-wave-slug-mismatch' };

  const repoId = computeRepoId(projectRoot);
  const worktreeId = computeWorktreeId(projectRoot);
  const head = gitRevParse(projectRoot, ['rev-parse', 'HEAD']);

  const findResult = findLiveMainOrchestratorBindingForScope(projectRoot, worktreeId, plan.planDigest);
  if (!findResult.ok) return { ok: false, reason: findResult.reason };
  const { binding, generation } = findResult;

  const coordinationRootId = computeCoordinationRootId(projectRoot);
  const ownerState = readSupervisorLifecycleOwnerState(projectRoot, coordinationRootId);
  if (!ownerState.ok || ownerState.state !== 'ACTIVE') {
    return { ok: false, reason: 'p2-seal-roster-not-retained' };
  }
  const ownerRecord = ownerState.record;
  const serviceExpiryMs = Date.parse(ownerRecord.service_expiry);
  if (
    ownerRecord.phase !== 'RETAINED'
    || ownerRecord.worktree_id !== worktreeId
    || ownerRecord.plan_digest !== plan.planDigest
    || ownerRecord.session_generation_id !== generation.generationId
    || !Number.isFinite(serviceExpiryMs) || serviceExpiryMs <= currentClockMsForRegistry()
    || ownerRecord.roles.join('\0') !== P2_SEAL_REQUIRED_ROLES.join('\0')
  ) {
    return { ok: false, reason: 'p2-seal-roster-not-retained' };
  }

  for (const role of P2_SEAL_REQUIRED_ROLES) {
    const roleState = readRoleBindingState(
      projectRoot, worktreeId, plan.planDigest,
      roleProfileDigestFor(role), generation.generationId, role,
    );
    if (!roleState.ok || roleState.state !== 'READY' || !roleState.record) {
      return { ok: false, reason: 'p2-seal-role-not-ready' };
    }
  }

  const record = {
    schema: P2_SUBJECT_BUNDLE_SEED_SCHEMA,
    main_binding_id: binding.binding_id,
    main_actor_instance_id: binding.actor_instance_id,
    session_generation_id: generation.generationId,
    repo_id: repoId,
    worktree_id: worktreeId,
    head,
    plan_sha256: plan.planDigest,
    wave_slug: input.waveSlug,
    sealed_at: nowIsoForRegistry(),
    caps: { ...input.caps },
    entries: input.entries.map((entry) => ({ role: entry.role, path: entry.path })),
  };

  const validation = validateP2SubjectBundleSeedRecord(record);
  if (!validation.ok) return validation;

  const seedPath = path.join(
    registryRepoDir(projectRoot), 'p2-runs', input.waveSlug + '.seed.json',
  );

  try {
    publishNoClobber(seedPath, Buffer.from(canonicalJSONStringify(record), 'utf8'), {});
  } catch (err) {
    return { ok: false, reason: 'p2-seal-publish-failed' };
  }

  return { ok: true, record, seedPath };
}

  return Object.freeze({
    P2_SUBJECT_BUNDLE_SEED_SCHEMA, P2_SUBJECT_BUNDLE_SEED_ROLES, P2_SUBJECT_BUNDLE_SEED_CAPS,
    P2_SUBJECT_BUNDLE_SEED_KEYS, P2_SEAL_REQUIRED_ROLES, isSafeP2SubjectPath,
    validateP2SubjectBundleSeedRecord, sealP2SubjectBundleInput,
  });
}

module.exports = { createP2SubjectBundle };
