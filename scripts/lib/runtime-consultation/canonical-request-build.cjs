'use strict';

// `--intent`/subject-bundle decoding, plan-ref/routing-policy/subject-bundle materialization, and canonical request field derivation.

function createCanonicalRequestBuild({
  CONSULT_V2_FIELDS,
  CliError,
  MAX_DEPTH_LIMIT,
  ROUTING_POLICY_CONTENT,
  ROUTING_POLICY_DIGEST,
  ROUTING_POLICY_VERSION,
  TARGET_ROLE_PROFILE_VERSION,
  assertClosedShape,
  assertRolePolicy,
  canonicalJSONStringify,
  computeCoordRootId,
  computeRepoId,
  computeSubjectHead,
  computeWorktreeId,
  decodeBase64Url,
  fs,
  hostBridgeAllowedChildRoles,
  isContentRefHandle,
  isHex64,
  isHexId,
  isIsoTimestamp,
  isNonEmptyString,
  isNonNegativeInteger,
  parseJsonOrSchemaInvalid,
  path,
  planRootPath,
  publishNoClobber,
  readArtifactBytes,
  requestPathFor,
  requireHostBridgeCapability,
  resolveAbsolute,
  resolveContentRefOrThrow,
  sha256Buffer,
  sha256File,
  sha256String,
  targetRoleProfileDigestFor,
  utf8ByteLength,
  validateConsultV2,
}) {
const INTENT_FIELDS = {
  target_role: { check: isNonEmptyString },
  question: { check: (v) => isNonEmptyString(v) && utf8ByteLength(v) <= 8192 },
  content_ref: { required: false, check: isContentRefHandle },
  expected_result_kind: { check: isNonEmptyString },
  expiry: { check: isIsoTimestamp },
  parent_request_id: { required: false, check: isHexId },
};

/** Decodes+validates the base64url `--intent` payload against its OWN closed shape. */
function decodeIntentOrThrow(intentB64) {
  const buf = decodeBase64Url(intentB64);
  let obj;
  try {
    obj = JSON.parse(buf.toString('utf8'));
  } catch (err) {
    throw new CliError('INVALID', 'INVALID_ARGUMENT', 'intent is not valid JSON');
  }
  assertClosedShape(obj, INTENT_FIELDS);
  return obj;
}

/**
 * `subject-bundle-manifest/v1` -- minimal closed shape (PLAN.md ~L647, ~L804).
 * `entries` carries the caller's manifested subject-scope entries. The manifest
 * must NOT itself carry `subject_scope_digest` -- that value is always DERIVED (hash
 * of this exact validated manifest), never caller-supplied, so a caller cannot forge
 * a digest that does not match its own manifest bytes.
 */
const SUBJECT_BUNDLE_MANIFEST_V1_FIELDS = {
  schema: { check: (v) => v === 'coordination/subject-bundle-manifest/v1' },
  entries: { check: (v) => Array.isArray(v) },
};

/**
 * Safe RELATIVE entry-path predicate (distinct from `assertSafeSegment`, which
 * forbids ANY separator and is used for single-component filenames like request
 * IDs). A manifest entry path may be nested (`src/Foo.kt`) but must never be
 * absolute, traverse (`..`), contain a NUL byte or any other control character,
 * name a `.git` segment (categorical Git-metadata rejection, PLAN.md ~L777), or
 * embed a backslash ANYWHERE (WP2 BLOB-AUTH PATH-04 correction).
 *
 * The backslash rejection is unconditional, not merely an addition to the
 * segment denylist below: every consumer of an already-grammar-validated entry
 * path (this file's own `BLOB_DENYLISTED_SEGMENTS` categorical check and
 * `cmdPublishBlob`'s own per-component confinement walk) splits the value on
 * `/` ONLY. A value like `innocuous\.ssh\config` contains zero `/` characters,
 * so without a grammar-level `\` rejection it sails through both of those
 * downstream `/`-only splits as one long, non-matching "segment" and is never
 * compared piecewise against anything they categorically forbid. Rejecting `\`
 * HERE -- before either downstream split ever runs -- is what keeps that
 * split-on-`/` convention sound, instead of requiring every current and future
 * caller to separately remember to split on both separators.
 */
function isSafeRelativeEntryPath(v) {
  if (typeof v !== 'string' || v.length === 0 || v.length > 2048) return false;
  for (let i = 0; i < v.length; i += 1) {
    const code = v.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return false; // control chars, NUL (0x00) included
  }
  if (v.includes('\\')) return false;
  if (path.isAbsolute(v)) return false;
  const segments = v.split('/');
  for (const seg of segments) {
    if (seg === '' || seg === '.' || seg === '..' || seg === '.git') return false;
  }
  return true;
}

/**
 * Per-entry closed shape for `publish-blob`'s "exact manifested subject entry"
 * (PLAN.md ~L760, ~L777): the manifest author's own pre-declared expected
 * size/digest, revalidated against the fd-bound real file at `publish-blob` time
 * -- never trusted alone. `size`/`digest` are optional at the manifest-shape
 * level -- an entry may exist in the subject bundle purely to influence
 * `subject_scope_digest` (e.g. `runtime-consultation-protocol.bats` RCP-publish-4's
 * `{"path":"fixture-a.txt"}`-only fixtures) without ever being `publish-blob`-eligible;
 * `cmdPublishBlob` itself requires both to be present on the MATCHED entry before
 * treating it as a valid blob source (SCHEMA_INVALID otherwise).
 */
const SUBJECT_BUNDLE_ENTRY_FIELDS = {
  path: { check: isSafeRelativeEntryPath },
  size: { required: false, check: isNonNegativeInteger },
  digest: { required: false, check: isHex64 },
};

/**
 * Reads+parses+validates the `--subject-bundle` manifest file against its OWN closed
 * shape, plus each entry's own closed shape (additive: an empty `entries` array --
 * every WP1 fixture -- trivially satisfies this with nothing to iterate). Unlike
 * `decodeIntentOrThrow` (base64url argv payload), this is a path to a caller-prepared
 * file on disk (Frozen CLI ABI `publish-request`/`publish-blob` rows, PLAN.md ~L760-761).
 */
function decodeSubjectBundleManifestOrThrow(manifestPath) {
  const bytes = readArtifactBytes(manifestPath);
  const obj = parseJsonOrSchemaInvalid(bytes);
  assertClosedShape(obj, SUBJECT_BUNDLE_MANIFEST_V1_FIELDS);
  for (const entry of obj.entries) {
    assertClosedShape(entry, SUBJECT_BUNDLE_ENTRY_FIELDS);
  }
  return obj;
}

function materializePlanRef(planRoot, planPath) {
  const bytes = fs.readFileSync(planPath);
  return publishNoClobber(path.join(planRoot, 'plan_ref'), bytes, { allowIdenticalIdempotent: true });
}

function materializeRoutingPolicy(planRoot) {
  const dest = path.join(planRoot, 'routing-policies', ROUTING_POLICY_DIGEST + '.json');
  return publishNoClobber(dest, ROUTING_POLICY_CONTENT, { allowIdenticalIdempotent: true });
}

/**
 * Materializes the caller-supplied (validated) subject-bundle manifest at its
 * content-addressed path, keyed by the manifest's own `subject_scope_digest`
 * (PLAN.md ~L632, ~L804: "one bundle per subject", "if not already present for this
 * exact `subject_scope_digest`"). Writes the SAME canonical bytes the digest was
 * computed over, so a later re-hash of the on-disk file reproduces
 * `subject_scope_digest` exactly -- matching this file's raw-file-digest-equals-
 * canonical-digest-by-construction convention (PLAN.md ~L646) used for every other
 * writer-produced record.
 */
function materializeSubjectBundle(planRoot, subjectScopeDigest, manifestObj) {
  const dest = path.join(planRoot, 'subject-bundles', subjectScopeDigest, 'manifest.json');
  const bytes = Buffer.from(canonicalJSONStringify(manifestObj), 'utf8');
  return publishNoClobber(dest, bytes, { allowIdenticalIdempotent: true });
}

/**
 * Pure canonical request constructor shared by ordinary CLI publication and
 * Sixteenth's preallocated retained-worker root WAL.  All entropy and time
 * are inputs; this function never reads a clock, generates an id, or writes.
 */
function buildCanonicalRequestFromFields(fields) {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
    throw new CliError('INVALID', 'SCHEMA_INVALID', 'canonical request fields are invalid');
  }
  const requestObj = {
    schema: 'coordination/consult/v2',
    request_id: fields.requestId,
    root_request_id: fields.rootRequestId || fields.requestId,
    parent_request_id: fields.parentRequestId === undefined ? null : fields.parentRequestId,
    depth: fields.depth === undefined ? 0 : fields.depth,
    max_depth: MAX_DEPTH_LIMIT,
    source_role: fields.sourceRole,
    target_role: fields.targetRole,
    target_role_profile_version: fields.targetRoleProfileVersion || TARGET_ROLE_PROFILE_VERSION,
    target_role_profile_digest: fields.targetRoleProfileDigest || targetRoleProfileDigestFor(fields.targetRole),
    requester_worktree_id: fields.worktreeId,
    requester_instance_id: fields.requesterInstanceId,
    repo_id: fields.repoId,
    wave_slug: fields.waveSlug,
    protocol_profile: 'runtime-consultation/v1',
    coordination_root_id: fields.coordinationRootId,
    plan_digest: fields.planDigest,
    subject_repo_id: fields.subjectRepoId || fields.repoId,
    subject_worktree_id: fields.subjectWorktreeId || fields.worktreeId,
    subject_head: fields.subjectHead,
    subject_scope_digest: fields.subjectScopeDigest,
    created_at: fields.createdAt,
    question: fields.question,
    expected_result_kind: fields.expectedResultKind,
    expiry: fields.expiry,
    recovery_budget: 1,
    routing_policy_version: fields.routingPolicyVersion || ROUTING_POLICY_VERSION,
    routing_policy_digest: fields.routingPolicyDigest || ROUTING_POLICY_DIGEST,
    initial_attempt_id: fields.initialAttemptId,
    initial_lease_epoch: 0,
  };
  if (fields.contentRef !== undefined && fields.contentRef !== null) requestObj.content_ref = fields.contentRef;
  assertClosedShape(requestObj, CONSULT_V2_FIELDS);
  return {
    request: requestObj,
    bytes: Buffer.from(canonicalJSONStringify(requestObj), 'utf8'),
  };
}

function deriveCanonicalRequestFields(coordRoot, planPath, subjectBundleManifest, authority, input) {
  const planDigest = sha256File(planPath);
  const waveSlug = path.basename(path.dirname(planPath)).replace(/^wave-/, '');
  const repoId = computeRepoId(coordRoot);
  const worktreeId = computeWorktreeId(coordRoot);
  const subjectScopeDigest = sha256String(canonicalJSONStringify(subjectBundleManifest));
  const planRoot = planRootPath(coordRoot, repoId, waveSlug, planDigest);
  const parentRequestId = input.parentRequestId === undefined ? null : input.parentRequestId;
  let depth = 0;
  let rootRequestId = input.requestId;
  if (parentRequestId !== null) {
    const parentObj = validateConsultV2(requestPathFor(planRoot, parentRequestId), coordRoot);
    depth = parentObj.depth + 1;
    rootRequestId = parentObj.root_request_id;
    if (depth > parentObj.max_depth) {
      throw new CliError('INVALID', 'CORRELATION_INVALID', 'nested request would exceed max_depth');
    }
  }
  const built = buildCanonicalRequestFromFields({
    requestId: input.requestId,
    initialAttemptId: input.initialAttemptId,
    createdAt: input.createdAt,
    expiry: input.expiry,
    rootRequestId,
    parentRequestId,
    depth,
    sourceRole: authority.role,
    requesterInstanceId: authority.actorInstanceId,
    targetRole: input.targetRole,
    targetRoleProfileVersion: input.targetRoleProfileVersion,
    targetRoleProfileDigest: input.targetRoleProfileDigest,
    question: input.question,
    expectedResultKind: input.expectedResultKind,
    contentRef: input.contentRef,
    repoId,
    worktreeId,
    waveSlug,
    coordinationRootId: computeCoordRootId(coordRoot),
    planDigest,
    subjectHead: computeSubjectHead(coordRoot),
    subjectScopeDigest,
    routingPolicyVersion: input.routingPolicyVersion,
    routingPolicyDigest: input.routingPolicyDigest,
  });
  if (built.request.content_ref) resolveContentRefOrThrow(planRoot, built.request.content_ref);
  assertRolePolicy(built.request.source_role, built.request.target_role);
  return Object.assign(built, {
    coordRoot, planPath, planRoot, planDigest, repoId, worktreeId,
    subjectBundleManifest, subjectScopeDigest,
    requestPath: requestPathFor(planRoot, built.request.request_id),
    digest: sha256Buffer(built.bytes),
  });
}

/**
 * Host-capability-only deterministic constructor for a preallocated request.
 * The public surface intentionally requires the non-serializable capability;
 * arbitrary callers cannot use it as a root-authority factory.
 */
function buildCanonicalRequest(capability, input) {
  const scope = requireHostBridgeCapability(capability);
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new CliError('INVALID', 'SCHEMA_INVALID', 'preallocated request input is invalid');
  }
  const coordRoot = resolveAbsolute(input.coordinationRoot);
  const planPath = resolveAbsolute(input.planPath);
  const manifest = input.subjectBundleManifest;
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new CliError('INVALID', 'SCHEMA_INVALID', 'subject bundle manifest is invalid');
  }
  assertClosedShape(manifest, SUBJECT_BUNDLE_MANIFEST_V1_FIELDS);
  for (const entry of manifest.entries) assertClosedShape(entry, SUBJECT_BUNDLE_ENTRY_FIELDS);
  if (input.parentRequestId !== null && input.parentRequestId !== undefined) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'preallocated root request must have parent_request_id:null');
  }
  if (
    input.routingPolicyVersion !== ROUTING_POLICY_VERSION
    || input.routingPolicyDigest !== ROUTING_POLICY_DIGEST
    || input.targetRoleProfileVersion !== TARGET_ROLE_PROFILE_VERSION
    || input.targetRoleProfileDigest !== targetRoleProfileDigestFor(input.targetRole)
    || !hostBridgeAllowedChildRoles(scope.role).includes(input.targetRole)
  ) throw new CliError('INVALID', 'AUTHORITY_INVALID', 'preallocated root request routing/topology/profile is not current');
  const built = deriveCanonicalRequestFields(coordRoot, planPath, manifest, {
    role: scope.role, actorInstanceId: scope.actorInstanceId,
  }, Object.assign({}, input, { parentRequestId: null }));
  if (
    built.worktreeId !== scope.worktreeId || built.planDigest !== scope.planDigest
    || built.request.source_role !== scope.role
    || built.request.requester_instance_id !== scope.actorInstanceId
    || built.request.root_request_id !== built.request.request_id
    || built.request.depth !== 0
  ) throw new CliError('INVALID', 'AUTHORITY_INVALID', 'preallocated request scope does not match HostBridgeCapability');
  return built;
}

  return Object.freeze({
    INTENT_FIELDS,
    SUBJECT_BUNDLE_ENTRY_FIELDS,
    SUBJECT_BUNDLE_MANIFEST_V1_FIELDS,
    buildCanonicalRequest,
    buildCanonicalRequestFromFields,
    decodeIntentOrThrow,
    decodeSubjectBundleManifestOrThrow,
    deriveCanonicalRequestFields,
    isSafeRelativeEntryPath,
    materializePlanRef,
    materializeRoutingPolicy,
    materializeSubjectBundle,
  });
}

module.exports = { createCanonicalRequestBuild };
