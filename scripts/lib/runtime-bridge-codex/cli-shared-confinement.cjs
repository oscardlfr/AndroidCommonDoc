'use strict';

// Shared confinement/artifact-validation prologue for the runtime-spawn/claude-mcp-launch/worker-cleanup CLI commands.

function createCliSharedConfinement({
  CANONICAL_ROLES,
  classifyDurableRead,
  crypto,
  fs,
  path,
  realpathOrSelf,
}) {
// ── Sequence 68/69 (Defect 1 completion): runtime-spawn, claude-mcp-launch,
// mcp-serve, worker-cleanup, conformance -- PLAN.md "Frozen Production CLI
// ABI" / "Codex bridge entry point" (~L871-882), "Driver Table" (~L929-936),
// "Bridge module boundary" (~L938), "Exact app-server child/RPC contract"
// (~L989), "Conformance evidence" and "Cleanup" (~L1077-1082). Every
// subcommand below composes ONLY the credential broker / isolation provider
// / supervisor-child-registry / app-server-connection / MCP-framing /
// evidence / cleanup primitives already exported by this module (dispatch
// arch-platform-20260824T203132Z) -- no second protocol, result writer,
// credential reader, process registry, scheduler or authority model is
// created here. Where the frozen contract genuinely requires a primitive
// this module does not export anywhere (a "registered disk consumer" wake-
// helper-argv registration, a live `claude` process launcher, a host
// loopback listener for the MCP facade, or an actually-live conformance
// scenario), each subcommand performs every check it CAN honestly compose,
// then fails closed with a clearly labeled reason rather than invent a
// weaker substitute -- reported to the parent executor as an explicit gap.
// ──────────────────────────────────────────────────────────────────────────
/**
 * Shared confinement derivation for every new subcommand that accepts
 * `--coordination-root` (runtime-spawn, claude-mcp-launch, worker-cleanup).
 * Mirrors revalidateSupervisorStartAction's own already-proven technique
 * (above): a coordination root is only ever legitimate at exactly
 * `<projectRoot>/.planning/coordination`, so re-deriving `projectRoot` from
 * the two enclosing path segments and then requiring the caller-supplied
 * value to realpath-equal the freshly re-derived canonical path both proves
 * confinement and rejects a symlinked/relocated root -- never a second,
 * weaker confinement check.
 * @param {string} rawCoordinationRoot
 * @returns {{ok:true,projectRoot:string,coordRootReal:string}|{ok:false,reason:string}}
 */
function deriveProjectRootFromCoordinationRoot(rawCoordinationRoot) {
  if (typeof rawCoordinationRoot !== 'string' || !path.isAbsolute(rawCoordinationRoot)) {
    return { ok: false, reason: 'coordination-root-not-absolute' };
  }
  const coordRootReal = realpathOrSelf(rawCoordinationRoot);
  const planningDir = path.dirname(coordRootReal);
  const projectRoot = path.dirname(planningDir);
  if (path.basename(coordRootReal) !== 'coordination' || path.basename(planningDir) !== '.planning') {
    return { ok: false, reason: 'coordination-root-not-canonical-shape' };
  }
  const expectedCoordRoot = path.join(projectRoot, '.planning', 'coordination');
  if (realpathOrSelf(expectedCoordRoot) !== coordRootReal) {
    return { ok: false, reason: 'coordination-root-self-consistency-failed' };
  }
  return { ok: true, projectRoot, coordRootReal };
}

/**
 * Bounded, real validation of a `--request <canonical-request-path>`
 * argument for runtime-spawn/claude-mcp-launch: absolute, confined under the
 * exact validated coordination root once symlinks are resolved (never a
 * lexical-only check), a regular non-symlink file, and schema-valid
 * `coordination/consult/v2` (PLAN.md Fixed Schema/Version Table) carrying a
 * non-empty canonical-role `target_role`. This only PROVES shape/
 * confinement before dispatch reuses the existing role-owner/worker-
 * readiness primitives below; it never mutates, claims, or answers the
 * request -- there is exactly one result writer in this system and it is
 * not this function.
 * @param {string} coordRootReal
 * @param {string} rawRequestPath
 * @returns {{ok:true,targetRole:string,requestReal:string}|{ok:false,reason:string}}
 */
function readCanonicalRequestArtifact(coordRootReal, rawRequestPath) {
  if (typeof rawRequestPath !== 'string' || !path.isAbsolute(rawRequestPath)) {
    return { ok: false, reason: 'request-not-absolute' };
  }
  let real;
  try {
    real = fs.realpathSync(rawRequestPath);
  } catch (err) {
    return { ok: false, reason: 'request-not-found' };
  }
  const rel = path.relative(coordRootReal, real);
  if (rel === '' || rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) {
    return { ok: false, reason: 'request-not-confined-under-coordination-root' };
  }
  let st;
  try { st = fs.lstatSync(rawRequestPath); }
  catch (err) { return { ok: false, reason: 'request-not-found' }; }
  if (!st.isFile() || st.isSymbolicLink()) return { ok: false, reason: 'request-not-a-regular-file' };
  let classified;
  try {
    classified = classifyDurableRead(real, { parse: true });
  } catch (err) {
    return { ok: false, reason: 'request-read-failed' };
  }
  if (!classified || classified.state !== 'PRESENT' || !Buffer.isBuffer(classified.bytes)) {
    return { ok: false, reason: 'request-durability-unproven' };
  }
  const value = classified.obj;
  if (
    !value || typeof value !== 'object' || Array.isArray(value)
    || value.schema !== 'coordination/consult/v2'
    || typeof value.target_role !== 'string' || value.target_role.length === 0
    || !CANONICAL_ROLES.includes(value.target_role)
  ) {
    return { ok: false, reason: 'request-schema-invalid' };
  }
  return {
    ok: true,
    targetRole: value.target_role,
    requestReal: real,
    request: value,
    requestBytes: classified.bytes,
    requestDigest: crypto.createHash('sha256').update(classified.bytes).digest('hex'),
  };
}

  return Object.freeze({
    deriveProjectRootFromCoordinationRoot,
    readCanonicalRequestArtifact,
  });
}

module.exports = Object.freeze({ createCliSharedConfinement });
