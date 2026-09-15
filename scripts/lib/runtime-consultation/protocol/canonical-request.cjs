'use strict';

function createCanonicalRequestProtocol(deps) {
  const {
    fs,
    path,
    CliError,
    realpathDeepestExisting,
    assertCanonicalFilename,
    assertGenuinelyConfinedUnderRoot,
    planRootFromArtifact,
    realpathOrSelf,
    resultPathFor,
    classifyDurableRead,
    DURABLE_ABSENT,
    DURABLE_PENDING,
    readCanonicalRequestRecord,
    validateConsultV2Fields,
    resolveAuthoritativeAttempt,
    validateResultV2,
    validateRootConfinement,
  } = deps;

/**
 * EXACT canonical namespace geometry for a transaction directory: ancestor-
 * symlink-safe (realpath, not lexical), and precisely 5 segments
 * `<repo_id>/<wave_slug>/<plan_digest>/transactions/<request_id>` below
 * `coordRoot` -- never a bare "deep enough" minimum-depth check. Shared by
 * `accreditCanonicalRequest` below and (transitively, through it)
 * `accreditCancelRecord` -- ONE geometry computation, not one per artifact
 * type, since request.json and cancel.json always share this same directory.
 */
function assertExactCanonicalGeometry(coordRoot, txnDir) {
  let realCoordRoot;
  try {
    realCoordRoot = fs.realpathSync(coordRoot);
  } catch (err) {
    throw new CliError('INVALID', 'SECURITY_INVALID', 'coordination_root does not resolve: ' + coordRoot);
  }
  // A genuinely never-published transaction (a caller-supplied --request that
  // does not resolve at all) must still surface as CORRELATION_INVALID once
  // this geometry check passes and the actual request read is attempted --
  // never SECURITY_INVALID merely because txnDir itself does not YET exist.
  // realpathDeepestExisting resolves symlinks in whatever ancestor chain
  // ACTUALLY exists (proving no ancestor escape) and lexically appends the
  // (necessarily non-existent, hence un-symlinked) tail, exactly mirroring
  // assertGenuinelyConfinedUnderRoot's own graceful-absence handling.
  const { real: realExistingAncestor, tail } = realpathDeepestExisting(txnDir);
  const realTxnDir = tail.length ? path.join(realExistingAncestor, ...tail) : realExistingAncestor;
  const rel = path.relative(realCoordRoot, realTxnDir);
  const segments = rel.split(path.sep).filter(Boolean);
  if (rel === '' || rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel) || segments.length !== 5 || segments[3] !== 'transactions') {
    throw new CliError('INVALID', 'SECURITY_INVALID', 'artifact is not stored at its exact canonical namespace path once symlinks are resolved: ' + txnDir);
  }
  return { repoId: segments[0], waveSlug: segments[1], planDigest: segments[2], requestId: segments[4] };
}

/**
 * THE canonical accreditor for a request.json -- used directly by
 * `cmdCancel`/`cmdAcceptResult`/`cmdAwaitResult` for their own `--request`,
 * and reused by `accreditCancelRecord` below for its containing-request
 * check. Codex NO-GO round 9: those three commands each only checked
 * filename + confinement + MINIMUM depth (`planRootFromArtifact`) + shape+ID
 * (`readRequestForTxnOrCorrelationInvalid`) for their OWN `--request` --
 * never the EXACT geometry or FULL `validateConsultV2` pipeline
 * `accreditCancelRecord` already required for an EXISTING cancel.json. This
 * let `cmdCancel` durably WRITE a cancel.json next to a request.json that
 * this exact function (reached the moment ANY reader, including
 * `accreditCancelRecord` itself, later looks at that cancel.json) would
 * immediately reject -- a write reporting SUCCESS whose own artifact no
 * reader ever accepts. NOTE: `claim`/`lease-heartbeat`/`takeover`/
 * `record-delivery`/`worker-stop` still use the lighter
 * `readRequestForTxnOrCorrelationInvalid` for their own `--request`; whether
 * they share this same asymmetry is out of this pass's named scope
 * (cancel/accept-result/await-result only) and is flagged, not fixed, here.
 */
function accreditCanonicalRequest(coordRoot, requestPath) {
  assertCanonicalFilename(requestPath, 'request.json');
  assertGenuinelyConfinedUnderRoot(coordRoot, requestPath);
  const txnDir = path.dirname(requestPath);
  const geo = assertExactCanonicalGeometry(coordRoot, txnDir);
  // ONE fd-bound read (DUR-J item 6): readCanonicalRequestRecord already
  // proves durability + shape + content/location-identity (request_id ==
  // geo.requestId) and returns {obj, digest} in a single pass -- callers that
  // need the digest (cmdAcceptResult) get it without a second, TOCTOU-risking
  // read of the same file. validateConsultV2Fields reuses the SAME deep
  // graph/role-policy/content_ref validation validateConsultV2's own
  // standalone `validate --kind consult-v2` entry point uses.
  const rec = readCanonicalRequestRecord(requestPath, geo.requestId, {
    absentDetail: 'CORRELATION_INVALID',
    absentMessage: 'referenced request.json does not resolve',
  });
  const reqObj = rec.obj;
  if (reqObj.repo_id !== geo.repoId || reqObj.wave_slug !== geo.waveSlug || reqObj.plan_digest !== geo.planDigest) {
    throw new CliError('INVALID', 'SECURITY_INVALID', "request.json canonical path segments do not match its own embedded identity: " + requestPath);
  }
  const planRoot = planRootFromArtifact(coordRoot, requestPath);
  validateConsultV2Fields(reqObj, planRoot);
  // Codex NO-GO round 12/13: the full fd-bound stat snapshot (from the same
  // read as digest -- see readDurableRecord's own doc comment) surfaced
  // additively so a caller needing to prove request.json was never replaced
  // OR in-place-rewritten-and-restored (either of which digest alone can
  // miss) can compare the SAME complete snapshot across two separate calls.
  return {
    obj: reqObj, digest: rec.digest,
    dev: rec.dev, ino: rec.ino, nlink: rec.nlink, size: rec.size, mode: rec.mode, uid: rec.uid, gid: rec.gid, ctimeNs: rec.ctimeNs, mtimeNs: rec.mtimeNs,
  };
}

/**
 * Codex NO-GO round 12: request.json is published exactly once and never
 * rewritten (PLAN.md ~L813, "immutable"). cmdCancel/cmdAcceptResult's own
 * round-11 fix re-accredited fresh INSIDE the lock but then TRUSTED whatever
 * that fresh read found -- silently ADOPTING a mid-wait mutation instead of
 * detecting and rejecting it, exactly the bug round 11 itself corrected for
 * cmdAwaitResult but never applied symmetrically here. ANY divergence between
 * a preflight accreditation and a later one is evidence of an illegal
 * mutation, never a legitimate update to adopt.
 *
 * Codex NO-GO round 13: comparing only digest+dev+ino still misses an
 * IN-PLACE rewrite that restores the exact original bytes before this check
 * runs -- same inode throughout (dev/ino never differ), same final content
 * (digest never differs), yet the file was genuinely mutated in between.
 * Compares the FULL fd-bound snapshot classifyDurableRead itself already
 * trusts (dev/ino/nlink/size/mode/uid/gid/ctimeNs/mtimeNs) plus digest -- any
 * genuine mutation, even one whose final state is byte-identical, changes at
 * least ctimeNs (and typically mtimeNs), so this is not a hand-picked subset
 * that could miss the same class of gap a second time.
 */
function assertRequestIdentityMatches(preflightRec, laterRec, requestPath) {
  if (laterRec.digest !== preflightRec.digest
      || laterRec.dev !== preflightRec.dev || laterRec.ino !== preflightRec.ino
      || laterRec.nlink !== preflightRec.nlink || laterRec.size !== preflightRec.size
      || laterRec.mode !== preflightRec.mode || laterRec.uid !== preflightRec.uid || laterRec.gid !== preflightRec.gid
      || laterRec.ctimeNs !== preflightRec.ctimeNs || laterRec.mtimeNs !== preflightRec.mtimeNs) {
    throw new CliError('INVALID', 'SECURITY_INVALID', 'request.json changed since preflight -- request.json is immutable per PLAN.md ~L813: ' + requestPath);
  }
}

/**
 * Read-only bridge primitive for a canonical request's authoritative result.
 * The request is accredited twice around the candidate read so an immutable
 * request replacement/rewrite is never silently adopted.  The candidate path
 * is derived exclusively from the request's current authoritative attempt;
 * callers never supply it.  PRESENT is returned only after the complete
 * result-v2 validator (correlation, authority and dependency chain) succeeds.
 *
 * @returns {{status:'absent'|'pending',request:object,requestDigest:string,candidatePath:string,attemptId:string,leaseEpoch:number}|{status:'present',request:object,requestDigest:string,candidatePath:string,attemptId:string,leaseEpoch:number,result:object,resultDigest:string}}
 */
function classifyCanonicalResultForRequest(coordRootRaw, requestPathRaw) {
  validateRootConfinement(coordRootRaw);
  const coordRoot = realpathOrSelf(coordRootRaw);
  const before = accreditCanonicalRequest(coordRoot, requestPathRaw);
  const txnDir = path.dirname(requestPathRaw);
  const authority = resolveAuthoritativeAttempt(before.obj, txnDir);
  const candidatePath = resultPathFor(txnDir, authority.attemptId);
  const classified = classifyDurableRead(candidatePath, {});
  const after = accreditCanonicalRequest(coordRoot, requestPathRaw);
  assertRequestIdentityMatches(before, after, requestPathRaw);
  const summary = {
    request: before.obj,
    requestDigest: before.digest,
    candidatePath,
    attemptId: authority.attemptId,
    leaseEpoch: authority.leaseEpoch,
  };
  if (classified.state === DURABLE_ABSENT) return Object.assign({ status: 'absent' }, summary);
  if (classified.state === DURABLE_PENDING) return Object.assign({ status: 'pending' }, summary);
  const validated = validateResultV2(candidatePath, coordRoot);
  const finalRequest = accreditCanonicalRequest(coordRoot, requestPathRaw);
  assertRequestIdentityMatches(before, finalRequest, requestPathRaw);
  return Object.assign({
    status: 'present',
    result: validated.obj,
    resultDigest: validated.digest,
  }, summary);
}


  return {
    assertExactCanonicalGeometry,
    accreditCanonicalRequest,
    assertRequestIdentityMatches,
    classifyCanonicalResultForRequest,
  };
}

module.exports = { createCanonicalRequestProtocol };
