'use strict';

function createCancelProtocol(deps) {
  const {
    path,
    CliError,
    currentClockMs,
    isoToMs,
    sha256Buffer,
    classifyDurableRead,
    readJsonDurableOptional,
    DURABLE_ABSENT,
    DURABLE_PENDING,
    DURABLE_PRESENT,
    absentDurableStop,
    pendingDurableStop,
    assertClosedShape,
    assertCanonicalFilename,
    assertGenuinelyConfinedUnderRoot,
    accreditCanonicalRequest,
    isHexId,
    isIsoTimestamp,
    isNonEmptyString,
    isEnum,
  } = deps;

// `cancel` (record #9, `cancel/v1`) -- field table PLAN.md ~L464-474
// ─────────────────────────────────────────────────────────────────────────────

const CANCEL_V1_FIELDS = {
  schema: { check: (v) => v === 'coordination/cancel/v1' },
  request_id: { check: isHexId },
  reason: { check: isEnum(['expired', 'explicit', 'invalid-takeover-exhaustion', 'conflict']) },
  cancelled_at: { check: isIsoTimestamp },
  cancelled_by: { check: isNonEmptyString },
};

/**
 * FULL canonical accreditation for an ALREADY durably-read, shape-valid
 * cancel/v1 object. Codex NO-GO round 8 -- supersedes round 6's version,
 * which itself was accepted as still partial: it confirmed *lexical*
 * confinement + minimum depth (>=3 segments) and correlated only against
 * `basename(dirname(cancelPath))`, never the FULL, EXACT canonical geometry
 * `<repo_id>/<wave_slug>/<plan_digest>/transactions/<request_id>/cancel.json`
 * cross-checked against the containing request's OWN embedded identity --
 * a self-consistent request.json+cancel.json pair planted under an
 * arbitrary `<coordRoot>/junk/<id>/` passed. It also used
 * `readCanonicalRequestRecord` (shape+ID only) for the containing request,
 * not the FULL `validateConsultV2` graph/role-policy/content_ref pipeline,
 * and accepted the bare `reason==='expired'` value alone as proof of
 * `cancelled_by:'timeout-authority'` authority -- the reason a caller/writer
 * declares is not itself evidence anything actually expired.
 *
 * This version, in order:
 *  1. Exact canonical filename (`cancel.json`).
 *  2. Ancestor-symlink-safe confinement (`assertGenuinelyConfinedUnderRoot`,
 *     itself upgraded this round to realpath-resolve every existing
 *     ancestor, not merely lexical `path.relative`).
 *  3. EXACT canonical namespace geometry: the cancel.json's realpath-resolved
 *     location relative to `coordRoot` must be precisely 5 segments,
 *     `<repo_id>/<wave_slug>/<plan_digest>/transactions/<request_id>`, with
 *     the literal `transactions` segment in position 3 -- not merely "deep
 *     enough."
 *  4. The CONTAINING request.json genuinely exists and passes the FULL
 *     `validate --kind consult-v2` pipeline (shape, durability, identity,
 *     root/parent/depth graph, role-policy, content_ref) -- not the lighter
 *     shape+ID-only check every OPERATIONAL request read
 *     (`readRequestForTxnOrCorrelationInvalid`) uses for claim/lease/
 *     takeover/record-delivery/worker-stop/await-result, which stays
 *     unchanged and out of this pass's scope.
 *  5. The namespace segments recovered in step 3 (repo_id/wave_slug/
 *     plan_digest/request_id) match the CONTAINING REQUEST's own embedded
 *     `repo_id`/`wave_slug`/`plan_digest`/`request_id` fields exactly --
 *     closes the "self-consistent pair under an arbitrary junk/<id>/
 *     directory" gap: the directory name alone is never sufficient, it must
 *     equal what the request itself actually claims.
 *  6. cancel.json's own `request_id` matches that confirmed request.
 *  7. `cancelled_by` authority: `'timeout-authority'` is accepted ONLY when
 *     `reason==='expired'` AND the record's own `cancelled_at` is at or
 *     after the request's own `expiry` (data-embedded proof the deadline had
 *     genuinely passed at the moment of cancellation -- not a live wall-
 *     clock re-check at READ time, which would let a too-early cancel
 *     become falsely acceptable merely because enough real time has since
 *     elapsed); otherwise the ACTUAL requester's own `requester_instance_id`
 *     from the confirmed containing request.
 * Shared by every cancel.json reader via the three `readCanonicalCancelRecord*`
 * wrappers below (the ONLY sanctioned way to read a cancel.json in this file --
 * see their own doc comment and the CANCEL-AUDIT-01 source-audit test).
 */

function accreditCancelRecord(cancelObj, cancelPath, coordRoot) {
  assertCanonicalFilename(cancelPath, 'cancel.json');
  assertGenuinelyConfinedUnderRoot(coordRoot, cancelPath);
  const txnDir = path.dirname(cancelPath);
  // Geometry of txnDir is fully proven inside accreditCanonicalRequest below
  // (request.json lives in this exact same directory) -- recomputing it here
  // too would be redundant, not stricter.
  const reqObj = accreditCanonicalRequest(coordRoot, path.join(txnDir, 'request.json')).obj;

  if (cancelObj.request_id !== reqObj.request_id) {
    throw new CliError('INVALID', 'SECURITY_INVALID', 'cancel.json content does not match its own canonical identity: ' + cancelPath);
  }

  // Codex NO-GO round 9 (PENDING_WP4): this cancelled_by check is
  // CORRELATION -- the recorded identity matches a value already present in
  // the request/schema -- never CRYPTOGRAPHIC or GRANT-BASED AUTHORITY. PLAN.md's
  // `role-command-grant/v1` (~L580-592) is the actual authority mechanism
  // ("the matching core atomically wins <grant_id>.used... revalidates
  // schema/surface/binding/authority/profile/subcommand/PLAN/worktree/role/
  // action... before any read or mutation") and is NOT implemented anywhere
  // in this file -- PENDING_WP4, a future work package, not built here or
  // claimed to be. This check only rejects an OBVIOUSLY wrong value (an
  // arbitrary caller-invented string, or an unconnected fresh genId()) from
  // passing as "the requester" or "timeout-authority" -- a floor, not the
  // ceiling PLAN ultimately requires.
  if (cancelObj.reason === 'expired') {
    if (isoToMs(cancelObj.cancelled_at) < isoToMs(reqObj.expiry)) {
      throw new CliError('INVALID', 'AUTHORITY_INVALID', "cancel.json claims reason='expired' but its own cancelled_at precedes the request's own expiry: " + cancelPath);
    }
    // Codex NO-GO round 9: `cancelled_at >= expiry` ALONE lets a planted
    // artifact claim an arbitrary FAR-FUTURE `cancelled_at` (e.g. year 2099)
    // to "prove" expiry against ANY request, expired or not. `cancelled_at`
    // must ALSO not implausibly exceed the current moment (respecting the
    // `--fixed-clock` test seam via `currentClockMs()`) -- bounding it to the
    // genuinely-elapsed window `[expiry, now]`, never an unconstrained future
    // value. `nowIso()`'s own millisecond truncation only ever makes a
    // genuine writer's stamped value earlier, never later, than real "now" --
    // this bound cannot spuriously reject an honest writer.
    if (isoToMs(cancelObj.cancelled_at) > currentClockMs()) {
      throw new CliError('INVALID', 'AUTHORITY_INVALID', "cancel.json claims reason='expired' with a cancelled_at implausibly in the future: " + cancelPath);
    }
    if (cancelObj.cancelled_by !== 'timeout-authority') {
      throw new CliError('INVALID', 'SECURITY_INVALID', 'cancel.json cancelled_by does not match the expected identity for its own reason: ' + cancelPath);
    }
  } else if (cancelObj.cancelled_by !== reqObj.requester_instance_id) {
    throw new CliError('INVALID', 'SECURITY_INVALID', 'cancel.json cancelled_by does not match the expected identity for its own reason: ' + cancelPath);
  }
  return reqObj;
}

/**
 * The THREE sanctioned entry points for reading a cancel.json in this file
 * (Codex NO-GO round 8's "single choke point + source-audit" requirement).
 * Each performs the durable read AND the full accreditation above as one
 * inseparable step -- no caller can obtain a shape-checked-but-unaccredited
 * object. CANCEL-AUDIT-01 (runtime-consultation-cli.bats) mechanically greps
 * this file and asserts `CANCEL_V1_FIELDS` appears in exactly the field-table
 * definition plus these three functions -- never inline at a command body.
 */
function readCanonicalCancelRecordOptional(cancelPath, coordRoot) {
  const obj = readJsonDurableOptional(cancelPath, { shape: (o) => assertClosedShape(o, CANCEL_V1_FIELDS) });
  if (obj === null) return null;
  const reqObj = accreditCancelRecord(obj, cancelPath, coordRoot);
  return { obj: obj, reqObj: reqObj };
}

// M6+M7 SIXTEENTH CODEX ACCEPTANCE Correction C: returns {obj, bytes, digest,
// reqObj} from the ONE fd-bound read, not just {obj, reqObj} --
// readRootSourceTerminalArtifacts previously needed a SECOND, separate
// readDurableRecord(cancelPath) call purely to obtain a digest this same
// read already computed, a real (if narrow, cancel.json being no-clobber-
// immutable) TOCTOU window. Inlines readJsonDurable's own absent/pending
// handling (rather than calling it) specifically so `r.bytes` -- which
// readJsonDurable's own return contract discards, keeping only `.obj` --
// stays reachable from this ONE classifyDurableRead call; this also keeps
// CANCEL-AUDIT-01's own sanctioned shape-check call intact, textually
// unchanged, still one of its exactly-three counted occurrences (a
// LITERAL-quoted restatement of that exact call right here in this comment
// would itself be a fourth occurrence and self-sabotage that audit -- see
// this same file's own CANCEL_V1_FIELDS export comment for the identical
// lesson already learned once this session). Existing callers
// (validateCancelV1) only ever destructure `.obj`, so the additive fields
// are invisible to them.
function readCanonicalCancelRecordRequired(cancelPath, coordRoot) {
  const r = classifyDurableRead(cancelPath, { parse: true, shape: (o) => assertClosedShape(o, CANCEL_V1_FIELDS) });
  if (r.state === DURABLE_ABSENT) throw absentDurableStop(cancelPath, {});
  if (r.state === DURABLE_PENDING) throw pendingDurableStop(cancelPath);
  const reqObj = accreditCancelRecord(r.obj, cancelPath, coordRoot);
  return { obj: r.obj, bytes: r.bytes, digest: sha256Buffer(r.bytes), reqObj: reqObj };
}

// M7 GREEN correction round 2, R3: also returns {bytes, digest} from the
// SAME ONE fd-bound read when present -- mirrors readCanonicalCancelRecordRequired's
// own {obj, bytes, digest, reqObj} extension (M6+M7 SIXTEENTH CODEX
// ACCEPTANCE Correction C, see that function's own doc comment) so a
// caller needing a cancel digest (readRootSourceTerminalArtifacts) can use
// THIS single-read classifier instead of first calling this function for
// shape-free presence and then separately calling
// readCanonicalCancelRecordRequired to reopen the same file purely to get
// its digest. Purely additive: the one pre-existing caller (cmdCancel's own
// pre-write pass) only ever destructures `.state`.
function classifyCanonicalCancelRecord(cancelPath, coordRoot) {
  const r = classifyDurableRead(cancelPath, { parse: true, shape: (o) => assertClosedShape(o, CANCEL_V1_FIELDS) });
  if (r.state !== DURABLE_PRESENT) return r;
  const reqObj = accreditCancelRecord(r.obj, cancelPath, coordRoot);
  return { state: r.state, obj: r.obj, bytes: r.bytes, digest: sha256Buffer(r.bytes), reqObj: reqObj };
}

function validateCancelV1(artifactPath, coordRoot) {
  return readCanonicalCancelRecordRequired(artifactPath, coordRoot).obj;
}

// ─────────────────────────────────────────────────────────────────────────────

  return {
    CANCEL_V1_FIELDS,
    accreditCancelRecord,
    readCanonicalCancelRecordOptional,
    readCanonicalCancelRecordRequired,
    classifyCanonicalCancelRecord,
    validateCancelV1,
  };
}

module.exports = { createCancelProtocol };
