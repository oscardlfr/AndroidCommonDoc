'use strict';

// Host-private local role-command-grant registry: path formulas, secure directory creation, and record shape enums used by the CONSUME-side validator.

function createLocalRegistry({
  BigInt,
  DURABLE_ABSENT,
  DURABLE_PENDING,
  classifyDurableRead,
  execFileSync,
  fs,
  os,
  path,
  realpathOrSelf,
  resolvedWindowsPowerShellPath,
  sha256String,
  windowsPrivateDirectoryAcl,
}) {
// ─────────────────────────────────────────────────────────────────────────────
// M7/WP4 second-pass correction (PLAN.md §15b, ~L592/~L604): role-command-
// grant/v1 -- CONSUME side. context-provider-gate.js mints REQUESTER grants
// (via a RequesterBinding); runtime-consultation-target-gate.js mints
// TARGET grants (via an existing RoleActorBinding); this file -- the CLI
// both hooks inject into -- atomically one-time-consumes and fully
// validates the referenced grant BEFORE any read or mutation, wired
// generically into main() below (see ROLE_COMMAND_GRANT_AUTHORITY_FOR_COMMAND).
//
// This module cannot require runtime-role-lifecycle.cjs directly: that module
// ALREADY requires the consultation facade near its own top (an `rc` binding
// sourced from runtime-consultation.cjs), so an rc -> rll require would be
// circular. The small
// set of host-private registry primitives this section needs (registry
// base/repo-dir path formula, secure directory creation, the
// RequesterBinding/RoleActorBinding closed-shape validators) are therefore
// a small, LOGIC-IDENTICAL local copy of runtime-role-lifecycle.cjs's own --
// mirrors this file's existing `hasExactKeys` duplication precedent (see its
// own doc comment above) rather than a weaker reimplementation. A grant file
// is a security boundary; nothing here trades rigor for brevity.
//
// SCOPE: M7 completeness pass (2026-08-09) extends grant-gating to the full
// PLAN.md §15b 18-command matrix -- 14 requester (root-init, root-validate,
// publish-blob, publish-request, dispatch, record-delivery, takeover,
// await-result, accept-result, transaction-ack, cancel, worker-stop,
// cleanup, validate) and 4 target (claim, lease-heartbeat, publish-result,
// worker-stop-ack). See context-provider-gate.js's own
// REQUESTER_ADMIN_SUBCOMMANDS comment for the requester-side injection
// wiring (the mint/injection mechanism itself is fully generic across every
// requester subcommand -- extending its scope needed no new logic, only
// this data change).
// ─────────────────────────────────────────────────────────────────────────────

const ROLE_COMMAND_GRANT_SCHEMA = 'runtime/role-command-grant/v1';
const ROLE_COMMAND_GRANT_TTL_SECONDS = 30; // PLAN.md §15b: "<=30s ceiling".
const ROLE_COMMAND_GRANT_KEYS = [
  'actor_instance_id', 'attempt_id', 'authority', 'binding_id',
  'canonical_argv_digest', 'created_at', 'expiry', 'grant_id', 'lease_epoch',
  'plan_digest', 'request_id', 'role', 'schema', 'subcommand', 'worktree_id',
].sort();
const REQUESTER_BINDING_SCHEMA = 'coordination/requester-binding/v1';
const REQUESTER_BINDING_KEYS = [
  'actor_instance_id', 'agent_key', 'binding_id', 'created_at', 'expiry',
  'plan_digest', 'role', 'runtime', 'runtime_session_key', 'schema', 'worktree_id',
].sort();
const ROOT_SOURCE_BINDING_SCHEMA_LOCAL = 'runtime/root-source-binding/v1';
// M7 completeness: the v2 sibling of ROOT_SOURCE_BINDING_SCHEMA_LOCAL/
// CLAUDE_ONE_SHOT_BINDING_SCHEMA below, mirroring runtime-role-lifecycle.cjs's
// own ROOT_SOURCE_BINDING_SCHEMA_V2/CLAUDE_ONE_SHOT_BINDING_SCHEMA_V2 literal
// values exactly. A fresh v2-migrated binding's grantContext.bindingSchema
// (derived from bindingResult.binding.schema, itself now sourced from the
// real v1/v2-aware runtime-role-lifecycle.cjs validators) must be recognized
// by every routing/security check below, not just the pre-migration v1 value.
const ROOT_SOURCE_BINDING_SCHEMA_V2 = 'runtime/root-source-binding/v2';
// M6-M7-ROOT-SOURCE-CONTINUATION-CLOSURE-20260820: the ONE private predicate
// for "this authenticated grantContext is backed by a root-source binding"
// (accepted v1 or v2 schema). Shared by main()'s publish-request
// serialization branch and by cmdDispatch's routing constraint -- never two
// divergent schema checks. A missing/undefined grantContext (a command that
// is not grant-gated, or an in-process caller such as the host bridge) is
// never root-source.
function isRootSourceGrantContext(grantContext) {
  return Boolean(grantContext)
    && (grantContext.bindingSchema === ROOT_SOURCE_BINDING_SCHEMA_LOCAL
      || grantContext.bindingSchema === ROOT_SOURCE_BINDING_SCHEMA_V2);
}
const ROOT_SOURCE_PRE_INGRESS_COMMANDS = new Set([
  'root-init', 'root-validate', 'validate', 'publish-blob', 'publish-request',
]);
const ROOT_SOURCE_POST_INGRESS_COMMANDS = new Set([
  'dispatch', 'await-result', 'accept-result', 'transaction-ack', 'cancel',
  'cleanup', 'record-delivery',
]);
const CLAUDE_ONE_SHOT_BINDING_SCHEMA = 'runtime/claude-one-shot-binding/v1';
const CLAUDE_ONE_SHOT_BINDING_SCHEMA_V2 = 'runtime/claude-one-shot-binding/v2';
// Logic-identical local copy of runtime-role-lifecycle.cjs's own
// CANONICAL_ROLES/IDENTITY_PROVIDER_ENUM (same circular-import constraint).
const GRANT_CANONICAL_ROLES = [
  'arch-platform', 'arch-testing', 'arch-integration', 'context-provider',
  'doc-updater', 'toolkit-specialist', 'test-specialist', 'verifier',
  'quality-gater', 'planner',
];
const GRANT_IDENTITY_PROVIDER_ENUM = ['claude-hook', 'codex-supervisor'];
const HEX_CSPRNG_32_RE = /^[0-9a-f]{32}$/;

// authority -> the bare (no leading "--") flag name carrying the grant id on
// the executed command. M7 completeness (2026-08-09): extended to the FULL
// PLAN.md §15b matrix -- all 14 requester subcommands ("Requester authority
// covers root-init, root-validate, publish-blob, publish-request, dispatch,
// requester-owned record-delivery, takeover, await-result, accept-result,
// transaction-ack, cancel, worker-stop, cleanup, and validate") plus the 4
// target subcommands ("Target authority covers native/external claim,
// lease-heartbeat, publish-result, and worker-stop-ack"). This is a pure
// data extension: main()'s own validateAndConsumeRoleCommandGrantForCommand
// call, cli-argv.cjs's complete-at-construction COMMAND_FLAGS table,
// and the split grant-validation/consumption pipeline
// were all already generic (keyed off this map's own entries, never a
// hardcoded subcommand list) -- see RCG-REQ12-*-NOGRANT in
// runtime-consultation-role-gate-core.bats.
function localComputePrincipalId() {
  if (typeof process.getuid === 'function') return 'uid-' + process.getuid();
  return 'user-' + sha256String(os.userInfo().username);
}

const LOCAL_TEST_PRIVATE_REGISTRY_BASE_SYMBOL = Symbol.for('android-common-doc.runtime-private-registry-base');
let cachedWindowsCommonApplicationData = undefined;

function localWindowsCommonApplicationDataRoot() {
  if (cachedWindowsCommonApplicationData !== undefined) return cachedWindowsCommonApplicationData;
  const powerShellPath = resolvedWindowsPowerShellPath();
  if (!powerShellPath) {
    cachedWindowsCommonApplicationData = null;
    return null;
  }
  let observed = null;
  let probeError = null;
  // This is the same external-host boundary as the ACL probe above. Retry only
  // a process failure; a successfully returned but invalid known-folder value
  // remains a hard failure and is never retried into acceptance.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      observed = execFileSync(powerShellPath, [
        '-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
        '[Console]::Out.Write([Environment]::GetFolderPath("CommonApplicationData"))',
      ], { encoding: 'utf8', windowsHide: true }).trim();
      probeError = null;
      break;
    } catch (err) {
      probeError = err;
    }
  }
  if (probeError) {
    cachedWindowsCommonApplicationData = null;
    return null;
  }
  try {
    if (!path.isAbsolute(observed)) return null;
    const real = fs.realpathSync(observed);
    if (!fs.statSync(real).isDirectory()) return null;
    const homeReal = realpathOrSelf(os.homedir());
    const relativeToHome = path.relative(homeReal, real);
    if (relativeToHome === '' || (!relativeToHome.startsWith('..' + path.sep) && relativeToHome !== '..' && !path.isAbsolute(relativeToHome))) {
      return null;
    }
    cachedWindowsCommonApplicationData = real;
    return real;
  } catch {
    cachedWindowsCommonApplicationData = null;
    return null;
  }
}

function localRegistryBaseDir() {
  const testPrivateBase = globalThis[LOCAL_TEST_PRIVATE_REGISTRY_BASE_SYMBOL];
  if (typeof testPrivateBase === 'string' && path.isAbsolute(testPrivateBase)) {
    return path.join(testPrivateBase, localComputePrincipalId());
  }
  if (process.platform === 'win32') {
    const commonApplicationData = localWindowsCommonApplicationDataRoot();
    if (!commonApplicationData) throw new Error('windows-common-application-data-unavailable');
    return path.join(commonApplicationData, 'AndroidCommonDoc', 'runtime', localComputePrincipalId());
  }
  return path.join(os.tmpdir(), 'android-common-doc-runtime', localComputePrincipalId());
}

function localRegistryRepoDir(repoId) {
  return path.join(localRegistryBaseDir(), repoId);
}
function roleCommandGrantPathFor(repoId, grantId) {
  return path.join(localRegistryRepoDir(repoId), 'role-command-grants', grantId + '.json');
}
function roleCommandGrantConsumedMarkerPathFor(repoId, grantId) {
  return path.join(localRegistryRepoDir(repoId), 'role-command-grants', grantId + '.consumed');
}
// M7 completeness: requesterBindingPathForLocal/roleActorBindingPathForLocal/
// claudeOneShotBindingPathForLocal/claudeOneShotBindingRetiredMarkerPathForLocal
// are REMOVED -- every caller now uses runtime-role-lifecycle.cjs's own
// requesterBindingPathFor/roleActorBindingPathFor/claudeOneShotBindingPathFor/
// claudeOneShotBindingRetiredMarkerPathFor directly (lazy-required, same
// circular-load-safe pattern already established throughout this file).

/** Logic-identical local copy of runtime-role-lifecycle.cjs's own ensureSecureRegistryDir. */
function localEnsureSecureRegistryDir(dirPath) {
  try {
    const lst = fs.lstatSync(dirPath);
    if (lst.isSymbolicLink()) return { ok: false, reason: 'symlink' };
  } catch (err) {
    // ENOENT (does not exist yet) is the normal, expected case -- proceed.
  }
  try {
    fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
    if (process.platform !== 'win32') fs.chmodSync(dirPath, 0o700);
  } catch (err) {
    return { ok: false, reason: 'mkdir-failed' };
  }
  if (process.platform === 'win32') {
    const registryBase = path.resolve(localRegistryBaseDir());
    const target = path.resolve(dirPath);
    const relative = path.relative(registryBase, target);
    if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
      return { ok: false, reason: 'registry-path-outside-base' };
    }
    // Keep this chain walk logic-identical to runtime-role-lifecycle.cjs:
    // recursive mkdir on Windows does not make the principal/repo ancestors
    // private, so every authority-bearing level must receive the shared SID
    // ACL primitive, not only the last leaf.
    const aclChain = [registryBase];
    let cursor = registryBase;
    for (const segment of relative.split(path.sep).filter(Boolean)) {
      cursor = path.join(cursor, segment);
      aclChain.push(cursor);
    }
    const acl = windowsPrivateDirectoryAcl(aclChain, { mode: 'ensure' });
    if (!acl.ok) return { ok: false, reason: acl.status === 'failed' ? 'acl-failed' : 'acl-indeterminate' };
  } else {
    let st;
    try {
      st = fs.lstatSync(dirPath, { bigint: true });
    } catch (err) {
      return { ok: false, reason: 'stat-failed' };
    }
    if (st.isSymbolicLink()) return { ok: false, reason: 'symlink' };
    if (typeof process.getuid === 'function' && st.uid !== BigInt(process.getuid())) {
      return { ok: false, reason: 'wrong-owner' };
    }
    if ((st.mode & 0o777n) !== 0o700n) return { ok: false, reason: 'wrong-mode' };
  }
  return { ok: true };
}

// M7 completeness: this file's former local-copy RoleActorBinding validator
// is REMOVED -- validateRoleCommandGrantOrThrow now calls
// runtime-role-lifecycle.cjs's own validateRoleActorBindingFor directly
// (lazy-required), which is already v1/v2+fence-aware. The ISO-8601-
// canonical-form checker and low-level registry-record reader just above
// this comment are NOT removed: validateRoleCommandGrantOrThrow also uses
// them to read/validate the grant file itself, a separate concern with no
// runtime-role-lifecycle.cjs equivalent.

// M7 completeness: this file's former local-copy Claude-one-shot-binding
// validator is REMOVED -- validateRoleCommandGrantOrThrow now calls
// runtime-role-lifecycle.cjs's own validateClaudeOneShotBindingFor directly
// (lazy-required), already v1/v2+fence-aware.

// M7 section 4/8.5: this file's former local-copy one-shot-family live-
// bindings scanner and its retirement writer are REMOVED along with their
// sole caller (cmdCancel's retirement-wiring branch, below) -- no new
// retirement artifact is written for a Claude one-shot binding; cancellation
// of a one-shot target is cut by canonical cancel.json directly, not a
// marker on the binding.

// M6+M7 FINAL AUTHORITY CORRECTION (agent_id binding closure) + HARD NO-GO
// correction (items 1/2/3), M7 completeness: claudeId01LookupKeyLocal/
// claudeId01RecordPathForLocal/sessionLookupKeyLocal/
// sessionGenerationPathForLocal/peekSessionGenerationLocal/
// isClaudeId01AttestationWellFormedLocal/checkClaudeId01ProofCompleteLocal/
// validateRequesterBindingForLocal/validateRootSourceBindingForLocal are
// REMOVED. The last two were already pure circular-load-safe delegations to
// runtime-role-lifecycle.cjs's own validateRequesterBindingFor/
// validateRootSourceBindingFor; every remaining caller now lazy-requires
// runtime-role-lifecycle.cjs and calls those directly, the same pattern
// already established throughout this file.

// M7 defect 9 (section 6): this file's former dual-family-probe helper pair
// (deciding whether a family's own binding directory genuinely holds
// nothing at a given id, used to disambiguate a "try both validators" grant
// backing lookup) is removed -- validateRoleCommandGrantOrThrow now
// discriminates the backing namespace directly via one fd-bound presence
// read per family, before ever calling either validator.

// M7 section 4/8.5: retireExpiredRootSourceBindingOrThrow is REMOVED --
// expiry is a read-only cut (validateRootSourceBindingFor's own fresh-read
// expiry check), never a retirement-artifact write. The caller above already
// throws AUTHORITY_INVALID for an expired root-source binding regardless.

// Genuinely still needed (not part of the deleted binding-validation Local
// family): validateRoleCommandGrantOrThrow reads/validates the
// role-command-grant/v1 file itself, which has no runtime-role-lifecycle.cjs
// equivalent -- grants are this file's own concept, not a binding.
function isCanonicalIsoUtcLocal(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)) return false;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return false;
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z') === value;
}

/**
 * Fd-bound secure read for this section's own local registry records
 * (role-command-grant/v1) -- mirrors runtime-role-lifecycle.cjs's own
 * readRegistryRecord exactly (the SAME classifyDurableRead primitive already
 * used throughout this file for every OTHER coordination-adjacent record,
 * same immutablePath:true default). Never a raw fs.readFileSync: a grant
 * file is a security boundary and must get the same fd-bound, no-follow,
 * owner/mode-checked, TOCTOU-resistant read every other record in this file
 * receives.
 */
function readLocalRegistryRecord(recordPath) {
  const classified = classifyDurableRead(recordPath, { parse: true });
  if (classified.state === DURABLE_ABSENT) return { ok: true, absent: true };
  if (classified.state === DURABLE_PENDING) return { ok: false, reason: 'pending' };
  return { ok: true, obj: classified.obj };
}

  return Object.freeze({
    CLAUDE_ONE_SHOT_BINDING_SCHEMA,
    CLAUDE_ONE_SHOT_BINDING_SCHEMA_V2,
    GRANT_CANONICAL_ROLES,
    GRANT_IDENTITY_PROVIDER_ENUM,
    HEX_CSPRNG_32_RE,
    LOCAL_TEST_PRIVATE_REGISTRY_BASE_SYMBOL,
    REQUESTER_BINDING_KEYS,
    REQUESTER_BINDING_SCHEMA,
    ROLE_COMMAND_GRANT_KEYS,
    ROLE_COMMAND_GRANT_SCHEMA,
    ROLE_COMMAND_GRANT_TTL_SECONDS,
    ROOT_SOURCE_BINDING_SCHEMA_LOCAL,
    ROOT_SOURCE_BINDING_SCHEMA_V2,
    ROOT_SOURCE_POST_INGRESS_COMMANDS,
    ROOT_SOURCE_PRE_INGRESS_COMMANDS,
    isCanonicalIsoUtcLocal,
    isRootSourceGrantContext,
    localComputePrincipalId,
    localEnsureSecureRegistryDir,
    localRegistryBaseDir,
    localRegistryRepoDir,
    localWindowsCommonApplicationDataRoot,
    readLocalRegistryRecord,
    roleCommandGrantConsumedMarkerPathFor,
    roleCommandGrantPathFor,
  });
}

module.exports = { createLocalRegistry };
