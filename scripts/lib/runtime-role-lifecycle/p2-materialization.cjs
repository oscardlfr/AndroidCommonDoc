'use strict';

// Extracted behaviorally from runtime-role-lifecycle.cjs: P2/root-consult
// subject-bundle materialization -- common artifact projection, the P2
// bundle materializer, and the architect subject-bundle materializer
// consult-root/mixed-review-request both call. Never requires the facade or
// a sibling module.

function createP2Materialization({
path, fs, registryRepoDir, readRegistryRecord, hasExactKeys, canonicalJSONStringify, sha256String,
  isSafeP2SubjectPath, gitRevParse, computeCoordinationRootIdFromPath, s16ConsultationApi,
  P2_SUBJECT_BUNDLE_SEED_ROLES, P2_SUBJECT_BUNDLE_SEED_SCHEMA, P2_SUBJECT_BUNDLE_SEED_CAPS,
  ROOT_SOURCE_BOOTSTRAP_FINAL_LINE, publishNoClobber, realpathOrSelf, s16CoordinationRelativeRef,
  sha256Buffer, sha256File, validateP2SubjectBundleSeedRecord,
}) {

function s16MaterializeCommonArtifacts(projectRoot, context) {
  const api = s16ConsultationApi();
  if (!api || typeof api.materializePlanRef !== 'function'
      || typeof api.materializeRoutingPolicy !== 'function'
      || typeof api.materializeSubjectBundle !== 'function') {
    return { ok: false, reason: 's16-materializer-unavailable' };
  }
  const waveSlug = path.basename(path.dirname(context.plan.planPath)).replace(/^wave-/, '');
  const planRoot = path.join(context.coordRoot, context.repoId, waveSlug, context.plan.planDigest);
  const emptyManifest = { schema: 'coordination/subject-bundle-manifest/v1', entries: [] };
  const emptyBytes = Buffer.from(canonicalJSONStringify(emptyManifest), 'utf8');
  const subjectScopeDigest = sha256Buffer(emptyBytes);
  try {
    api.materializePlanRef(planRoot, context.plan.planPath);
    api.materializeRoutingPolicy(planRoot);
    api.materializeSubjectBundle(planRoot, subjectScopeDigest, emptyManifest);
    const planPath = path.join(planRoot, 'plan_ref');
    const routingDigest = typeof api.ROUTING_POLICY_DIGEST === 'string'
      ? api.ROUTING_POLICY_DIGEST : sha256File(path.join(__dirname, '..', 'runtime-routing.json'));
    const routingPath = path.join(planRoot, 'routing-policies', routingDigest + '.json');
    const subjectPath = path.join(planRoot, 'subject-bundles', subjectScopeDigest, 'manifest.json');
    return {
      ok: true, planRoot, waveSlug,
      planRef: s16CoordinationRelativeRef(context.coordRoot, planPath),
      routingRef: s16CoordinationRelativeRef(context.coordRoot, routingPath),
      routingDigest,
      subjectBundleRef: s16CoordinationRelativeRef(context.coordRoot, subjectPath),
      subjectScopeDigest,
    };
  } catch (err) { return { ok: false, reason: 's16-materialization-failed' }; }
}

/**
 * Fd-bound, real-bytes-only materialization builder for one P2 subject-bundle
 * seed's role scope (P2-MAT-01..04). Filters `seedRecord.entries` to exactly
 * `role`, then for each entry (sorted by path): opens with O_NOFOLLOW (never
 * follows a symlink), fstat()s the OPEN fd (never a separate lstat/stat --
 * closes the classic TOCTOU race), requires a REGULAR file with nlink===1
 * (categorically rejects a hardlink), and requires the entry's confined
 * relative path to realpath to a location still inside `projectRoot` (blocks
 * `../` escape even through an intermediate symlinked directory segment).
 * Every byte read is the SAME fd that passed every check above -- never a
 * second, unguarded re-open. Caps (file count / per-file bytes / total bytes
 * for the role) are FIXED at the seed's own `caps` object and enforced before
 * any blob is returned. Returns EITHER `{ok:true,manifest,blobs,
 * subjectScopeDigest}` OR `{ok:false,reason}` -- never a partial result.
 * @param {string} projectRoot
 * @param {object} seedRecord - a `runtime/p2-subject-bundle-seed/v1` record.
 * @param {string} role
 * @returns {{ok:true,manifest:object,blobs:Array<object>,subjectScopeDigest:string}|{ok:false,reason:string}}
 */
function buildP2SubjectBundleMaterialization(projectRoot, seedRecord, role) {
  if (seedRecord === null || typeof seedRecord !== 'object' || !Array.isArray(seedRecord.entries)) {
    return { ok: false, reason: 'p2-mat-seed-invalid' };
  }
  if (typeof role !== 'string' || role.length === 0) return { ok: false, reason: 'p2-mat-role-invalid' };
  if (!P2_SUBJECT_BUNDLE_SEED_ROLES.includes(role)) return { ok: false, reason: 'p2-mat-role-unknown' };

  const caps = (seedRecord.caps && typeof seedRecord.caps === 'object') ? seedRecord.caps : P2_SUBJECT_BUNDLE_SEED_CAPS;
  const roleEntries = seedRecord.entries
    .filter((e) => e && e.role === role)
    .map((e) => e.path)
    .slice()
    .sort();
  if (roleEntries.length === 0) return { ok: false, reason: 'p2-mat-role-scope-empty' };
  if (roleEntries.length > caps.max_files_per_role) return { ok: false, reason: 'p2-mat-file-count-cap-exceeded' };

  const projectRootReal = realpathOrSelf(projectRoot);
  const blobs = [];
  const manifestEntries = [];
  let totalBytes = 0;

  for (const relPath of roleEntries) {
    if (!isSafeP2SubjectPath(relPath)) return { ok: false, reason: 'p2-mat-entry-path-invalid' };
    const abs = path.join(projectRoot, relPath);
    let fd;
    try {
      fd = fs.openSync(abs, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    } catch (err) {
      return { ok: false, reason: 'p2-mat-entry-open-failed' };
    }
    try {
      let stat;
      let pathStat;
      try {
        stat = fs.fstatSync(fd);
        pathStat = fs.lstatSync(abs);
      } catch (err) {
        return { ok: false, reason: 'p2-mat-entry-fstat-failed' };
      }
      // Node exposes O_NOFOLLOW as zero/no-op on Windows.  Bind the opened
      // handle back to a non-symlink directory entry on every platform so
      // NTFS reparse points cannot be accepted as ordinary subject files.
      if (pathStat.isSymbolicLink()) return { ok: false, reason: 'p2-mat-entry-symlink' };
      if (!stat.isFile()) return { ok: false, reason: 'p2-mat-entry-not-a-regular-file' };
      if (!pathStat.isFile() || pathStat.dev !== stat.dev || pathStat.ino !== stat.ino) {
        return { ok: false, reason: 'p2-mat-entry-identity-mismatch' };
      }
      if (stat.nlink !== 1) return { ok: false, reason: 'p2-mat-entry-hardlinked' };
      let real;
      try {
        real = fs.realpathSync(abs);
      } catch (err) {
        return { ok: false, reason: 'p2-mat-entry-realpath-failed' };
      }
      if (real !== projectRootReal && !real.startsWith(projectRootReal + path.sep)) {
        return { ok: false, reason: 'p2-mat-entry-escapes-project-root' };
      }
      if (stat.size > caps.max_bytes_per_file) return { ok: false, reason: 'p2-mat-file-size-cap-exceeded' };
      totalBytes += stat.size;
      if (totalBytes > caps.max_total_bytes_per_role) return { ok: false, reason: 'p2-mat-total-size-cap-exceeded' };
      let bytes;
      try {
        bytes = fs.readFileSync(fd);
      } catch (err) {
        return { ok: false, reason: 'p2-mat-entry-read-failed' };
      }
      if (bytes.length !== stat.size) return { ok: false, reason: 'p2-mat-entry-size-mismatch' };
      let finalPathStat;
      try { finalPathStat = fs.lstatSync(abs); } catch { return { ok: false, reason: 'p2-mat-entry-path-changed' }; }
      if (finalPathStat.isSymbolicLink() || finalPathStat.dev !== stat.dev || finalPathStat.ino !== stat.ino) {
        return { ok: false, reason: 'p2-mat-entry-path-changed' };
      }
      const digest = sha256Buffer(bytes);
      manifestEntries.push({ path: relPath, size: bytes.length, digest });
      blobs.push({ path: relPath, bytes, size: bytes.length, digest });
    } finally {
      try { fs.closeSync(fd); } catch (err) { /* already closed or unrecoverable -- nothing further to release */ }
    }
  }

  const manifest = { schema: 'coordination/subject-bundle-manifest/v1', entries: manifestEntries };
  const subjectScopeDigest = sha256Buffer(Buffer.from(canonicalJSONStringify(manifest), 'utf8'));
  return { ok: true, manifest, blobs, subjectScopeDigest };
}

/**
 * Materializes the architect subject bundle for the current wave.
 *
 * Resolves the wave's P2 seed record (if present) and validates it against
 * the live plan/repo/worktree/generation/binding context, then rebuilds the
 * plan ref, routing policy, and subject bundle blobs from that seed,
 * publishing each blob idempotently before delegating to the consultation
 * API to materialize the subject bundle. When no seed record exists, falls
 * back to {@link s16MaterializeCommonArtifacts} verbatim. Never throws;
 * all failure paths are returned as `{ok:false,reason}`.
 *
 * @param {string} projectRoot absolute path to the project root
 * @param {object} context wave context containing plan, repoId, worktreeId,
 *   coordRoot, generation, and binding information
 * @param {string} requesterRole role requesting the subject bundle materialization
 * @returns {object} `{ok:false,reason}` on failure, or on success the common
 *   materialization shape `{ok:true,planRoot,waveSlug,planRef,routingRef,
 *   routingDigest,subjectBundleRef,subjectScopeDigest}`
 */
function s16MaterializeArchitectSubjectBundle(projectRoot, context, requesterRole) {
  const waveSlug = path
    .basename(path.dirname(context.plan.planPath))
    .replace(/^wave-/, '');
  const seedPath = path.join(registryRepoDir(projectRoot), 'p2-runs', waveSlug + '.seed.json');

  const read = readRegistryRecord(seedPath);
  if (!read.ok) {
    return { ok: false, reason: read.reason };
  }
  if (read.absent) {
    return s16MaterializeCommonArtifacts(projectRoot, context);
  }

  const validation = validateP2SubjectBundleSeedRecord(read.obj);
  if (!validation.ok) {
    return validation;
  }
  const seed = read.obj;

  const head = gitRevParse(projectRoot, ['rev-parse', 'HEAD']);
  const mismatches = [
    [seed.wave_slug, waveSlug],
    [seed.head, head],
    [seed.plan_sha256, context.plan.planDigest],
    [seed.repo_id, context.repoId],
    [seed.worktree_id, context.worktreeId],
    [seed.session_generation_id, context.generation.generationId],
    [seed.main_binding_id, context.binding.binding_id],
    [seed.main_actor_instance_id, context.binding.actor_instance_id],
  ];
  for (const [expected, actual] of mismatches) {
    if (expected !== actual) {
      return { ok: false, reason: 'p2-seed-context-mismatch' };
    }
  }

  const built = buildP2SubjectBundleMaterialization(projectRoot, seed, requesterRole);
  if (!built.ok) {
    return built;
  }
  if (!Array.isArray(built.manifest.entries) || built.manifest.entries.length === 0) {
    return { ok: false, reason: 'p2-seed-context-mismatch' };
  }

  const api = s16ConsultationApi();
  if (
    typeof api.materializePlanRef !== 'function' ||
    typeof api.materializeRoutingPolicy !== 'function' ||
    typeof api.materializeSubjectBundle !== 'function'
  ) {
    return { ok: false, reason: 's16-materializer-unavailable' };
  }
  const { materializePlanRef, materializeRoutingPolicy, materializeSubjectBundle } = api;

  const planRoot = path.join(
    context.coordRoot,
    context.repoId,
    waveSlug,
    context.plan.planDigest
  );

  try {
    materializePlanRef(planRoot, context.plan.planPath);
    materializeRoutingPolicy(planRoot);

    for (const blob of built.blobs) {
      const blobPath = path.join(planRoot, 'blobs', blob.digest);
      publishNoClobber(blobPath, blob.bytes, { allowIdenticalIdempotent: true });
    }

    materializeSubjectBundle(planRoot, built.subjectScopeDigest, built.manifest);

    const planPath = path.join(planRoot, 'plan_ref');
    const routingDigest =
      typeof api.ROUTING_POLICY_DIGEST === 'string'
        ? api.ROUTING_POLICY_DIGEST
        : sha256File(path.join(__dirname, '..', 'runtime-routing.json'));
    const routingPath = path.join(planRoot, 'routing-policies', routingDigest + '.json');
    const subjectPath = path.join(
      planRoot,
      'subject-bundles',
      built.subjectScopeDigest,
      'manifest.json'
    );

    return {
      ok: true,
      planRoot,
      waveSlug,
      planRef: s16CoordinationRelativeRef(context.coordRoot, planPath),
      routingRef: s16CoordinationRelativeRef(context.coordRoot, routingPath),
      routingDigest,
      subjectBundleRef: s16CoordinationRelativeRef(context.coordRoot, subjectPath),
      subjectScopeDigest: built.subjectScopeDigest,
    };
  } catch (err) {
    return { ok: false, reason: 's16-materialization-failed' };
  }
}

function s16ReadOptionalValidated(recordPath, validator, expected) {
  const read = readRegistryRecord(recordPath);
  if (!read.ok) return { ok: false, reason: read.reason };
  if (read.absent) return { ok: true, absent: true };
  const valid = validator(read.obj, expected);
  if (!valid.ok) return valid;
  return { ok: true, absent: false, record: valid.record, digest: sha256String(canonicalJSONStringify(valid.record)) };
}

  return Object.freeze({
s16MaterializeCommonArtifacts, buildP2SubjectBundleMaterialization,
    s16MaterializeArchitectSubjectBundle, s16ReadOptionalValidated,
  });
}

module.exports = { createP2Materialization };
