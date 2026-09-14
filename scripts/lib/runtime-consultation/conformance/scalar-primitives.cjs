'use strict';

// R33 stage-1 scalar primitives, field literals and the TemporalAuthorityEnvelope/v1 assertion (R33-STAGE1-AUDIT-SCOPE part 1 of 3 -- see runtime-consultation.cjs for the marker contract).

function createScalarPrimitivesConformance({
  CliError,
  HEX128_RE,
  assertClosedShape,
  isEnum,
  isHex64,
  isHexId,
}) {
// R33-STAGE1-AUDIT-SCOPE:BEGIN
// Everything between this marker and its matching closing marker below is the
// R33 stage-1 surface. `validate` is a NO-MUTATION command (PLAN.md ~L785), and
// PLAN.md ~L2913 forbids overwrite, conversion, adoption, unlink, fallback and
// retry outright while ~L2927-2928 makes a fresh R33 root the only rollout path
// ("No existe in-place upgrade, downgrade o rollback"). Those are ABSENCE
// properties: no test can prove them for a code path nobody thought to
// exercise. `runtime-consultation-cli.test.js` therefore EXTRACTS exactly this
// region by these two markers and asserts that no filesystem-mutating primitive
// occurs INSIDE it. Asserting absence within an extracted scope is the point --
// a hand-listed substring search over the whole file would be silently defeated
// by any later edit outside the markers. Do not move, rename or duplicate these
// marker strings, and do not introduce a write/rename/unlink/link/mkdir/lock
// primitive between them. The audit MUST also assert that each marker occurs
// EXACTLY ONCE in the file: a duplicated marker collapses the extracted region
// and would make the whole audit vacuously pass. (That is not hypothetical --
// the first draft of this very comment spelled the closing marker's literal
// token, which reduced the extracted scope to two lines and passed.)
// ─────────────────────────────────────────────────────────────────────────────
// NON-AUTHORITATIVE R33 STATIC CONFORMANCE. Read this before anything below.
//
// Every function in this section is a CONFORMANCE CHECK. Together they can prove
// closed schema, canonical byte encoding, confined paths, tuple correlation and
// the A.5 digests -- and NOTHING ELSE. None of them establishes authority,
// accreditation, liveness or the right to act, and none may be renamed, wrapped
// or reported as though it did.
//
// What is deliberately NOT here, and why it cannot be:
//  - the AUTHORITY tier. R3.3:2848-2851 makes receipt-level disagreement
//    AUTHORITY_INVALID, and the final `BootstrapReceipt` is published under the
//    runtime-owner root `R`.
//    CORRECTION, recorded because an earlier revision of this banner asserted
//    the opposite and it was propagated downstream: `R` IS derivable, and from
//    `C` alone. R3.3:209-215 constructs it explicitly --
//      runtime_slot_id = LOWERCASE_HEX(FIRST_16_BYTES(SHA256(
//        UTF8("runtime/owner-root-slot/v1") || 0x00 || LP(UTF8(C)) )))
//      runtime_owner_basename = ".acd-prm-r33-" || runtime_slot_id
//      R = P || native_separator || runtime_owner_basename
//    -- where the slot id is a hash OF `C` and `P` is C's parent. The earlier
//    claim reasoned about `runtime_owner_root_id`, which is an IDENTITY digest
//    (a verification mechanism for a path you already hold, R3.3:3733), and
//    mistook the absence of an inversion for the absence of any construction.
//    So locating `R` is NOT what blocks the authority tier here. What blocks it
//    is the liveness reason immediately below, which is sufficient on its own.
//  - temporal LIVENESS. R3.3:1460-1464 defines
//    `valid(envelope,now,clock-capability)` as requiring
//    `clock-capability.state == ACTIVE` and `issued <= now < expiry`. The
//    capability is `RuntimeClockDomainCapabilityLiveV1` (R3.3:1469-1470), and
//    `LiveV*` schemas are provider-owned, live-only and NON-SERIALIZABLE with no
//    disk projection (R3.3:2379-2383); and `now` would have to be in the
//    record's own monotonic domain, which R3.3:1465 forbids converting into.
// Both therefore belong to the provider-owned IN-PROCESS composition
// (PLAN.md ~L762: retained hosts "call the core in-process with
// `HostBridgeCapability/v1`, never through a CLI suffix"), where a real
// monotonic clock and a real retained receipt exist. Neither can be reconstructed
// from disk records by a standalone reader, and NOTHING here may substitute a
// path, boolean, digest or caller-supplied object for opaque live authority.
//
// Consequence, stated so it cannot be mistaken for an oversight: a caller that
// runs any function in this section to completion has learned that some bytes
// conform to a closed schema. It has NOT learned that a root, a session or a
// profile is legitimate. Static conformance is a precondition for accreditation,
// never a substitute for it.
//
// Bootstrap states this section must not collapse (R3.3:1115-1117 and step 17):
// step 12 is root-profile conformance/readback ONLY; step 17 is provider-session
// conformance/readback ONLY; step 18 -- `BootstrapReceipt` plus live capabilities
// transitioning the session to ACTIVE -- is the FIRST authority-success point and
// is not implemented here.
// ─────────────────────────────────────────────────────────────────────────────
// R33 static conformance surface -- PLAN §4.1 mandatory stage 1 of 6
// (PLAN.md ~L2935). The closed schemas for the three-record tuple
// `RuntimeProfileBindingV2 + RootProfileV3 + ProviderSessionV3`.
//
// SCOPE HONESTY (binding, do not weaken): this section delivers the closed
// schemas that tuple accreditation will CONSUME. It does NOT implement PLAN
// §3.1's tuple-first selection rule (PLAN.md ~L2676-2679: "El validator se
// selecciona primero por el tuple acreditado ... Schema string, path, record
// digest o profile literal aislado nunca seleccionan root/profile"). A
// `validate --kind X --artifact Y` surface selects by an argv-ASSERTED kind,
// one record at a time, and structurally cannot accredit a THREE-record tuple
// from a SINGLE `--artifact`. What the tuple check in this section establishes
// is that the three records CONFORM to their closed schemas and CORRELATE with
// each other -- a precondition for accreditation, never accreditation itself.
// Tuple-first selection needs the accredited tuple PLAN §3.1 names, which
// requires the receipt chain and live capabilities this section cannot reach;
// it belongs to the provider-owned composition. Nothing in this section may be
// reported as "R33 root/profile/session accreditation: DONE".
//
// "dispatch dinámico a validator R32" (PLAN.md ~L2673, prohibited) holds here
// BY CONSTRUCTION rather than by a guard: there is no RootProfileV2 /
// ProviderSessionV2 validator anywhere in this file to dispatch TO. An R32
// artifact simply fails the `schema`/`protocol_profile` literals below and is
// SCHEMA_INVALID, and an occupied-but-wrong-profile path can never degrade to
// ABSENT because absence is ENOENT-at-open only (classifyDurableRead) -- which
// is exactly PLAN.md ~L2911's "una path ocupada por bytes del otro profile es
// PRESENT_INVALID, nunca ABSENT". Do NOT add an R32 validator here: that would
// create the very dispatch surface the rule forbids.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * P33 (PLAN.md ~L2647). Its sibling P32
 * (`runtime-consultation/r32-csl-posix-local-v1`, ~L2646) is deliberately NOT
 * defined as a constant here: it is not a value this file ever writes or
 * accepts, only one the equality checks below must reject like any other wrong
 * literal.
 */
const R33_PROTOCOL_PROFILE = 'runtime-consultation/r33-csl-posix-local-v1';

// Literals shared by 2+ of the three tuple records -- ONE source each, never
// independently-typed copies (the DRIVER_ENUM precedent above). Single-use
// literals/enums stay inline in their own field table.
const R33_CONTROL_PROTOCOL = 'transition-lock/provider-control/v3';
const R33_HANDLE_PROTOCOL = 'transition-lock/provider-handle/v2';
const R33_PROVIDER_ABI = 3;
const TRANSITION_LOCK_PROVIDER_NAME = 'acd-transition-lock-posix';
const PROVIDER_MANAGER_KIND_ENUM = [
  'retained-native-host-owner', 'runtime-session-supervisor', 'registered-consumer-owner',
];
const PROVIDER_MANAGER_LIFETIME_PROFILE_ENUM = [
  'retained-session', 'persistent-consumer', 'transaction-retained-consumer',
];
const COORDINATION_MODE_ENUM = ['auto', 'persistent', 'ephemeral', 'disk-only'];

/**
 * Canonical basenames of the ONLY two R33 contract records that live in the
 * coordination root `C` (ARCHITECTURE-PROPOSAL-C-S-L-R3.3.md:1019-1022:
 * "`C/root-profile.json` contiene exactamente RootProfileV3 y
 * `C/.provider-session` exactamente ProviderSessionV3 ... Son records distintos
 * y no se reemplazan"), plus their shared 4,096-byte cap from that same
 * passage ("conservan cap 4,096").
 *
 * 4,096 is NOT the 16,384 "root/binding/endpoint/clock receipt" row of the caps
 * table at :1049 -- that table governs objects under the runtime-owner root `R`
 * (see its own preamble at :1042-1045), not these two `C` records. It is also
 * not DEFAULT_MAX_DURABLE_ARTIFACT_BYTES (1 MiB), which is this file's generic
 * coordination-record bound.
 */
const ROOT_PROFILE_V3_BASENAME = 'root-profile.json';
const PROVIDER_SESSION_V3_BASENAME = '.provider-session';
const C_RECORD_MAX_BYTES = 4096;

// RuntimeProfileBindingV2 gets NO R33 contractual byte cap, deliberately. It has
// no defined disk path or transport anywhere in the PLAN or R3.3, and it is
// barred from `C` (:1037-1039), so R33 specifies no cap for it at all. An
// earlier revision borrowed the 16,384-byte "root/binding/endpoint/clock
// receipt" row from the caps table at :1049; that attribution is WITHDRAWN --
// that row governs the durable `RuntimeOwnerCoordinationBindingReceiptV1`, a
// different record, and borrowing it is exactly the reasoning PLAN.md:1395
// forbids ("no implementation may derive an unlisted rule by similarity,
// naming, schema adjacency, or profile analogy"). This kind therefore relies
// only on this file's EXISTING generic bound
// (DEFAULT_MAX_DURABLE_ARTIFACT_BYTES), which is operational parser/DoS
// protection for any coordination record -- NOT an R33 cap for this one.

// ── R33 scalar primitives (ARCHITECTURE-PROPOSAL-C-S-L-R3.2.md:150-152) ──────

/**
 * `Id128 = exactamente 32 ASCII lowercase hex` (R3.2:150). Reuses HEX128_RE,
 * already this file's `stop_id` predicate. Deliberately NOT `isHexId`, whose
 * HEX_ID_RE is `{32,128}` and would accept a 64-char Sha256 where an Id128 is
 * required -- `Id128` and `HexId` are genuinely different types in the closed
 * schemas below (e.g. `root_generation_id:Id128` vs `root_bootstrap_id:HexId`)
 * and must not be collapsed.
 */
function isId128(v) { return typeof v === 'string' && HEX128_RE.test(v); }

/**
 * `Pid` is CITED at `ARCHITECTURE-PROPOSAL-C-S-L-R3.1.md:146`:
 * `| Pid | integer 1..2147483647 |`. A JSON NUMBER (unlike MonoNs, which is a
 * decimal string). PROVENANCE CHAIN: R3.3:2375 -> R3.2:150 -> R3.1:146.
 *
 * BOTH BOUNDS ARE ENFORCED. An earlier revision enforced only `>= 1`, so
 * `owner_pid: 2147483648` and `owner_pid: 9007199254740991` both passed -- both
 * reproduced before the fix. The omission came from an earlier comment asserting
 * "no ceiling is specified anywhere in R3.2/R3.3, so none is invented here",
 * which was wrong for the same reason as the `IsoUtc` and `DecimalU64`
 * annotations above: the delegation chain was followed only as far as R3.2, one
 * hop short of the scalar table that had the answer all along.
 *
 * `Number.isInteger` rather than `isSafeInteger`: the 2^31-1 ceiling is far below
 * the safe-integer limit, so the safe-integer test would be redundant -- any
 * value it would reject is already rejected by the ceiling.
 */
function isPid(v) { return Number.isInteger(v) && v >= 1 && v <= 2147483647; }

/**
 * `IsoUtc` is CITED, not derived: `ARCHITECTURE-PROPOSAL-C-S-L-R3.1.md:143` reads
 * `| IsoUtc | UTC YYYY-MM-DDTHH:MM:SSZ, fecha válida y round-trip idéntico |` --
 * i.e. exactly the three properties enforced below.
 *
 * PROVENANCE CHAIN, recorded because both a prior revision of this comment and a
 * prior ruling stopped one hop short of it: R3.3:2375 says primitives "conservan
 * R3.2"; R3.2:150 delegates onward to R3.1 by name; R3.1:143-146 is where the
 * scalar table actually lives. An earlier revision called this grammar a
 * "DERIVED, fail-closed reading" and admitted an optional `.mmm` fraction. Both
 * were wrong -- the grammar was cited all along, and it forbids fractions.
 * Do not "re-derive" this rule; it has a citation.
 *
 * Two checks are needed, and NEITHER is sufficient alone:
 *  1. the regex fixes the exact encoding -- integral seconds only, literal `Z`,
 *     no fraction, no offset, no date-only form, no surrounding whitespace;
 *  2. the byte-identical round-trip rejects IMPOSSIBLE dates that the regex
 *     cannot see and that `Date.parse` alone does NOT reject. Measured: for the
 *     ISO string form, `Date.parse('2025-02-30T00:00:00Z')` returns
 *     1740873600000 -- a NUMBER, not NaN -- because JS silently rolls the
 *     overflowing day forward. A `!Number.isNaN(...)` guard therefore ACCEPTS
 *     `2025-02-30`, `2025-04-31`, non-leap `2025-02-29`, and `T24:00:00`
 *     (normalized to the next midnight). Re-serializing and comparing back to
 *     the input catches every one of them, because the normalized form differs
 *     from what was written. The real leap day `2024-02-29T00:00:00Z` round-
 *     trips unchanged and is correctly accepted.
 *
 * Deliberately NOT `isIsoTimestamp` (which accepts anything `new Date()` can
 * parse, including `'Jan 1, 2025'` and offset forms). The 8 existing
 * `created_at: { check: isIsoTimestamp }` fields keep their looser predicate
 * untouched -- that looseness is a pre-existing property of shipped kinds, out
 * of this stage's scope. The blast radius is small by design: both new
 * wall-clock fields are named `*_diagnostic_utc`, because R33 moved authority
 * to the monotonic envelope and left wall clocks diagnostic-only.
 */
const ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
function isIsoUtc(v) {
  if (typeof v !== 'string') return false;
  if (!ISO_UTC_RE.test(v)) return false;
  const ms = Date.parse(v);
  if (Number.isNaN(ms)) return false;
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z') === v;
}

/**
 * `MonoNs = alias exacto de DecimalU64 (canonical decimal string)`
 * (ARCHITECTURE-PROPOSAL-C-S-L-R3.3.md:1441) -- a JSON **string**, never a JSON
 * number. The signed `-9223372036854775808..9223372036854775807` range on the
 * adjacent :1443-1444 belongs to `UnixNs`, a DIFFERENT type; attributing it to
 * MonoNs (as an earlier reading of this stage's contract did) would make these
 * three fields numbers and silently lose precision above 2^53.
 *
 * Grammar is the canonical-decimal one R3.2:151-152 establishes for the sibling
 * scalars (`DecimalU32`, `DecimalI64`: "decimal canónico ... sin '+', leading
 * zero ni '-0'"), i.e. digits only, no sign, no leading zeros, no whitespace --
 * required by R3.3:1466 ("overflow/underflow/noncanonical decimal → INVALID
 * before allocation/write"), a rule that only makes sense for a string
 * representation.
 *
 * `DecimalU64` is CITED at `ARCHITECTURE-PROPOSAL-C-S-L-R3.1.md:145`:
 * `| DecimalU64 | string decimal canónico 0..18446744073709551615 |`. So the
 * bound below is the cited range, and "string decimal canónico" is the cited
 * grammar -- neither is an inference from the `U64` type name.
 *
 * PROVENANCE CHAIN (R3.3:2375 -> R3.2:150 -> R3.1:145). An earlier revision of
 * this comment claimed the bound was undefined anywhere and therefore DERIVED;
 * that was wrong for the same reason the `IsoUtc` annotation above was wrong --
 * the delegation chain was followed only as far as R3.2.
 */
const CANONICAL_DECIMAL_U64_RE = /^(0|[1-9][0-9]*)$/;
const MAX_DECIMAL_U64 = 18446744073709551615n;
function isMonoNs(v) {
  return typeof v === 'string' && CANONICAL_DECIMAL_U64_RE.test(v) && BigInt(v) <= MAX_DECIMAL_U64;
}

/**
 * A field whose value is a single FIXED LITERAL. The literal is DECLARED as
 * data, so exactly one declaration drives BOTH the shape predicate and the
 * correlation-set derivation below -- they cannot drift apart.
 *
 * This exists because the 17-key R33 tuple correlation set is defined by
 * SUBTRACTING the keys that are a fixed literal in BOTH records (contract §8b:
 * such a key agrees by construction, and any deviation is already SCHEMA_INVALID
 * at shape time, so a correlation guard over it could never fire). A `check`
 * closure is opaque -- nothing can ask it "are you an equality test against a
 * literal?" -- so without this the subtraction would need a hand-maintained
 * second list of literal key names, which is precisely the hand-transcription
 * §8b says not to trust.
 *
 * Behaviourally inert: `check` is exactly the `(v) => v === value` it replaces.
 * `assertClosedShape` reads only `def.required` and `def.check` and never
 * enumerates a definition's own keys, so the extra `literal` property is
 * invisible to validation. Applied ONLY to the three R33 tuple tables -- the
 * other field tables in this file are deliberately left untouched.
 */
function lit(value) {
  return { literal: value, check: (v) => v === value };
}

/** True iff `table`'s field `key` was declared via `lit()`, i.e. is a single fixed literal. */
function isLiteralField(table, key) {
  return Object.prototype.hasOwnProperty.call(table, key)
    && Object.prototype.hasOwnProperty.call(table[key], 'literal');
}

// ── A.1 `RuntimeProfileBindingV2` [6] (R3.3:2388-2395) ──────────────────────

/**
 * Six FIXED LITERALS, no free-form field at all: five exact strings plus the
 * integer `3`. Any other value is SCHEMA_INVALID.
 *
 * CONFORMANCE CHECK, NOT AN IDENTITY BINDING. Because all six values are fixed
 * literals, this record carries NO `coordination_root_id`, no
 * `root_generation_id`, and no digest of anything -- there is no field by which
 * a binding is tied to a PARTICULAR root or session (contract §8c confirms the
 * only keys it shares with RootProfileV3 are those same fixed literals). So ANY
 * conforming binding satisfies the tuple: the record is effectively a constant,
 * and producing it evidences nothing beyond the caller being able to reproduce a
 * constant. The R33 tuple's actual force therefore comes from the two `C`
 * records plus their 17-key and digest correlation, NOT from this leg. A later
 * stage must NOT claim this record contributes identity or actor authority.
 * This is a property of the contract's own design at this stage, not a gap in
 * the validator.
 *
 * NAMED LIMITATION (flagged, deliberately not fixed here): `subject_manifest`
 * is the frozen literal `coordination/subject-bundle-manifest/v2` (R3.3:2394),
 * but the only manifest implemented in this file is
 * `coordination/subject-bundle-manifest/v1` (SUBJECT_BUNDLE_MANIFEST_V1_FIELDS
 * below). A conformant R33 binding therefore asserts a manifest version
 * `publish-blob`/`publish-request` cannot currently produce. That is a real
 * cross-contract divergence belonging to a later stage; the literal is NOT
 * weakened to v1 to make the two line up.
 */
const RUNTIME_PROFILE_BINDING_V2_FIELDS = {
  schema: lit('runtime/csl-profile-binding/v2'),
  protocol_profile: lit(R33_PROTOCOL_PROFILE),
  control_protocol: lit(R33_CONTROL_PROTOCOL),
  provider_abi: lit(R33_PROVIDER_ABI),
  handle_protocol: lit(R33_HANDLE_PROTOCOL),
  subject_manifest: lit('coordination/subject-bundle-manifest/v2'),
};

// ── A.3 `RootProfileV3` [28] (R3.3:3651 REPLACE over R3.2:2087-2098) ────────

/**
 * `REPLACE(RootProfileV2[24], "coordination/root-profile/v3", REMOVE(5),
 * ADD(9))` = 28 keys, matching the row's own authoritative `Keys` column.
 * REMOVE = schema, protocol_profile, control_protocol, provider_abi,
 * created_at. Retained keys keep exactly the type/nullability of their R3.2
 * base (R3.3:3638), so the two groups below are listed in their SOURCES' own
 * orders -- the 9 ADD keys in R3.3:3651's order, then the 19 retained keys in
 * RootProfileV2's order at R3.2:2087-2098 -- to stay diffable against both
 * citations in one pass.
 *
 * Note `provider_abi` is REMOVEd and re-ADDed with the new literal `3` (was `2`
 * in V2), `control_protocol` moves /v2 -> /v3, and `protocol_profile` moves
 * P32 -> P33; but `lock_profile` is RETAINED UNCHANGED at
 * `transition-lock/file-posix/v2` and must not be "fixed" to v3.
 */
const ROOT_PROFILE_V3_FIELDS = {
  schema: lit('coordination/root-profile/v3'),
  protocol_profile: lit(R33_PROTOCOL_PROFILE),
  control_protocol: lit(R33_CONTROL_PROTOCOL),
  provider_abi: lit(R33_PROVIDER_ABI),
  handle_protocol: lit(R33_HANDLE_PROTOCOL),
  runtime_owner_root_id: { check: isHex64 },
  clock_domain_id: { check: isId128 },
  clock_domain_receipt_digest: { check: isHex64 },
  created_at_diagnostic_utc: { check: isIsoUtc },
  lock_profile: lit('transition-lock/file-posix/v2'),
  coordination_root_id: { check: isHex64 },
  physical_root_id: { check: isHex64 },
  coordination_root_identity_security_digest: { check: isHex64 },
  canonical_root_path_digest: { check: isHex64 },
  mount_projection_digest: { check: isHex64 },
  root_generation_id: { check: isId128 },
  root_bootstrap_id: { check: isHexId },
  provider_session_id: { check: isId128 },
  local_filesystem_profile: lit('local-posix/v2'),
  local_filesystem_capability_digest: { check: isHex64 },
  mount_generation_digest: { check: isHex64 },
  provider_name: lit(TRANSITION_LOCK_PROVIDER_NAME),
  provider_build_digest: { check: isHex64 },
  platform: { check: isEnum(['linux', 'darwin']) },
  architecture: { check: isEnum(['x64', 'arm64']) },
  provider_manager_kind: { check: isEnum(PROVIDER_MANAGER_KIND_ENUM) },
  provider_manager_lifetime_profile: { check: isEnum(PROVIDER_MANAGER_LIFETIME_PROFILE_ENUM) },
  coordination_mode: { check: isEnum(COORDINATION_MODE_ENUM) },
};

// ── A.2 `TemporalAuthorityEnvelopeV1` [4] (R3.3:1446-1451) ──────────────────

const TEMPORAL_AUTHORITY_ENVELOPE_V1_FIELDS = {
  clock_domain_id: { check: isId128 },
  issued_monotonic_ns: { check: isMonoNs },
  not_before_monotonic_ns: { check: isMonoNs },
  expiry_monotonic_ns: { check: isMonoNs },
};

/**
 * NOTE ON THE NAME: the word "Authority" here is the R3.3 RECORD's own name
 * (`TemporalAuthorityEnvelopeV1`, R3.3:1446), NOT a claim that this function
 * establishes authority. It proves the envelope's static shape and ordering
 * invariants only. Liveness -- `clock-capability.state == ACTIVE` and
 * `issued <= now < expiry` (R3.3:1460-1464) -- is NOT checked here and cannot be,
 * for the reasons in the section banner. The name is kept deliberately so the
 * mapping to the R3.3 schema stays greppable; renaming it would obscure the
 * citation.
 *
 * The nested envelope's own closed shape PLUS its ordering invariants
 * (R3.3:1456-1458): `issued <= not_before < expiry` and `not_before == issued`
 * ("R3.3 no delayed activation"). Applied at the whole-object level rather than
 * as a per-field predicate, mirroring `assertResultContentXor`/
 * `assertStopCorrelationTriple` -- cross-field rules get their own precise
 * SCHEMA_INVALID messages instead of a generic "invalid field: temporal".
 *
 * NO COERCION, mechanically: every operand is BigInt-parsed from a value
 * `isMonoNs` has ALREADY proven to be a canonical unsigned decimal string
 * within range, so `BigInt()` is an exact, total parse of a validated string --
 * not a coercion of arbitrary input. There is no `Number()`, `parseInt`, unary
 * `+`, `==`, or relational comparison on mixed/unvalidated types anywhere here.
 * Both alternatives are actively wrong and were checked empirically:
 *   - `Number` collapses `9007199254740993` onto 2^53, so an envelope whose
 *     `not_before` genuinely DIFFERS from `issued` (delayed activation, which
 *     R3.3 forbids) compares EQUAL and would be ACCEPTED;
 *   - string relational comparison misorders different-length decimals
 *     (`'9' < '10'` is false).
 * `lifetime = expiry - issued` (:1459, "checked integer arithmetic") needs no
 * separate guard: BigInt subtraction cannot overflow, and each operand is
 * already range-bounded. No lifetime ceiling is invented -- `DurationNs`
 * (0..86400000000000, :1442) is a different type this envelope does not use.
 */
function assertTemporalAuthorityEnvelopeV1(envelope) {
  assertClosedShape(envelope, TEMPORAL_AUTHORITY_ENVELOPE_V1_FIELDS);
  const issued = BigInt(envelope.issued_monotonic_ns);
  const notBefore = BigInt(envelope.not_before_monotonic_ns);
  const expiry = BigInt(envelope.expiry_monotonic_ns);
  // Implied by the equality immediately below, but asserted separately and
  // first (R3.3 states both) so a future relaxation of the equality can never
  // silently drop the ordering rule with it.
  if (!(issued <= notBefore)) {
    throw new CliError('INVALID', 'SCHEMA_INVALID', 'temporal issued_monotonic_ns must be <= not_before_monotonic_ns');
  }
  if (notBefore !== issued) {
    throw new CliError('INVALID', 'SCHEMA_INVALID', 'temporal not_before_monotonic_ns must equal issued_monotonic_ns (R3.3 forbids delayed activation)');
  }
  if (!(notBefore < expiry)) {
    throw new CliError('INVALID', 'SCHEMA_INVALID', 'temporal expiry_monotonic_ns must be strictly greater than not_before_monotonic_ns');
  }
}

  return Object.freeze({
    CANONICAL_DECIMAL_U64_RE,
    COORDINATION_MODE_ENUM,
    C_RECORD_MAX_BYTES,
    ISO_UTC_RE,
    MAX_DECIMAL_U64,
    PROVIDER_MANAGER_KIND_ENUM,
    PROVIDER_MANAGER_LIFETIME_PROFILE_ENUM,
    PROVIDER_SESSION_V3_BASENAME,
    R33_CONTROL_PROTOCOL,
    R33_HANDLE_PROTOCOL,
    R33_PROTOCOL_PROFILE,
    R33_PROVIDER_ABI,
    ROOT_PROFILE_V3_BASENAME,
    ROOT_PROFILE_V3_FIELDS,
    RUNTIME_PROFILE_BINDING_V2_FIELDS,
    TEMPORAL_AUTHORITY_ENVELOPE_V1_FIELDS,
    TRANSITION_LOCK_PROVIDER_NAME,
    assertTemporalAuthorityEnvelopeV1,
    isId128,
    isIsoUtc,
    isLiteralField,
    isMonoNs,
    isPid,
    lit,
  });
}

module.exports = { createScalarPrimitivesConformance };
