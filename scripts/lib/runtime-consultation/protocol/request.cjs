'use strict';

function createRequestProtocol(deps) {
  const {
    fs,
    path,
    CliError,
    sha256Buffer,
    isoToMs,
    blobPathFor,
    planRootFromArtifact,
    requestPathFor,
    readClosedRecord,
    readJsonDurable,
    assertClosedShape,
    isNonEmptyString,
    isNonNegativeInteger,
    orNull,
    isHex64,
    isHexId,
    isIsoTimestamp,
    isContentRefHandle,
    isEnum,
    utf8ByteLength,
  } = deps;

// content_ref resolution -- flat content-addressed blob store, fd-bound (PLAN.md ~L640)
// ─────────────────────────────────────────────────────────────────────────────

function resolveContentRefOrThrow(planRoot, handle) {
  const blobPath = blobPathFor(planRoot, handle.blob);
  let lst;
  try {
    lst = fs.lstatSync(blobPath);
  } catch (err) {
    throw new CliError('INVALID', 'SCHEMA_INVALID', 'content_ref blob not found: ' + handle.blob);
  }
  if (!lst.isFile()) {
    throw new CliError('INVALID', 'SCHEMA_INVALID', 'content_ref blob is not a regular file');
  }
  let fd;
  try {
    fd = fs.openSync(blobPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  } catch (err) {
    if (err && err.code === 'ELOOP') {
      throw new CliError('INVALID', 'SCHEMA_INVALID', 'content_ref blob path is a symlink (rejected at open time)');
    }
    throw err;
  }
  try {
    const fstat = fs.fstatSync(fd);
    if (!fstat.isFile() || fstat.nlink !== 1) {
      throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'content_ref blob durability unproven');
    }
    if (fstat.size !== handle.size || fstat.size > 10485760) {
      throw new CliError('INVALID', 'SCHEMA_INVALID', 'content_ref size mismatch/overflow');
    }
    const bytes = fs.readFileSync(fd);
    const digest = sha256Buffer(bytes);
    if (digest !== handle.digest || digest !== handle.blob) {
      throw new CliError('INVALID', 'SCHEMA_INVALID', 'content_ref digest mismatch');
    }
    const fstat2 = fs.fstatSync(fd);
    if (fstat2.dev !== fstat.dev || fstat2.ino !== fstat.ino || fstat2.size !== fstat.size) {
      throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'content_ref blob identity changed during read');
    }
  } finally {
    fs.closeSync(fd);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Role policy -- mediated-chain guard (PLAN.md ~L668, ~L671)
// ─────────────────────────────────────────────────────────────────────────────

function assertRolePolicy(sourceRole, targetRole) {
  if (targetRole === 'context-provider' && !String(sourceRole).startsWith('arch-')) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'direct specialist -> context-provider is rejected (mediated chain)');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// `consult/v2` (record #1) -- field table PLAN.md ~L272-303
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Codex NO-GO round 5: PLAN.md ~L281/~L659 freezes `max_depth` at the fixed literal
 * `2` -- it is NOT a per-request configurable ceiling. The single source of truth
 * lives here; every site that either writes or compares against the frozen nesting
 * ceiling references this constant, never a bare literal `2`.
 */
const MAX_DEPTH_LIMIT = 2;

const CONSULT_V2_FIELDS = {
  schema: { check: (v) => v === 'coordination/consult/v2' },
  request_id: { check: isHexId },
  root_request_id: { check: isHexId },
  parent_request_id: { check: orNull(isHexId) },
  depth: { check: isNonNegativeInteger },
  // Codex NO-GO round 5: was `isNonNegativeInteger` -- accepted ANY non-negative
  // integer, so a durable, otherwise-canonical record with max_depth:0 (or any value
  // != the frozen 2) passed shape validation. Combined with `cmdPublishRequest`'s own
  // `parentObj.max_depth || 2` truthy-fallback bug (0 is falsy in JS), a parent
  // carrying max_depth:0 was silently treated as max_depth:2, letting a nested publish
  // that should have been rejected succeed and mutate disk. Reproduced empirically.
  // Fixed at the source: max_depth is no longer a free-form field at all, it MUST be
  // exactly the frozen ceiling.
  max_depth: { check: (v) => v === MAX_DEPTH_LIMIT },
  source_role: { check: isNonEmptyString },
  target_role: { check: isNonEmptyString },
  target_role_profile_version: { check: isNonEmptyString },
  target_role_profile_digest: { check: isHex64 },
  requester_worktree_id: { check: isNonEmptyString },
  requester_instance_id: { check: isNonEmptyString },
  repo_id: { check: isNonEmptyString },
  wave_slug: { check: isNonEmptyString },
  protocol_profile: { check: isNonEmptyString },
  coordination_root_id: { check: isNonEmptyString },
  plan_digest: { check: isHex64 },
  subject_repo_id: { check: isNonEmptyString },
  subject_worktree_id: { check: isNonEmptyString },
  subject_head: { check: isNonEmptyString },
  subject_scope_digest: { check: isNonEmptyString },
  created_at: { check: isIsoTimestamp },
  question: { check: (v) => isNonEmptyString(v) && utf8ByteLength(v) <= 8192 },
  content_ref: { required: false, check: isContentRefHandle },
  expected_result_kind: { check: isNonEmptyString },
  expiry: {
    check: (v, whole) => {
      if (!isIsoTimestamp(v)) return false;
      const delta = (isoToMs(v) - isoToMs(whole.created_at)) / 1000;
      return delta >= 120 && delta <= 3600;
    },
  },
  recovery_budget: { check: isNonNegativeInteger },
  routing_policy_version: { check: isNonEmptyString },
  routing_policy_digest: { check: isHex64 },
  initial_attempt_id: { check: isHexId },
  initial_lease_epoch: { check: isNonNegativeInteger },
};

/**
 * Codex NO-GO round 3, blocker 1: the SOLE canonical way to read an authoritative
 * request.json. `readClosedRecord(..., CONSULT_V2_FIELDS, ...)` alone proves
 * durability + fd-bound identity + closed shape, but proves NOTHING about whether the
 * record's OWN embedded `request_id` matches the identity its storage location
 * implies -- a request.json's PATH and its CONTENT can silently diverge (bytes copied
 * wholesale from a genuinely durable, correctly-shaped, DIFFERENT request planted at
 * `transactions/<A>/request.json` while internally still claiming `request_id: "B"`).
 * Empirically reproduced (Codex): a shape-valid, durable, digest-matching request B
 * planted at transaction A's own path made `validate --kind inbox-ref-v1` return
 * SUCCESS. This helper closes that gap with one extra check: `obj.request_id` MUST
 * equal the caller's `expectedRequestId` (mirroring `cmdLeaseHeartbeat`'s own
 * established claim/attempt_id self-consistency check, same SECURITY_INVALID
 * detail_code -- a content/location identity mismatch is a confinement violation, not
 * a mere correlation mismatch). MECHANICAL RULE: no other `readClosedRecord(...,
 * CONSULT_V2_FIELDS, ...)` call may exist anywhere in this file -- every authoritative
 * request.json read funnels through here.
 */
function readCanonicalRequestRecord(requestPath, expectedRequestId, policy) {
  const rec = readClosedRecord(requestPath, CONSULT_V2_FIELDS, policy);
  if (rec.obj.request_id !== expectedRequestId) {
    throw new CliError('INVALID', 'SECURITY_INVALID', 'request.json content does not match its own canonical identity: ' + requestPath);
  }
  return rec;
}

/**
 * The graph/role-policy/content_ref half of the full consult-v2 pipeline,
 * extracted (Codex NO-GO round 9) so a caller that needs the request's own
 * digest alongside its validated `obj` (`accreditCanonicalRequest` below) can
 * reuse this deep validation without a second fd-bound read of the same
 * file -- `validateConsultV2` itself is unchanged below, a thin wrapper
 * around one read plus this.
 */
function validateConsultV2Fields(obj, planRoot) {
  if (obj.content_ref) {
    resolveContentRefOrThrow(planRoot, obj.content_ref);
  }
  validateRequestGraph(obj, planRoot);
  if (obj.depth > obj.max_depth) {
    throw new CliError('INVALID', 'CORRELATION_INVALID', 'depth exceeds max_depth');
  }
  assertRolePolicy(obj.source_role, obj.target_role);
}

/** Full `validate --kind consult-v2` pipeline: shape -> durability -> graph -> role-policy -> content_ref. */
function validateConsultV2(artifactPath, coordRoot) {
  const expectedRequestId = path.basename(path.dirname(artifactPath));
  const obj = readCanonicalRequestRecord(artifactPath, expectedRequestId, {}).obj;
  // DUR-J item 4: durability + fd-bound identity are proven inside readCanonicalRequestRecord
  // above; the old path-based `assertDurable` after a by-path read was a TOCTOU and is gone.
  const planRoot = planRootFromArtifact(coordRoot, artifactPath);
  validateConsultV2Fields(obj, planRoot);
  return obj;
}

/**
 * Root/parent/depth validation table (PLAN.md ~L659-671): root shape, nesting, cycles,
 * cross-root.
 *
 * Codex NO-GO round 4: the walk now validates EVERY edge and EVERY node it traverses,
 * not just the immediate parent's depth relationship. Empirically reproduced: a
 * "root-shaped" (parent_request_id:null, depth:0) but internally self-contradictory
 * ancestor (root_request_id != request_id) was accepted as a valid chain terminus --
 * neither `cmdPublishRequest`'s single-hop parent lookup nor this walk ever re-checked
 * the TERMINAL node's own root invariants, since that check previously lived ONLY in
 * the `obj.parent_request_id === null` branch below (which fires when the artifact
 * BEING validated is itself a root -- never when a root is merely encountered partway
 * through an ancestor walk). Fixed: (1) `parent.depth + 1 === child.depth` is now
 * checked for EVERY edge via a rolling `childObj` cursor (previously gated to the
 * first hop only, `isImmediateParent`); (2) the moment a traversed ancestor's OWN
 * `parent_request_id` is null (it is the chain's terminus), that ancestor is REQUIRED
 * to satisfy the exact same `root_request_id===request_id`/`depth===0` invariants a
 * directly-validated root would -- never silently accepted merely because the walk
 * stops there.
 */
function validateRequestGraph(obj, planRoot) {
  if (obj.parent_request_id === null) {
    if (obj.root_request_id !== obj.request_id) {
      throw new CliError('INVALID', 'CORRELATION_INVALID', 'root request must have root_request_id==request_id');
    }
    if (obj.depth !== 0) {
      throw new CliError('INVALID', 'CORRELATION_INVALID', 'root request must have depth==0');
    }
    return;
  }
  const visited = new Set([obj.request_id]);
  let curId = obj.parent_request_id;
  let childObj = obj; // the node whose depth we are about to verify against curId's own record
  let hops = 0;
  while (curId !== null) {
    if (visited.has(curId)) {
      throw new CliError('INVALID', 'CORRELATION_INVALID', 'parent_request_id cycle detected');
    }
    visited.add(curId);
    // DUR-J: fd-bound durable read of each ancestor request -- an unresolved ancestor
    // stays CORRELATION_INVALID; an nlink==2 / symlink / foreign-owner / malformed
    // ancestor STOPs, never read raw into the topology walk. Codex NO-GO round 2
    // (blocker 3): closed-shape CONSULT_V2_FIELDS is enforced. Round 3 (blocker 1):
    // routed through readCanonicalRequestRecord -- the ancestor's OWN embedded
    // request_id must equal `curId`, never merely parsed/shape-checked and trusted.
    const parentObj = readCanonicalRequestRecord(requestPathFor(planRoot, curId), curId, {
      absentDetail: 'CORRELATION_INVALID',
      absentMessage: 'parent_request_id does not resolve: ' + curId,
    }).obj;
    // Codex NO-GO round 4: every edge, not only the first hop.
    if (parentObj.depth + 1 !== childObj.depth) {
      throw new CliError('INVALID', 'CORRELATION_INVALID', 'depth != parent.depth + 1');
    }
    if (parentObj.root_request_id !== obj.root_request_id) {
      throw new CliError('INVALID', 'CORRELATION_INVALID', 'cross-root parent linkage');
    }
    if (parentObj.parent_request_id === null) {
      // Codex NO-GO round 4: this ancestor IS the chain's terminal root -- it must
      // satisfy the same local invariants a directly-validated root request would,
      // never accepted merely because the walk stops here.
      if (parentObj.root_request_id !== parentObj.request_id) {
        throw new CliError('INVALID', 'CORRELATION_INVALID', 'terminal root must have root_request_id==request_id');
      }
      if (parentObj.depth !== 0) {
        throw new CliError('INVALID', 'CORRELATION_INVALID', 'terminal root must have depth==0');
      }
    }
    childObj = parentObj;
    curId = parentObj.parent_request_id;
    hops += 1;
    if (hops > 4096) {
      throw new CliError('INVALID', 'CORRELATION_INVALID', 'parent chain exceeds sane bound');
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// `inbox-ref/v1` (record #2) -- field table PLAN.md ~L305-316
// ─────────────────────────────────────────────────────────────────────────────

const INBOX_REF_V1_FIELDS = {
  schema: { check: (v) => v === 'coordination/inbox-ref/v1' },
  request_id: { check: isHexId },
  request_digest: { check: isHex64 },
  kind: { check: isEnum(['consult']) },
  target_role: { check: isNonEmptyString },
  created_at: { check: isIsoTimestamp },
};

function validateInboxRefV1(artifactPath, coordRoot) {
  const obj = readJsonDurable(artifactPath);
  assertClosedShape(obj, INBOX_REF_V1_FIELDS);
  // DUR-J item 4: durability + fd-bound identity are proven inside readJsonDurable(artifactPath)
  // above; the old path-based `assertDurable` after a by-path read was a TOCTOU and is gone.
  const planRoot = planRootFromArtifact(coordRoot, artifactPath);
  const reqPath = requestPathFor(planRoot, obj.request_id);
  // DUR-J: fd-bound-durable read; the same bytes drive the request_digest check and the
  // parsed reqObj -- no by-path readFileSync, no TOCTOU between the two. Codex NO-GO
  // round 2 (blocker 3): closed-shape CONSULT_V2_FIELDS is enforced. Round 3 (blocker
  // 1): routed through readCanonicalRequestRecord -- the referenced request's OWN
  // embedded request_id must equal `obj.request_id` (this inbox-ref's own field), not
  // merely a digest match over whatever bytes happen to live at the derived path
  // (bytes copied wholesale from a DIFFERENT, but genuinely valid/durable, request
  // would otherwise still correlate).
  const reqRec = readCanonicalRequestRecord(reqPath, obj.request_id, {
    absentDetail: 'CORRELATION_INVALID',
    absentMessage: 'inbox-ref request_id does not resolve to a request',
  });
  if (reqRec.digest !== obj.request_digest) {
    throw new CliError('INVALID', 'CORRELATION_INVALID', 'inbox-ref request_digest does not match request.json bytes');
  }
  const reqObj = reqRec.obj;
  if (reqObj.target_role !== obj.target_role) {
    throw new CliError('INVALID', 'CORRELATION_INVALID', 'inbox-ref target_role does not match request.target_role');
  }
  return obj;
}

// ─────────────────────────────────────────────────────────────────────────────

  return {
    resolveContentRefOrThrow,
    assertRolePolicy,
    MAX_DEPTH_LIMIT,
    CONSULT_V2_FIELDS,
    readCanonicalRequestRecord,
    validateConsultV2Fields,
    validateConsultV2,
    validateRequestGraph,
    INBOX_REF_V1_FIELDS,
    validateInboxRefV1,
  };
}

module.exports = { createRequestProtocol };
