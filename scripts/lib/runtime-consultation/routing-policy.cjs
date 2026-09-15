'use strict';

// Routing-policy loading/validation (real on-disk snapshot, test-capability-gated override seam) and target-role-profile digesting.
// facadeDirname is injected because this module resolves a file the FACADE ships alongside, not one relative to this module's own location.

function createRoutingPolicy({
  CliError,
  DURABLE_ABSENT,
  DURABLE_PENDING,
  classifyDurableRead,
  facadeDirname,
  fs,
  isTestCapability,
  os,
  path,
  sha256Buffer,
  sha256String,
}) {
// ─────────────────────────────────────────────────────────────────────────────
// `publish-request` (PLAN.md ~L761, Ordered Runtime Loop steps 1-5 ~L798-808)
// ─────────────────────────────────────────────────────────────────────────────

// WP3 fix: this used to be an in-memory FABRICATED placeholder
// ({schema,profile:'wp1-default'}) wholly disconnected from the real
// scripts/lib/runtime-routing.json file on disk -- every request's
// routing_policy_digest was a digest of that fake stub, never the real routing
// table. PLAN.md's own Routing Registry section: "Every request uses its
// immutable content-addressed snapshot" -- ROUTING_POLICY_CONTENT is now the
// REAL file's exact on-disk bytes (read once at module load; `runtime-routing.json`
// is a toolkit file loaded alongside this one, never request-controlled), and
// ROUTING_POLICY_DIGEST is the raw SHA-256 of those exact bytes (no canonical
// re-serialization -- a byte-for-byte hash, matching this file's own
// raw-file-digest-equals-canonical-serialization-digest invariant elsewhere).
const ROUTING_POLICY_VERSION = 'runtime-routing/v1';

function routingOverrideInvalid(reason) {
  return new Error('RUNTIME_TEST_ROUTING_OVERRIDE_INVALID:' + reason);
}

/**
 * R2-C (M6-M7-R2C-TEST-SEAM-CLOSURE-20260820): the ONE test-only seam that
 * lets the REAL canonical runtime-consultation.cjs -- the exact file
 * root-source-initiated publish-request is structurally pinned to
 * (findLifecycleCliInvocation's exact CANONICAL_LIFECYCLE_CLI_PATH match +
 * decodeRootSourceBootstrapIntentFromAction's own __dirname-relative
 * runtime-consultation.cjs check, both untouched by this seam) -- load its
 * own ROUTING_POLICY_CONTENT from a private, TMPDIR-confined fixture instead
 * of the real repo file, so an E2E fixture can prove routing selection
 * without ever needing a private COPY of this script (which the two checks
 * above make structurally unreachable for that exact flow).
 *
 * Absent/empty RUNTIME_CONSULTATION_TEST_ROUTING_POLICY_PATH: byte-for-byte
 * the prior unconditional behavior (real scripts/lib/runtime-routing.json,
 * digest 9fd518e25f...406fa unchanged). Present: gated behind the SAME
 * isTestCapability() seam as --fixed-ids/--fixed-clock (cjs:208) -- checked
 * BEFORE the path is even read, so a missing gate never touches the
 * filesystem at all. Every rejection throws the deterministic
 * `RUNTIME_TEST_ROUTING_OVERRIDE_INVALID:<reason>` Error, mirroring the
 * sibling malformed-canonical-routing.json throw below (module-load-time
 * invariant, never a per-request CliError/detail_code -- there is no
 * fitting closed enum member for this, and adding one would be a bigger,
 * unauthorized surface change).
 */
function loadRoutingPolicyContent() {
  const raw = process.env.RUNTIME_CONSULTATION_TEST_ROUTING_POLICY_PATH;
  if (typeof raw !== 'string' || raw.length === 0) {
    return fs.readFileSync(path.join(facadeDirname, 'runtime-routing.json'));
  }
  if (!isTestCapability()) {
    throw routingOverrideInvalid('test-capability-required');
  }
  if (!path.isAbsolute(raw)) {
    throw routingOverrideInvalid('path-not-absolute');
  }
  let realOverridePath;
  try {
    realOverridePath = fs.realpathSync(raw);
  } catch (err) {
    throw routingOverrideInvalid('path-not-real');
  }
  if (realOverridePath !== path.resolve(raw)) {
    // Catches EITHER a symlink anywhere in the path (realpath follows it,
    // resolve does not) OR a lexical alias (e.g. case-folding on a
    // case-insensitive-but-case-preserving filesystem) -- one comparison,
    // no separate symlink-detection logic needed.
    throw routingOverrideInvalid('path-not-real');
  }
  let realTmpdir;
  try {
    realTmpdir = fs.realpathSync(os.tmpdir());
  } catch (err) {
    throw routingOverrideInvalid('tmpdir-not-secure');
  }
  let tmpdirLstat;
  try {
    tmpdirLstat = fs.lstatSync(realTmpdir);
  } catch (err) {
    throw routingOverrideInvalid('tmpdir-not-secure');
  }
  const isPosix = process.platform !== 'win32';
  if (
    !tmpdirLstat.isDirectory()
    || (isPosix && typeof process.getuid === 'function' && tmpdirLstat.uid !== process.getuid())
    || (isPosix && (tmpdirLstat.mode & 0o777) !== 0o700)
  ) {
    throw routingOverrideInvalid('tmpdir-not-secure');
  }
  if (realOverridePath === realTmpdir || !realOverridePath.startsWith(realTmpdir + path.sep)) {
    throw routingOverrideInvalid('path-outside-tmpdir');
  }
  let classified;
  try {
    classified = classifyDurableRead(realOverridePath, {});
  } catch (err) {
    if (err instanceof CliError) {
      throw routingOverrideInvalid(err.detailCode === 'DURABILITY_UNPROVEN' ? 'file-durability-unproven' : 'file-security-invalid');
    }
    throw err;
  }
  if (classified.state === DURABLE_ABSENT) {
    throw routingOverrideInvalid('file-not-found');
  }
  if (classified.state === DURABLE_PENDING) {
    throw routingOverrideInvalid('file-durability-unproven');
  }
  const bytes = classified.bytes;
  let obj;
  try {
    obj = JSON.parse(bytes.toString('utf8'));
  } catch (err) {
    throw routingOverrideInvalid('schema-invalid');
  }
  if (!obj || typeof obj !== 'object' || obj.schema !== ROUTING_POLICY_VERSION || !obj.routes || typeof obj.routes !== 'object' || Array.isArray(obj.routes)) {
    throw routingOverrideInvalid('schema-invalid');
  }
  return bytes;
}

const ROUTING_POLICY_CONTENT = loadRoutingPolicyContent();
const ROUTING_POLICY_DIGEST = sha256Buffer(ROUTING_POLICY_CONTENT);
const ROUTING_POLICY_TABLE = JSON.parse(ROUTING_POLICY_CONTENT.toString('utf8'));
if (ROUTING_POLICY_TABLE.schema !== ROUTING_POLICY_VERSION || !ROUTING_POLICY_TABLE.routes || typeof ROUTING_POLICY_TABLE.routes !== 'object') {
  // Fail fast at module load, not at first dispatch -- a malformed toolkit
  // routing.json is a harness integrity defect, never a per-request condition.
  // Unreachable for the test-override path above (loadRoutingPolicyContent
  // already enforces this exact check, deterministically, before returning),
  // so this stays exactly what it was: the canonical-file guard only.
  throw new Error('scripts/lib/runtime-routing.json is malformed: schema must be ' + ROUTING_POLICY_VERSION + ' with a routes object');
}
const TARGET_ROLE_PROFILE_VERSION = '1.0.0';

function targetRoleProfileDigestFor(role) {
  return sha256String('runtime-consultation/wp1-target-role-profile:' + role);
}

  return Object.freeze({
    ROUTING_POLICY_CONTENT,
    ROUTING_POLICY_DIGEST,
    ROUTING_POLICY_TABLE,
    ROUTING_POLICY_VERSION,
    TARGET_ROLE_PROFILE_VERSION,
    loadRoutingPolicyContent,
    routingOverrideInvalid,
    targetRoleProfileDigestFor,
  });
}

module.exports = { createRoutingPolicy };
