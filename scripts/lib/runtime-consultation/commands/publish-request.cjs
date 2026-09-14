'use strict';

// `publish-request` command controller (Ordered Runtime Loop steps 1-5): validate+materialize, then publish the canonical request.json.

function createPublishRequestCommand({
  CliError,
  assertArtifactMatchesReceipt,
  assertRolePolicy,
  buildCanonicalRequest,
  buildCanonicalRequestFromFields,
  canonicalJSONStringify,
  computeCoordRootId,
  computeRepoId,
  computeSubjectHead,
  computeWorktreeId,
  decodeIntentOrThrow,
  decodeSubjectBundleManifestOrThrow,
  fs,
  genId,
  materializePlanRef,
  materializeRoutingPolicy,
  materializeSubjectBundle,
  nowIso,
  path,
  planRootPath,
  publishNoClobber,
  requestPathFor,
  requireFlags,
  resolveAbsolute,
  resolveContentRefOrThrow,
  sha256File,
  sha256String,
  validateConsultV2,
}) {
/** Publish the exact bytes returned by buildCanonicalRequest; replay is legal only byte-identically. */
function publishPreallocatedRequest(capability, input) {
  const built = buildCanonicalRequest(capability, input);
  fs.mkdirSync(built.planRoot, { recursive: true });
  materializePlanRef(built.planRoot, built.planPath);
  materializeRoutingPolicy(built.planRoot);
  materializeSubjectBundle(built.planRoot, built.subjectScopeDigest, built.subjectBundleManifest);
  const receipt = publishNoClobber(built.requestPath, built.bytes, { allowIdenticalIdempotent: true });
  assertArtifactMatchesReceipt(built.requestPath, receipt, built.bytes);
  return {
    request_id: built.request.request_id,
    artifact_ref: built.requestPath,
    request_digest: built.digest,
    request: built.request,
  };
}

function cmdPublishRequest(flags, grantContext) {
  requireFlags(flags, ['coordination-root', 'plan', 'subject-bundle', 'intent']);
  const coordRoot = resolveAbsolute(flags['coordination-root']);
  const planPath = resolveAbsolute(flags.plan);
  const intent = decodeIntentOrThrow(flags.intent);
  const subjectBundlePath = resolveAbsolute(flags['subject-bundle']);
  const subjectBundleManifest = decodeSubjectBundleManifestOrThrow(subjectBundlePath);

  const planDigest = sha256File(planPath);
  const waveSlug = path.basename(path.dirname(planPath)).replace(/^wave-/, '');
  const repoId = computeRepoId(coordRoot);
  const worktreeId = computeWorktreeId(coordRoot);
  const coordRootId = computeCoordRootId(coordRoot);
  const subjectHead = computeSubjectHead(coordRoot);
  // subject_scope_digest = sha256 of the caller's OWN validated manifest content
  // (canonicalized) -- not a HEAD-only placeholder. Two textually-different
  // manifests at the identical HEAD now produce two different digests (Finding #3).
  // Full git-scope-scanning (tracked/modified/untracked/deleted/renamed entries,
  // PLAN.md ~L647) remains WP2/WP3; this is the WP1-realizable subset.
  const subjectScopeDigest = sha256String(canonicalJSONStringify(subjectBundleManifest));

  const planRoot = planRootPath(coordRoot, repoId, waveSlug, planDigest);

  // Codex NO-GO round 3 (blocker 2): the FULL parent validation must complete BEFORE
  // the FIRST write. This block moved ahead of planRoot's own materialization
  // (mkdirSync/plan_ref/routing-policy/subject-bundle below) -- neither `planRoot`
  // (a pure path computation) nor reading an EXISTING parent's request.json (if the
  // parent was ever genuinely published, its own txnDir already exists from THAT
  // call) requires planRoot to be created by US first. A schema-invalid/absent/
  // depth-exceeding parent must never let this call grow the persistent inventory
  // even though the overall publish ultimately fails (Codex repro: parent
  // schema-invalid -> rc3/SCHEMA_INVALID, but the inventory still grew from 3 to 9
  // entries under the prior write-before-validate order).
  let parentRequestId = null;
  let depth = 0;
  let rootRequestId;
  if (intent.parent_request_id) {
    parentRequestId = intent.parent_request_id;
    // Codex NO-GO round 4: the parent is now validated via the FULL canonical
    // pipeline (`validateConsultV2` -- durability + identity + closed shape + the
    // COMPLETE ancestry graph walk, now itself hardened this same round to check
    // every edge and the walk's terminal root -- + role-policy + content_ref), not
    // merely durability+shape+identity. A parent that is itself durable/shape-valid/
    // canonically-identified but has an INVALID ancestry somewhere up its OWN chain
    // (e.g. a corrupted terminal root) must not be trusted to derive this nested
    // request's depth/root_request_id from -- reproduced: a parent with
    // parent_request_id:null/depth:0 but root_request_id!=request_id previously let
    // BOTH this call and a subsequent `validate --kind consult-v2` on the resulting
    // child return SUCCESS.
    const parentPath = requestPathFor(planRoot, parentRequestId);
    let parentObj;
    try {
      parentObj = validateConsultV2(parentPath, coordRoot);
    } catch (err) {
      // A genuinely ABSENT parent stays CORRELATION_INVALID, this call site's own
      // pre-existing contract (`validateConsultV2` itself defaults absence to
      // SCHEMA_INVALID, correct for its OTHER caller, direct `validate` on an
      // arbitrary --artifact path). Every OTHER validateConsultV2 failure (shape,
      // graph/ancestry, role-policy, content_ref) propagates with its own correct
      // detail_code exactly as thrown, never silently downgraded or re-labeled.
      if (err && err.durableAbsent) {
        throw new CliError('INVALID', 'CORRELATION_INVALID', 'parent_request_id does not resolve to an existing request');
      }
      throw err;
    }
    depth = parentObj.depth + 1;
    rootRequestId = parentObj.root_request_id;
    // Codex NO-GO round 5: was `parentObj.max_depth || 2` -- a parent that passed
    // validateConsultV2 with max_depth:0 (0 is falsy in JS) had its real ceiling
    // silently replaced by the default 2, permitting nesting the record itself
    // forbade. `parentObj.max_depth` is now compared directly: CONSULT_V2_FIELDS
    // guarantees it is exactly MAX_DEPTH_LIMIT already (validateConsultV2 would have
    // thrown SCHEMA_INVALID otherwise), so no fallback is needed or safe to have.
    if (depth > parentObj.max_depth) {
      throw new CliError('INVALID', 'CORRELATION_INVALID', 'nested request would exceed max_depth');
    }
  }

  // M7/WP4 group A correction (dispatch arch-testing-20260810T142647Z):
  // source_role is now derived EXCLUSIVELY from the authenticated requester
  // grant/binding this exact command was already required to consume
  // before this handler ever ran (main()'s own
  // validateAndConsumeRoleCommandGrantForCommand call, strictly before any
  // read or mutation) -- never from a caller-supplied environment variable.
  // RUNTIME_CONSULTATION_SOURCE_ROLE was never reachable from a genuine
  // hook-mediated call in the first place: an env-var-PREFIXED command
  // (`FOO=bar node ...`) is not the canonical `node <script> <args...>`
  // token[0]==='node' shape the requester-grant-injecting hook recognizes,
  // so a live call always fell back to the literal 'cli-requester', which
  // could never pass assertRolePolicy's mediated-chain guard for
  // target_role:'context-provider'. A grant missing its role at this point
  // (strictly after full grant/binding consumption+validation) is a
  // genuine authority failure, never a value to silently default away.
  //
  // Main-review correction (orchestrating session, Phase 4): this check now
  // runs BEFORE planRoot's own materialization (mkdirSync/plan_ref/
  // routing-policy/subject-bundle below) -- mirrors the identical "validate
  // fully before the first write" discipline the parent-request validation
  // block above this already established (Codex NO-GO round 3). An
  // unauthorized-role grant (e.g. a legitimately-minted but non-arch-*
  // requester grant reaching this handler) must never be able to cause any
  // of these four writes before being rejected.
  if (!grantContext || typeof grantContext.role !== 'string' || grantContext.role.length === 0) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'publish-request requires an authenticated requester grant to derive source_role');
  }
  const sourceRole = grantContext.role;
  assertRolePolicy(sourceRole, intent.target_role);

  fs.mkdirSync(planRoot, { recursive: true });
  materializePlanRef(planRoot, planPath);
  materializeRoutingPolicy(planRoot);
  materializeSubjectBundle(planRoot, subjectScopeDigest, subjectBundleManifest);

  const requestId = genId();
  if (!parentRequestId) rootRequestId = requestId;

  const builtRequest = buildCanonicalRequestFromFields({
    requestId,
    rootRequestId,
    parentRequestId,
    depth,
    sourceRole,
    targetRole: intent.target_role,
    requesterInstanceId: grantContext.actorInstanceId,
    repoId,
    worktreeId,
    waveSlug,
    coordinationRootId: coordRootId,
    planDigest,
    subjectHead,
    subjectScopeDigest,
    createdAt: nowIso(),
    question: intent.question,
    expectedResultKind: intent.expected_result_kind,
    expiry: intent.expiry,
    initialAttemptId: genId(),
    contentRef: intent.content_ref,
  });
  const requestObj = builtRequest.request;

  // Gap#2 (WP2 conformance, PLAN.md ~L761): "content_ref must equal a freshly
  // revalidated publish-blob handle" -- a shape-valid-but-fabricated content_ref
  // (blob != digest, or no real backing file) must be rejected HERE, at publish
  // time, not only by a later optional `validate` call. Mirrors
  // validateConsultV2's own `if (obj.content_ref) resolveContentRefOrThrow(...)`
  // pattern (~L893-895), applied here to the not-yet-published request object.
  if (intent.content_ref) resolveContentRefOrThrow(planRoot, intent.content_ref);

  // Fail closed on any internal inconsistency rather than publishing a record
  // `validate --kind consult-v2` would later reject.
  const requestPath = requestPathFor(planRoot, requestId);
  publishNoClobber(requestPath, builtRequest.bytes, { allowIdenticalIdempotent: true });

  return { request_id: requestId, artifact_ref: requestPath };
}

  return Object.freeze({
    cmdPublishRequest,
    publishPreallocatedRequest,
  });
}

module.exports = { createPublishRequestCommand };
