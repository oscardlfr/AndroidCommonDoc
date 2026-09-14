'use strict';

// R33 stage-1 A.5 digests and the three-record tuple conformance check (part 3 of 3, includes the closing R33-STAGE1-AUDIT-SCOPE marker).

function createR33TupleDigestConformance({
  CliError,
  canonicalJSONStringify,
  path,
  sha256Buffer,
  PROVIDER_SESSION_V3_BASENAME,
  ROOT_PROFILE_V3_BASENAME,
  isLiteralField,
  PROVIDER_SESSION_V3_FIELDS,
  ROOT_PROFILE_V3_FIELDS,
  assertCoordinationRootSnapshotUnchanged,
  checkProviderSessionV3Conformance,
  checkRootProfileV3Conformance,
  checkRuntimeProfileBindingV2Conformance,
  snapshotCoordinationRootIdentity,
}) {


// ── A.5 domain-separated digests (R3.3:3716-3729) ──────────────────────────

/**
 * `SHA256(UTF8(domain) || 0x00 || UTF8(canonical(record)))`.
 *
 * The domain is passed EXPLICITLY and is never derived from `record.schema`:
 * the temporal envelope has no `schema` key at all, and its domain
 * (`runtime/temporal-authority-envelope/v1`) is not any record's schema literal.
 *
 * Over the FULL canonical record -- NO field exclusion. Deliberately unlike the
 * sibling formulas at :3666-3669 and :3711-3713 (`canonical(binding without
 * binding_digest)`), which DO exclude their own self-digest field. These three
 * records carry no self-digest field, so there is nothing to exclude and adding
 * an exclusion would silently change every value.
 *
 * Hashes `canonicalJSONStringify(record)`, NOT the artifact's raw file bytes
 * and NOT `readDurableRecord`'s own `.digest`: a disk record carries a trailing
 * LF (R3.3:2374) that is not part of `canonical(record)`, so a raw-bytes digest
 * is a DIFFERENT value and would break
 * `ProviderSessionV3.root_profile_digest == rootProfileDigestV3(RootProfileV3)`
 * (:3734-3735). With `assertCanonicalDiskRecordBytes` proving the bytes are
 * exactly `canonical(obj) + LF`, the two differ by precisely that one byte and
 * nothing else.
 *
 * PLAN.md ~L2768-2769: these apply ONLY AFTER shape/profile/root accreditation.
 * A digest is never computed to DECIDE a profile.
 * @param {string} domain - the exact domain-separation string.
 * @param {object} record - an already shape-checked record.
 * @returns {string} lowercase hex sha256.
 */
function domainSeparatedRecordDigest(domain, record) {
  return sha256Buffer(Buffer.concat([
    Buffer.from(domain, 'utf8'),
    Buffer.from([0x00]),
    Buffer.from(canonicalJSONStringify(record), 'utf8'),
  ]));
}

/**
 * `rootProfileDigestV3(profile)` (R3.3:3716-3719).
 * @param {object} profile - a conformant RootProfileV3.
 * @returns {string} lowercase hex sha256.
 */
function rootProfileDigestV3(profile) {
  return domainSeparatedRecordDigest('coordination/root-profile/v3', profile);
}

/**
 * `providerSessionDigestV3(session)` (R3.3:3721-3724).
 * @param {object} session - a conformant ProviderSessionV3.
 * @returns {string} lowercase hex sha256.
 */
function providerSessionDigestV3(session) {
  return domainSeparatedRecordDigest('coordination/provider-session/v3', session);
}

/**
 * `temporalEnvelopeDigestV1(envelope)` (R3.3:3726-3729). Note the domain is
 * `runtime/temporal-authority-envelope/v1`, which is NOT a key of the envelope
 * -- TemporalAuthorityEnvelopeV1 [4] carries no `schema` field.
 * @param {object} envelope - a conformant TemporalAuthorityEnvelopeV1.
 * @returns {string} lowercase hex sha256.
 */
function temporalEnvelopeDigestV1(envelope) {
  return domainSeparatedRecordDigest('runtime/temporal-authority-envelope/v1', envelope);
}

// ── R33 tuple-first selection + correlation (PLAN §3.1, PLAN.md ~L2676-2679) ──

/**
 * The R33 tuple correlation set, DERIVED at module load from the two field
 * tables themselves -- never hand-transcribed (contract §8b: "Re-derive the
 * intersection programmatically; do not hand-trust either list").
 *
 *   correlation_set = (keys(RootProfileV3) ∩ keys(ProviderSessionV3))
 *                     minus keys that are a FIXED LITERAL in BOTH
 *
 * The subtraction is not an optimization: a key that is the same fixed literal
 * in both records agrees BY CONSTRUCTION, and any deviation is already rejected
 * as SCHEMA_INVALID at shape time, so a correlation guard over it could never
 * fire -- and a guard that cannot fail is worse than no guard, because it reads
 * as coverage. `isLiteralField` reads the `lit()` declaration, so this stays in
 * lockstep with the tables by construction.
 *
 * Measured: raw intersection 21, fixed-literal-in-both 4 (`schema`,
 * `provider_abi`, `control_protocol`, `provider_name`), derived set 17.
 *
 * The three enum-valued keys (`coordination_mode`, `provider_manager_kind`,
 * `provider_manager_lifetime_profile`) are correctly RETAINED: they are closed
 * ENUMS, not single literals, so two individually-shape-valid records can
 * legitimately disagree and that disagreement is a genuine correlation failure.
 *
 * The count is asserted here rather than trusted. A drifted table is a toolkit
 * integrity defect, not a per-request condition, so it fails at module load --
 * the same discipline `ROUTING_POLICY_TABLE` uses below ("Fail fast at module
 * load, not at first dispatch").
 */
const R33_TUPLE_CORRELATION_KEYS = (() => {
  const shared = Object.keys(ROOT_PROFILE_V3_FIELDS).filter(
    (k) => Object.prototype.hasOwnProperty.call(PROVIDER_SESSION_V3_FIELDS, k),
  );
  const derived = shared.filter(
    (k) => !(isLiteralField(ROOT_PROFILE_V3_FIELDS, k) && isLiteralField(PROVIDER_SESSION_V3_FIELDS, k)),
  );
  if (derived.length !== 17) {
    throw new Error(
      'R33 tuple correlation set derived ' + derived.length + ' keys from the field tables; '
      + 'contract §8b requires exactly 17 (raw intersection 21 minus 4 fixed-literal-in-both). '
      + 'A field table changed -- re-derive deliberately rather than adjusting this number.',
    );
  }
  return Object.freeze(derived.slice().sort());
})();

/**
 * Three-record STATIC CONFORMANCE over the R33 tuple. NOT accreditation, and NOT
 * PLAN §3.1's selection rule -- see the section banner. §3.1 (PLAN.md ~L2676-2679)
 * requires that "El validator se selecciona primero por el tuple acreditado
 * `RuntimeProfileBindingV2 + RootProfileV3 + ProviderSessionV3`", and the word
 * doing the work there is *acreditado*: an accredited tuple, which needs the
 * receipt chain and live capabilities this section cannot reach. What this
 * function establishes is the CONFORMANCE PRECONDITION for that rule -- it proves
 * the three records are individually well-formed and mutually correlated, and
 * nothing about whether any of them is legitimate.
 *
 * It has NO CLI SURFACE. The `validate --kind` exposure was removed: a kind that
 * returned public SUCCESS while establishing no authority was reporting coverage
 * it did not have. The binding path is a parameter because it is the only one of
 * the three with no contract-defined location; both `C` records are DERIVED from
 * `coordRoot`, which is what lets one call cover all three.
 *
 * ONE THING IT STILL DOES NOT PROVE, deliberately: the binding leg is a
 * conformance check, not an identity binding. All six `RuntimeProfileBindingV2`
 * fields are fixed literals and no field ties a binding to a particular root, so
 * ANY conforming binding satisfies it. The tuple's force comes from the two `C`
 * records plus the 17-key and digest correlation below.
 *
 * PRECEDENCE IS STRUCTURAL, not incidental (PLAN.md ~L2896-2907). It holds by
 * CONTROL FLOW ACROSS PHASES, not by the order of checks inside any one
 * function: every record's shape is fully checked in phase 1 before the first
 * phase-2 statement is reachable, so a tuple carrying BOTH a shape defect and a
 * correlation defect can only ever report SCHEMA_INVALID.
 *
 *   phase 0  location/trust  -> SECURITY_INVALID / DURABILITY_UNPROVEN
 *   phase 1  shape+literal+encoding (all three, incl. temporal invariants)
 *                            -> SCHEMA_INVALID
 *   phase 2  correlation     -> CORRELATION_INVALID
 *   phase 3  authority       -> NOT IMPLEMENTED, see below
 *
 * Phase 0 preceding the entire ladder is DERIVED, not cited: PLAN.md ~L2896-2907
 * ranks only SCHEMA -> CORRELATION -> AUTHORITY and never places
 * SECURITY_INVALID or DURABILITY_UNPROVEN. The reasoning is that you cannot
 * trust bytes you have not proven you can trust. Concrete consequence, stated
 * so it is not a surprise: a `.provider-session` that is BOTH a symlink AND
 * correlation-defective reports SECURITY_INVALID, not CORRELATION_INVALID.
 *
 * NO AUTHORITY TIER. R3.3:2848-2851 makes receipt-level disagreement
 * AUTHORITY_INVALID, but there is no `BootstrapReceipt` record anywhere in this
 * codebase to compare against, so that tier is deliberately absent rather than
 * faked. Note for whoever adds it: `root_bootstrap_id` will then carry TWO
 * comparisons at TWO tiers -- record-vs-record here (CORRELATION_INVALID) and
 * record-vs-receipt there (AUTHORITY_INVALID). That is INTENTIONAL, not a
 * duplicate to be deduplicated.
 *
 * NO BINDING-vs-ROOT CORRELATION CHECK, deliberately (contract §8c). The only
 * keys `RuntimeProfileBindingV2` shares with `RootProfileV3` are
 * `protocol_profile`, `control_protocol`, `provider_abi` and `handle_protocol`,
 * and all four are the SAME fixed literal in both tables -- so a conforming pair
 * agrees by construction and any disagreement is already SCHEMA_INVALID in phase
 * 1. Adding the check would be exactly the vacuous guard the correlation-set
 * subtraction above rejects. Do not "restore" it.
 *
 * ZERO SIDE EFFECTS: `validate` is a no-mutation surface (PLAN.md ~L785), and
 * this path calls only read primitives plus pure comparisons -- no publish, no
 * lock, no unlink, no temp file. That is what discharges "reject BEFORE
 * reservation/cut" (PLAN.md ~L2914).
 *
 * @param {string} bindingPath - absolute path to the RuntimeProfileBindingV2.
 * @param {string} coordRoot - absolute coordination root `C`.
 * @returns {object} the CONFORMANT RootProfileV3 -- bytes proven to match a
 * closed schema, never an accredited root.
 */
function checkR33ProfileTupleConformance(bindingPath, coordRoot) {
  // ---- phase 1: shape, literals and encoding for ALL THREE, before any
  // correlation. Each check also performs its own phase-0 location/trust
  // checks. Ordered binding-first so a P32 binding fails the whole tuple even
  // when both `C` records are perfectly valid R33 -- no record is ever treated
  // as authoritative on its own.
  // ---- phase 0: confinement-check `C` ITSELF, and freeze a NON-AUTHORITATIVE
  // snapshot of its identity. The three reads below are three separate windows
  // in which `C` could be renamed, chmod'd or replaced; the snapshot is
  // re-sampled after each. This narrows those windows -- it does NOT close them,
  // because the reads re-resolve their own paths and an ABA cycle is invisible
  // to path-based sampling. See `snapshotCoordinationRootIdentity`.
  const rootSnapshot = snapshotCoordinationRootIdentity(coordRoot);

  const binding = checkRuntimeProfileBindingV2Conformance(bindingPath, coordRoot);
  assertCoordinationRootSnapshotUnchanged(coordRoot, rootSnapshot, 'binding read');
  const rootRec = checkRootProfileV3Conformance(path.join(coordRoot, ROOT_PROFILE_V3_BASENAME), coordRoot);
  assertCoordinationRootSnapshotUnchanged(coordRoot, rootSnapshot, 'root-profile read');
  const sessionRec = checkProviderSessionV3Conformance(path.join(coordRoot, PROVIDER_SESSION_V3_BASENAME), coordRoot);
  assertCoordinationRootSnapshotUnchanged(coordRoot, rootSnapshot, 'provider-session read');
  const root = rootRec.obj;
  const session = sessionRec.obj;

  // ---- phase 2: correlation. Every rule here is CORRELATION_INVALID; the
  // order among them is an implementation detail, NOT a contract -- the source
  // does not rank same-tier rules, so only status+detail_code are specified,
  // never which message a multi-defect tuple surfaces. Cheapest first: field
  // comparisons before a SHA-256.
  for (const key of R33_TUPLE_CORRELATION_KEYS) {
    if (root[key] !== session[key]) {
      throw new CliError('INVALID', 'CORRELATION_INVALID', 'root-profile.' + key + ' does not equal provider-session.' + key);
    }
  }

  // Temporal domain agreement (contract §8d, DERIVED from R3.3:1465 "different
  // domain values are incomparable, never converted" plus R3.3:1475-1476 "Si un
  // outer object tiene `clock_domain_id`, debe ser byte-identical a
  // `temporal.clock_domain_id`"). Checked against BOTH records -- the 17-key
  // rule above already proved the two top-level values agree, so this binds the
  // nested envelope to that same single domain.
  if (session.temporal.clock_domain_id !== session.clock_domain_id) {
    throw new CliError('INVALID', 'CORRELATION_INVALID', 'provider-session.temporal.clock_domain_id does not equal its own top-level clock_domain_id');
  }
  if (session.temporal.clock_domain_id !== root.clock_domain_id) {
    throw new CliError('INVALID', 'CORRELATION_INVALID', 'provider-session.temporal.clock_domain_id does not equal root-profile.clock_domain_id');
  }

  // The CITED digest chain (R3.3:3734-3735): "`ProviderSessionV3.
  // root_profile_digest` y binding `root_profile_digest` son
  // `rootProfileDigestV3(RootProfileV3)`". Operand is the canonical PAYLOAD via
  // rootProfileDigestV3, never the file's raw bytes -- the record carries a
  // trailing LF that is not part of `canonical(record)`.
  const expectedRootDigest = rootProfileDigestV3(root);
  if (session.root_profile_digest !== expectedRootDigest) {
    throw new CliError('INVALID', 'CORRELATION_INVALID', 'provider-session.root_profile_digest does not equal rootProfileDigestV3(root-profile)');
  }

  // `coordRootIdentitySnapshot` is part of the RESULT, not a test affordance:
  // `rootRec`/`sessionRec` carry dev/ino for the two record FILES, so without
  // this nothing in the return value identifies `C` itself and no caller could
  // tell which root a result came from. That opacity is where the
  // outside-worktree/0777/symlink defects hid.
  //
  // BOUNDED CLAIM. An earlier revision of this comment said exposing it "proves
  // ONE accredited identity was used throughout" and was "strictly stronger"
  // than racing a swap. Both are WITHDRAWN. It reports the identity observed at
  // the sampling points, nothing more; a mid-read swap is served from the
  // substitute while every sample still matches. Do not build an authority
  // argument on this field -- that needs a retained `C_fd` with same-FD reads,
  // which is Phase B.
  return {
    binding: binding, root: root, session: session,
    rootRec: rootRec, sessionRec: sessionRec,
    coordRootIdentitySnapshot: rootSnapshot,
  };
}

// R33-STAGE1-AUDIT-SCOPE:END

  return Object.freeze({
    R33_TUPLE_CORRELATION_KEYS,
    checkR33ProfileTupleConformance,
    domainSeparatedRecordDigest,
    providerSessionDigestV3,
    rootProfileDigestV3,
    temporalEnvelopeDigestV1,
  });
}

module.exports = { createR33TupleDigestConformance };
