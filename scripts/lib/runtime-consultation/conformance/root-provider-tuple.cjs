'use strict';

// R33 stage-1 canonical-disk-record, root-profile/provider-session/binding conformance (part 2 of 3).

function createRootProviderTupleConformance({
  CliError,
  assertCanonicalFilename,
  assertClosedShape,
  assertGenuinelyConfinedUnderRoot,
  canonicalJSONStringify,
  fs,
  isHex64,
  isHexId,
  isPlainObject,
  path,
  readClosedRecord,
  readDurableRecord,
  realpathDeepestExisting,
  validateRootConfinement,
  COORDINATION_MODE_ENUM,
  C_RECORD_MAX_BYTES,
  PROVIDER_MANAGER_KIND_ENUM,
  PROVIDER_MANAGER_LIFETIME_PROFILE_ENUM,
  PROVIDER_SESSION_V3_BASENAME,
  R33_CONTROL_PROTOCOL,
  R33_PROVIDER_ABI,
  ROOT_PROFILE_V3_BASENAME,
  ROOT_PROFILE_V3_FIELDS,
  RUNTIME_PROFILE_BINDING_V2_FIELDS,
  TRANSITION_LOCK_PROVIDER_NAME,
  assertTemporalAuthorityEnvelopeV1,
  isEnum,
  isId128,
  isIsoUtc,
  isPid,
  lit,
}) {

// ── A.3 `ProviderSessionV3` [28] (R3.3:3652 REPLACE over R3.2:2100-2110) ────

/**
 * `REPLACE(ProviderSessionV2[24], "coordination/provider-session/v3",
 * REMOVE(5), ADD(9))` = 28 keys. REMOVE = schema, provider_abi,
 * control_protocol, started_at, session_expiry. Same two-group ordering
 * convention as ROOT_PROFILE_V3_FIELDS above (ADD in R3.3:3652's order, then
 * retained in R3.2:2100-2110's order).
 *
 * CRITICAL ASYMMETRY -- do NOT "fix" this: `ProviderSessionV3` has NO
 * `protocol_profile` key and no `handle_protocol` key. That is INHERITED, not
 * an R33 invention -- `ProviderSessionV2` [24] (R3.2:2100-2110) never had
 * either. The session binds to the profile TRANSITIVELY, via
 * `root_profile_digest` and `runtime_binding_receipt_digest`. Adding
 * `protocol_profile` here is SCHEMA_INVALID via the closed key set, and a test
 * asserting `ProviderSessionV3.protocol_profile === P33` is asserting against a
 * key that must never exist.
 */
const PROVIDER_SESSION_V3_FIELDS = {
  schema: lit('coordination/provider-session/v3'),
  provider_abi: lit(R33_PROVIDER_ABI),
  control_protocol: lit(R33_CONTROL_PROTOCOL),
  runtime_owner_root_id: { check: isHex64 },
  runtime_binding_receipt_digest: { check: isHex64 },
  clock_domain_id: { check: isId128 },
  clock_domain_receipt_digest: { check: isHex64 },
  // Nested TemporalAuthorityEnvelopeV1 [4]. Only its object-ness is checked
  // here; its closed shape and ordering invariants are enforced by
  // assertTemporalAuthorityEnvelopeV1, called from the sole conformance checker below.
  temporal: { check: isPlainObject },
  started_at_diagnostic_utc: { check: isIsoUtc },
  coordination_root_id: { check: isHex64 },
  physical_root_id: { check: isHex64 },
  coordination_root_identity_security_digest: { check: isHex64 },
  canonical_root_path_digest: { check: isHex64 },
  mount_projection_digest: { check: isHex64 },
  root_generation_id: { check: isId128 },
  root_bootstrap_id: { check: isHexId },
  root_profile_digest: { check: isHex64 },
  local_filesystem_capability_digest: { check: isHex64 },
  mount_generation_digest: { check: isHex64 },
  provider_name: lit(TRANSITION_LOCK_PROVIDER_NAME),
  provider_build_digest: { check: isHex64 },
  provider_session_id: { check: isId128 },
  control_endpoint_id: { check: isId128 },
  provider_manager_instance_id: { check: isHexId },
  provider_manager_kind: { check: isEnum(PROVIDER_MANAGER_KIND_ENUM) },
  provider_manager_lifetime_profile: { check: isEnum(PROVIDER_MANAGER_LIFETIME_PROFILE_ENUM) },
  coordination_mode: { check: isEnum(COORDINATION_MODE_ENUM) },
  owner_pid: { check: isPid },
};

// ── Encoding + path conformance for the two `C` contract records ───────────

/**
 * Canonical-encoding conformance, from the governing preamble of R3.3's
 * Apéndice A (:2373-2374): "Todos los objetos son `additionalProperties:false`,
 * sin duplicate keys, canonical sorted compact JSON. Disk records: UTF-8
 * estricto + un LF".
 *
 * `assertClosedShape` runs AFTER `JSON.parse` and is structurally blind to four
 * things this one byte comparison catches:
 *  1. DUPLICATE KEYS -- the decisive one. `{"provider_abi":2,"provider_abi":3}`
 *     parses to `3` and would otherwise pass conformance. First-wins vs
 *     last-wins differs across parsers, so ONE artifact can be ACCEPTED as R33
 *     here and read as R32 elsewhere: an R32->R33 profile-smuggling vector, which
 *     is exactly what PLAN §3.6's mixed-profile matrix (PLAN.md ~L2888-2894)
 *     exists to prevent.
 *  2. `3.0` / `3e0` -- IEEE-identical to `3`, so `v === 3` cannot reject them.
 *  3. non-sorted or pretty-printed bytes.
 *  4. a missing, extra, or non-LF trailing byte.
 * It also makes the A.5 digests below unambiguous: once the bytes are proven
 * canonical, hashing `canonicalJSONStringify(obj)` and hashing the file's own
 * bytes-minus-LF provably coincide, so no caller can be surprised by which one
 * a formula meant.
 *
 * The 4,096-byte cap itself is enforced upstream by `classifyDurableRead`'s own
 * `maxSize` bound, which rejects on the fstat size BEFORE reading and then
 * reads `size + 1` -- i.e. R3.3:2374's "Readers leen `cap+1`" semantics, with
 * no silent truncation at exactly the cap. No second, weaker size check here.
 */
function assertCanonicalDiskRecordBytes(bytes, obj, artifactPath) {
  if (!bytes.equals(Buffer.from(canonicalJSONStringify(obj) + '\n', 'utf8'))) {
    throw new CliError('INVALID', 'SCHEMA_INVALID', 'artifact bytes are not the canonical sorted compact JSON + single-LF encoding of their own parsed content (duplicate keys, non-canonical number form, unsorted keys, or wrong trailing bytes): ' + artifactPath);
  }
}

/**
 * The two R33 contract records live DIRECTLY at the coordination-root leaf --
 * `C/root-profile.json` and `C/.provider-session` (R3.3:1019-1022) -- not under
 * the `<repo_id>/<wave_slug>/<plan_digest>/transactions/...` geometry every
 * other record in this file uses. `planRootFromArtifact` and
 * `assertExactCanonicalGeometry` are therefore both the WRONG primitives here
 * (the latter demands exactly 5 segments with a literal `transactions` at index
 * 3) and are deliberately not called.
 *
 * Checks, in order: exact canonical filename; ancestor-symlink-safe confinement
 * under `C`; then EXACTLY one path segment below `C`. The final depth check
 * resolves symlinks first (`realpathDeepestExisting`, the same primitive
 * `assertExactCanonicalGeometry` uses) rather than comparing lexically --
 * `path.relative`/`path.resolve` never touch the filesystem, so a nested path
 * whose ancestor is actually a symlink back to `C` would otherwise "relativize"
 * to depth 1 and pass a purely lexical check.
 */
function assertDirectlyAtCoordinationRoot(coordRoot, artifactPath, expectedBasename) {
  assertCanonicalFilename(artifactPath, expectedBasename);
  assertGenuinelyConfinedUnderRoot(coordRoot, artifactPath);
  let realCoordRoot;
  try {
    realCoordRoot = fs.realpathSync(coordRoot);
  } catch (err) {
    throw new CliError('INVALID', 'SECURITY_INVALID', 'coordination_root does not resolve: ' + coordRoot);
  }
  const { real: realExistingAncestor, tail } = realpathDeepestExisting(artifactPath);
  const realArtifact = tail.length ? path.join(realExistingAncestor, ...tail) : realExistingAncestor;
  const segments = path.relative(realCoordRoot, realArtifact).split(path.sep).filter(Boolean);
  if (segments.length !== 1 || segments[0] !== expectedBasename) {
    throw new CliError('INVALID', 'SECURITY_INVALID', 'artifact does not sit directly at the coordination-root leaf ' + expectedBasename + ' once symlinks are resolved: ' + artifactPath);
  }
}

// ── The three sole conformance checkers for the R33 records ────────────

/**
 * SOLE sanctioned reader of a `C/root-profile.json`. Mirrors
 * `readCanonicalRequestRecord`'s own choke-point discipline: path checking,
 * fd-bound durable read, closed shape and canonical encoding are ONE
 * inseparable step, so no caller can obtain a partially-checked
 * object. MECHANICAL RULE: no other `assertClosedShape(...,
 * ROOT_PROFILE_V3_FIELDS)` call may exist anywhere in this file.
 * Returns the full `{obj, bytes, digest, dev, ino, ...}` record so the
 * correlation slice can bind identity without a second, TOCTOU-risking read.
 */
function checkRootProfileV3Conformance(artifactPath, coordRoot) {
  // Phase 0: confinement-check `C` ITSELF before trusting anything inside it. Independent
  // of the tuple path because R3.3:1115-1117 step 12 calls this one on its own,
  // when `.provider-session` does not yet exist.
  const snapshot = snapshotCoordinationRootIdentity(coordRoot);
  assertDirectlyAtCoordinationRoot(coordRoot, artifactPath, ROOT_PROFILE_V3_BASENAME);
  const rec = readClosedRecord(artifactPath, ROOT_PROFILE_V3_FIELDS, { maxSize: C_RECORD_MAX_BYTES });
  assertCanonicalDiskRecordBytes(rec.bytes, rec.obj, artifactPath);
  assertCoordinationRootSnapshotUnchanged(coordRoot, snapshot, 'root-profile read');
  return rec;
}

/**
 * PER-RECORD DIAGNOSTIC ONLY -- NO ROOT-LEVEL AUTHORITY. Applies to BOTH
 * `checkRootProfileV3Conformance` above and `checkProviderSessionV3Conformance`
 * below. Both were formerly reachable as `validate --kind` entries; those kinds
 * were REMOVED in this pass, because a conformance check that returns a public
 * SUCCESS presents as a certifying surface it is not.
 *
 * Each checks exactly ONE record and deliberately never reads its sibling.
 * The concrete consequence, measured, not theorised: under a MIXED root (an R32
 * `coordination/root-profile/v2` at `C/root-profile.json` beside a perfectly
 * valid R33 `.provider-session`), a single-record conformance check on the
 * session SUCCEEDS, and symmetrically for the other pairing.
 *
 * THE MISUSE THIS FORBIDS: a caller that runs either single-record check to
 * completion and concludes "this coordination root is R33" is WRONG. Neither
 * function observes the sibling record, so neither can decide the
 * `unknown/mixed root` row of the mixed-profile matrix (PLAN.md ~L2894).
 * `checkR33ProfileTupleConformance` is the only function here that reads all
 * three records -- and per the section banner even IT establishes conformance
 * only, never authority. PLAN §3.1's tuple-first selection rule
 * (PLAN.md ~L2676-2679) is satisfied by the provider-owned in-process
 * composition, not by anything in this section.
 *
 * WHY THE SINGLE-RECORD SPLIT IS REQUIRED BY THE CONTRACT, not merely
 * convenient, and why it must not be "fixed" into a sibling requirement:
 * R3.3:1115-1117 step 12 publishes AND READS BACK `RootProfileV3` while
 * explicitly "no publicar aún ProviderSessionV3"; only step 17 publishes the
 * session. The contract therefore mandates an intermediate state in which
 * `C/root-profile.json` must be read back while `C/.provider-session` does not
 * yet exist. A function that demanded the sibling would make that mandated
 * readback impossible -- it would violate the bootstrap sequence, not merely
 * complicate it.
 *
 * CONTRACT-MANDATED CALLERS: step 12 calls the root-profile check, step 17 calls
 * the provider-session check. Those callers live in the provider-owned in-process
 * composition and DO NOT EXIST YET, so these functions are currently caller-less
 * production code awaiting their consumer. Any CLI exposure of them is a
 * diagnostic convenience and never an authority surface; step 18 --
 * `BootstrapReceipt` plus live capabilities -- is the first authority-success
 * point and is not implemented here.
 *
 * ABSENT vs PRESENT-BUT-WRONG-PROFILE IS NOT ABI-OBSERVABLE. PLAN.md ~L2911
 * requires that a `C` path occupied by the other profile's bytes be
 * PRESENT_INVALID and "nunca ABSENT". That holds BY CONSTRUCTION:
 * `classifyDurableRead` returns ABSENT only on ENOENT at open, so a present file
 * carrying R32 bytes structurally cannot take the absent branch -- it is read,
 * then fails shape.
 *
 * But it is NOT observable through the CLI AT ALL. `PRESENT_INVALID` is not one
 * of the 16 frozen `detail_code` values (PLAN.md ~L791), so it can never be
 * emitted, and both outcomes are BYTE-IDENTICAL on stdout AND stderr -- measured,
 * not inferred: same `status:"INVALID"`, same `detail_code:"SCHEMA_INVALID"`,
 * same nulls, and stderr empty in both cases. The `CliError` message is never
 * emitted anywhere, because `main()` writes to stderr only for NON-`CliError`
 * throws and the frozen envelope (PLAN.md ~L789) has no message field. So the
 * message is NOT a discriminator either -- an earlier revision of this comment
 * claimed it was, which was wrong.
 *
 * The property is therefore provable ONLY at the library boundary, via the
 * exported `classifyDurableRead`, which is the exact function where the
 * distinction lives: R32 bytes at this path return `state === DURABLE_PRESENT`,
 * a missing path returns `state === DURABLE_ABSENT`. That is a mechanism-level
 * test rather than a diagnostic-string test, so it cannot rot when a message is
 * reworded.
 *
 * `absentDetail` is deliberately NOT given a distinct code: no frozen code
 * denotes absence, so inventing one would mean repurposing a frozen value or
 * breaking this file's own documented not-found convention (see cjs:4017-4018).
 */

/**
 * SOLE sanctioned reader of a `C/.provider-session`, same discipline as
 * `checkRootProfileV3Conformance` plus the nested temporal envelope's closed shape and
 * ordering invariants. MECHANICAL RULE: no other `assertClosedShape(...,
 * PROVIDER_SESSION_V3_FIELDS)` call may exist anywhere in this file -- the
 * `temporal` field's own table entry checks object-ness ONLY, so a bypassing
 * caller would silently skip every invariant in
 * `assertTemporalAuthorityEnvelopeV1`.
 */
function checkProviderSessionV3Conformance(artifactPath, coordRoot) {
  // Phase 0, as above -- step 17 calls this one on its own.
  const snapshot = snapshotCoordinationRootIdentity(coordRoot);
  assertDirectlyAtCoordinationRoot(coordRoot, artifactPath, PROVIDER_SESSION_V3_BASENAME);
  const rec = readClosedRecord(artifactPath, PROVIDER_SESSION_V3_FIELDS, { maxSize: C_RECORD_MAX_BYTES });
  assertCanonicalDiskRecordBytes(rec.bytes, rec.obj, artifactPath);
  assertTemporalAuthorityEnvelopeV1(rec.obj.temporal);
  assertCoordinationRootSnapshotUnchanged(coordRoot, snapshot, 'provider-session read');
  return rec;
}

/**
 * `RuntimeProfileBindingV2` is barred from `C` (R3.3:1037-1039: "Fuera de los
 * dos contract records obligatorios `root-profile.json` y `.provider-session`
 * ya enumerados, ningún runtime-owner/provider evidence R33 se escribe en `C`").
 * That is a TWO-SIDED must: `C` holds exactly those two records, so an artifact
 * resolving INSIDE `C` must not pass conformance as a binding, however
 * well-formed its bytes are.
 *
 * Realpath-resolved, never lexical, for the same reason `assertGenuinelyConfined
 * UnderRoot` and `assertDirectlyAtCoordinationRoot` resolve first (cjs:419-426:
 * `path.relative`/`path.resolve` never touch the filesystem, so a path whose
 * ancestor is actually a symlink into `C` would otherwise "relativize" as
 * outside and slip past a lexical check).
 *
 * This is a NEGATIVE location constraint only. It grants its caller no path
 * authority whatsoever -- it proves where the artifact is NOT, never where it
 * legitimately lives, because R33 defines no such place.
 */
function assertNotInsideCoordinationRoot(coordRoot, artifactPath) {
  let realCoordRoot;
  try {
    realCoordRoot = fs.realpathSync(coordRoot);
  } catch (err) {
    throw new CliError('INVALID', 'SECURITY_INVALID', 'coordination_root does not resolve: ' + coordRoot);
  }
  const { real: realExistingAncestor, tail } = realpathDeepestExisting(artifactPath);
  const realArtifact = tail.length ? path.join(realExistingAncestor, ...tail) : realExistingAncestor;
  const rel = path.relative(realCoordRoot, realArtifact);
  const escapes = rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel);
  if (!escapes) {
    throw new CliError('INVALID', 'SECURITY_INVALID', 'a RuntimeProfileBindingV2 must not live inside the coordination root, which holds exactly root-profile.json and .provider-session (R3.3:1037-1039): ' + artifactPath);
  }
}

/**
 * Coordination-root confinement check, phase 0 of every entry point in this section.
 * Reuses `validateRootConfinement` -- the SAME primitive `root-validate` uses,
 * never a second weaker check -- which proves in one call that `C` is not a
 * symlink, is a real directory, is owner-confined, is EXACTLY mode 0700, and is
 * confined to its own git worktree.
 *
 * This closes a gap that let a caller mint a coordination root wholly outside
 * Git, at mode 0777, or behind a symlink, and have three self-consistent records
 * inside it pass every check in this section. Confining the ARTIFACT to `C`
 * (`assertDirectlyAtCoordinationRoot`) never proved anything about `C` ITSELF.
 *
 * Returns a NON-AUTHORITATIVE SNAPSHOT of the root's `dev/ino/mode/uid/gid`.
 *
 * IT IS A SNAPSHOT, NOT A WITNESS, AND IT DOES NOT CLOSE THE TOCTOU. An earlier
 * revision of this comment claimed a re-checked snapshot proves ONE accredited
 * identity was used throughout. That was WRONG and is withdrawn. Every check
 * here is a PATH-BASED `lstat` sample, so all it can establish is that the
 * identity matched AT EACH SAMPLING POINT. Three gaps survive:
 *  1. substitution between `validateRootConfinement` and the first `lstat`;
 *  2. an ABA cycle -- swap `C`, serve a different record, restore before the
 *     next sample -- which is invisible to path-based sampling by construction;
 *  3. worst and clearest: the record reads themselves re-resolve
 *     `path.join(coordRoot, basename)` AT READ TIME, so a swap DURING a read is
 *     served from the substitute while both surrounding samples see the
 *     original. No amount of sampling around a read can fix a read that
 *     re-resolves its own path.
 *
 * Closing this needs a retained `C_fd` (openat-equivalent) with SAME-FD reads,
 * so the records are read THROUGH the accredited directory handle rather than
 * re-resolved by name. That is provider-owned retained-handle work and belongs
 * to Phase B; it is deliberately not attempted here, and this snapshot must not
 * be presented as a substitute for it.
 *
 * What it is still worth: it catches the non-adversarial cases -- a root
 * renamed, chmod'd or chown'd mid-sequence -- and it makes the checked
 * identity OBSERVABLE to the caller, which is the only reason a test can check
 * which root a result came from at all.
 *
 * @param {string} coordRoot - absolute coordination root `C`.
 * @returns {{dev: bigint, ino: bigint, mode: bigint, uid: bigint, gid: bigint}}
 */
function snapshotCoordinationRootIdentity(coordRoot) {
  validateRootConfinement(coordRoot);
  const st = fs.lstatSync(coordRoot, { bigint: true });
  return { dev: st.dev, ino: st.ino, mode: st.mode, uid: st.uid, gid: st.gid };
}

/**
 * Re-proves the coordination root is still the SAME directory, unchanged, as the
 * one snapshotted at phase 0. A fresh `lstat` on the path, compared field by
 * field against the snapshot: a rename/replace changes dev or ino, a chmod
 * changes mode, a chown changes uid/gid. Called after each record read.
 *
 * Bounded claim: this detects a change that is STILL VISIBLE at the moment of
 * sampling. It does not detect an ABA cycle that restores the original before
 * this runs, and it cannot speak for what the read itself resolved -- see the
 * three surviving gaps on `snapshotCoordinationRootIdentity` above.
 */
function assertCoordinationRootSnapshotUnchanged(coordRoot, snapshot, afterWhat) {
  let st;
  try {
    st = fs.lstatSync(coordRoot, { bigint: true });
  } catch (err) {
    throw new CliError('INVALID', 'SECURITY_INVALID', 'coordination root vanished during conformance checking (after ' + afterWhat + '): ' + coordRoot);
  }
  if (st.dev !== snapshot.dev || st.ino !== snapshot.ino || st.mode !== snapshot.mode
      || st.uid !== snapshot.uid || st.gid !== snapshot.gid) {
    throw new CliError('INVALID', 'SECURITY_INVALID', 'coordination root identity changed during conformance checking (rebound/chmod/chown after ' + afterWhat + '): ' + coordRoot);
  }
}

/**
 * The binding's PATHLESS DIAGNOSTIC CARRIER admits EXACTLY TWO byte forms and no
 * others: the canonical payload, or that same payload followed by EXACTLY ONE
 * LF. Both are exact whole-buffer comparisons -- deliberately NOT an `endsWith`
 * test and NOT a trim, either of which would let CRLF, two-or-more LFs, or
 * surrounding whitespace through.
 *
 * Why a tolerance exists here at all, when the two `C` records require exactly
 * one LF: R3.3:2374 distinguishes "Disk records: UTF-8 estricto + un LF" from
 * "frames: sin LF", and `RuntimeProfileBindingV2` has NO defined disk path and
 * NO defined transport, so the source does not say which side of that line it
 * falls on. The resolution is to be strictly closed on every axis R3.3 DOES
 * specify for all closed objects (canonical sorted compact JSON, no duplicate
 * keys, no `3.0`-style numerics -- R3.3:2373) and permissive ONLY on the single
 * axis it leaves unstated for this record.
 *
 * DERIVED DECISION, with a condition attached: if `RuntimeProfileBindingV2` ever
 * gains a defined disk path or transport, this MUST be tightened to that form's
 * rule -- for a disk record, exactly one LF, i.e. `assertCanonicalDiskRecordBytes`.
 * The tolerance belongs exclusively to this pathless diagnostic carrier and
 * grants no path or transport authority.
 *
 * Note this closes the duplicate-key R32->R33 smuggling vector on the ONE record
 * whose whole purpose is carrying the P33 literal: without it,
 * `{"protocol_profile":P32, ..., "protocol_profile":P33}` parses last-wins to
 * P33 and is ACCEPTED here while a first-wins parser elsewhere reads P32.
 */
function assertBindingCarrierBytes(bytes, obj, artifactPath) {
  const canonical = Buffer.from(canonicalJSONStringify(obj), 'utf8');
  if (bytes.equals(canonical)) return;
  if (bytes.equals(Buffer.concat([canonical, Buffer.from('\n', 'utf8')]))) return;
  throw new CliError('INVALID', 'SCHEMA_INVALID', 'RuntimeProfileBindingV2 carrier bytes are neither the canonical payload nor the canonical payload plus exactly one LF '
    + '(CRLF, repeated LFs, surrounding whitespace, pretty-printing, unsorted keys, duplicate keys and non-canonical numerics are all rejected): ' + artifactPath);
}

/**
 * SHAPE + CARRIER-ENCODING conformance for a `RuntimeProfileBindingV2`, plus the
 * negative "not inside `C`" location constraint. No CLI surface (see the tuple
 * function's note on why the `validate --kind` exposure was removed).
 *
 * It carries NO POSITIVE PATH AUTHORITY WHATSOEVER -- R33 defines no legitimate
 * location for this record, so a later stage must not read a location guarantee
 * into this function that it does not make. And because all six fields are fixed
 * literals, passing this check means only that the caller reproduced a constant:
 * it is conformance, never identity.
 *
 * DIGEST OPERAND (stated here so a later stage cannot get it wrong): any digest
 * or correlation over this record MUST use the canonical payload,
 * `canonicalJSONStringify(obj)`, NEVER the carrier's raw bytes -- the carrier
 * may legally carry a trailing LF that is not part of the payload, so hashing
 * `rec.bytes` would yield two different digests for one logically identical
 * binding. There is no binding digest formula in this stage; this note exists so
 * the one that arrives later starts from the payload.
 */
function checkRuntimeProfileBindingV2Conformance(artifactPath, coordRoot) {
  assertNotInsideCoordinationRoot(coordRoot, artifactPath);
  // No `maxSize` override: the generic DEFAULT_MAX_DURABLE_ARTIFACT_BYTES bound
  // applies as operational parser protection, not as an R33 contractual cap
  // (see the withdrawal note above).
  const rec = readDurableRecord(artifactPath);
  assertClosedShape(rec.obj, RUNTIME_PROFILE_BINDING_V2_FIELDS);
  assertBindingCarrierBytes(rec.bytes, rec.obj, artifactPath);
  return rec.obj;
}

  return Object.freeze({
    PROVIDER_SESSION_V3_FIELDS,
    assertBindingCarrierBytes,
    assertCanonicalDiskRecordBytes,
    assertCoordinationRootSnapshotUnchanged,
    assertDirectlyAtCoordinationRoot,
    assertNotInsideCoordinationRoot,
    checkProviderSessionV3Conformance,
    checkRootProfileV3Conformance,
    checkRuntimeProfileBindingV2Conformance,
    snapshotCoordinationRootIdentity,
  });
}

module.exports = { createRootProviderTupleConformance };
