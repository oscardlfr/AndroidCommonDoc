#!/usr/bin/env node
'use strict';

/**
 * runtime-bridge-codex.cjs -- Wave 1 (portable-runtime-messaging-adapters)
 * WP3 item C. PLAN.md "Host-native lifecycle action boundary" ~L162,
 * "13b. Host-private supervisor rendezvous/control" ~L536-542, "Frozen
 * Production CLI ABI" (bridge table) ~L783-797, "App-server worker" ~L889.
 *
 * C1 SCOPE (this slice, corrected per user NO-GO on the first pass): `session-run`
 * parses its frozen argv, then in strict order:
 *  1. reads-only-revalidates its own admitted `supervisor-start` action end to
 *     end against a fresh identity re-derivation (repo/worktree/plan/argv/
 *     session-generation-liveness/full-action-shape) -- defense in depth,
 *     never trusts the spawn-gate hook alone;
 *  2. reads-only-confirms every requested role's binding is currently
 *     STARTING/REHYDRATING with `pending_action_id` equal to THIS action;
 *  3. reads-only-confirms the coordination root is fully confined (reusing
 *     `runtime-consultation.cjs`'s own `validateRootConfinement`, never a
 *     second weaker check);
 *  4. validates+atomically-consumes the `SupervisorExecutionClaim/v1` --
 *     THIS is PLAN.md ~L580's "atomically transitions that action to
 *     EXECUTING", a distinct authority from both the lifecycle-command-grant
 *     that authorized the `ensure` call which minted the action, and the
 *     role-owner rendezvous record below; production fails closed if no
 *     claim exists (WP4 wires the real issuer) -- this is the FIRST actual
 *     registry write, after every read-only check has passed;
 *  5. atomically wins ONE role-owner rendezvous record per requested role
 *     (record 13b's "start marker"), ALL sharing the SAME
 *     `rendezvous_instance_id`/`supervisor_instance_id`/`pid_identity`
 *     (one process, one identity, N roles) -- ordered, all-or-nothing,
 *     rolled back on any partial failure;
 *  6. blocks until SIGTERM/SIGINT/session-expiry, then releases only the
 *     role-owner records it still actually owns (ownership re-checked
 *     against a fresh disk read -- never blindly deletes a replacement
 *     owner) and prints one bridge-result JSON.
 *
 * `session-run` NEVER receives `--lifecycle-binding` (absent from the frozen
 * ABI, PLAN.md ~L787) -- the spawn-gate's one-use consumption marker
 * (`bash-cli-spawn-gate.js`, already shipped WP3 item B) authorizes the
 * BACKGROUND LAUNCH itself and may stay as an anti-replay diagnostic, but it
 * is NOT execution authority -- that is what the execution claim (step 4)
 * proves.
 *
 * NOT this file's job yet: spawning/managing an app-server child (C2), the
 * loopback control socket / MCP attach (C5), or secret-bearing descriptor
 * fields (`control_capability`, endpoint host/port) -- those require the
 * live backend this slice deliberately does not yet stand up. This session
 * only mints the non-secret role-owner sub-record of record 13b. No process
 * enumeration exists anywhere in this file (nothing to attach to/kill yet);
 * the "never touch a pre-existing Codex Desktop app-server" caveat (memory:
 * codex-cli-runtime-surfaces) becomes a live concern only once C2 spawns a
 * real child.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const rll = require('./runtime-role-lifecycle.cjs');
const {
  publishNoClobber,
  findActionAcrossRepos, registryRepoDir, ensureSecureRegistryDir, withRegistryLock,
  computeRepoId, computeWorktreeId, discoverPlan, readRegistryRecord,
  readRoleBindingState, roleProfileDigestFor, CANONICAL_ROLES, renderPosixDirect,
  validateAndConsumeExecutionClaim, resolvePolicyPair, terminalizeSupervisorStartAction,
  hasExactKeys, resolvedNodePath, hasOnlyAllowedKeys, ROLE_BINDING_ALLOWED_KEYS,
} = rll;
// `runtime-role-lifecycle.cjs` imports these from the sibling internally but
// does not re-export them all itself (only `publishNoClobber` is); pull them
// from the same sibling module directly, exactly as role-lifecycle.cjs does.
const rc = require('./runtime-consultation.cjs');
const { sha256String, canonicalJSONStringify, realpathOrSelf, validateRootConfinement } = rc;

// Bridge CLI exits (PLAN.md ~L794). Action-handoff/execution-claim/binding
// revalidation failures use AUTH_ISOLATION (4): re-deriving/matching the
// action IS the authorization check for this process (there is no dedicated
// "action mismatch" bucket in this coarser bridge-exit table, unlike the
// main CLI ABI's own detail_code enum) -- documented interpretive choice,
// not a PLAN-literal mapping. CLEANUP_INTERNAL (7) is reserved EXCLUSIVELY
// for a cleanup-mechanics failure (unlink/directory-barrier) -- never
// conflated with an authorization rejection, per the user's own correction.
const RC = Object.freeze({
  OK: 0,
  USAGE: 2,
  CAPABILITY_SCHEMA_DRIFT: 3,
  AUTH_ISOLATION: 4,
  TIMEOUT: 5,
  LIVE_CONFORMANCE_FAILURE: 6,
  CLEANUP_INTERNAL: 7,
});

// Point E: exact key-set closure for the action envelope and its
// `supervisor-start` payload (PLAN.md ~L154, ~L162). Role-binding records
// have a legitimately variable optional-field shape (driver/respawn_count/
// pending_action_id/team_ensure_action_id/failure_reason/updated_at all
// depend on which transition produced them) -- closed there means "no key
// outside this allowed superset", not an exact set.
const ACTION_ENVELOPE_KEYS = Object.freeze([
  'action_id', 'expires_at', 'kind', 'payload', 'plan_digest', 'policy_digest',
  'repo_id', 'role', 'runtime', 'schema', 'session_generation_id', 'worktree_id',
]);
const SUPERVISOR_START_PAYLOAD_KEYS = Object.freeze(['bridge', 'bridge_argv', 'bridge_command']);
// ROLE_BINDING_ALLOWED_KEYS / hasOnlyAllowedKeys: canonical home is
// runtime-role-lifecycle.cjs (imported above) -- readRoleBindingState there
// now enforces the SAME closed shape itself (point A.3), this file's own
// re-check (below, validateBindingsPendThisAction) stays as defense in
// depth against a stale/tampered read.

function usageError(message) {
  process.stderr.write('usage error: ' + message + '\n');
  process.exit(RC.USAGE);
}

function authError(reason) {
  process.stderr.write('[session-run] rejected: ' + reason + '\n');
  process.exit(RC.AUTH_ISOLATION);
}

function arraysEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

function isTestCapability() {
  return process.env.NODE_ENV === 'test'
    && typeof process.env.RUNTIME_BRIDGE_CODEX_TEST_CAPABILITY === 'string'
    && process.env.RUNTIME_BRIDGE_CODEX_TEST_CAPABILITY.length > 0;
}

// ── ProcessIdentityProvider (injectable) ────────────────────────────────────
// Production: real OS-observed process-birth (`ps -o lstart=`, POSIX) plus a
// resolved executable identity -- a self-reported `Date.now()` timestamp
// proves nothing an external reader couldn't fabricate just as easily, so it
// is never used here. Point D.4: `ps` is resolved from a FIXED, absolute
// candidate list -- never bare `'ps'` via `PATH`, which an attacker- or
// environment-controlled PATH could substitute ahead of the real system
// binary (the exact same risk class the sibling module's own
// resolvedNodePath() already guards against for `node`). Absence (no
// candidate resolves, or `process.execPath` cannot itself be
// realpath-validated) is reported honestly as `null`, never fabricated and
// never silently defaulted to an unresolved/unproven value. Tests inject a
// deterministic value via the SAME `NODE_ENV=test` +
// `RUNTIME_BRIDGE_CODEX_TEST_CAPABILITY` double-gate this file's other test
// seams use, plus their own dedicated
// `RUNTIME_BRIDGE_CODEX_FAKE_PROCESS_IDENTITY` JSON payload.

const PS_ABSOLUTE_CANDIDATES = Object.freeze(['/bin/ps', '/usr/bin/ps']);
let cachedResolvedPsPath; // undefined = not yet resolved; null = proven absent.

/** First realpath-validated, regular-file candidate from PS_ABSOLUTE_CANDIDATES, or null. Memoized -- the filesystem layout is invariant for the life of this process. */
function resolvedPsPath() {
  if (cachedResolvedPsPath !== undefined) return cachedResolvedPsPath;
  cachedResolvedPsPath = null;
  for (const candidate of PS_ABSOLUTE_CANDIDATES) {
    let real;
    try {
      real = fs.realpathSync(candidate);
    } catch (err) {
      continue; // absent -- try the next candidate.
    }
    let st;
    try {
      st = fs.statSync(real);
    } catch (err) {
      continue;
    }
    if (st.isFile()) { cachedResolvedPsPath = real; break; }
  }
  return cachedResolvedPsPath;
}

function defaultProcessIdentityProvider() {
  const pid = process.pid;
  let executable = null;
  try {
    executable = fs.realpathSync(process.execPath);
  } catch (err) {
    executable = null; // point D.4: fail closed, never fall back to the unresolved path.
  }
  let birthObservedAt = null;
  const psPath = resolvedPsPath();
  if (psPath) {
    try {
      birthObservedAt = execFileSync(psPath, ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8' }).trim() || null;
    } catch (err) {
      birthObservedAt = null; // ps present but this pid's birth is unprovable -- honestly absent.
    }
  } // else: no candidate ps resolves (Windows, or a minimal POSIX host) -- honestly absent.
  return { pid, executable, birth_observed_at: birthObservedAt };
}

/** Test-overridable observed platform (same double-gate as this file's other seams), so win32 rejection is exercisable without a real Windows host. */
function resolveObservedPlatform() {
  if (!isTestCapability()) return process.platform;
  const raw = process.env.RUNTIME_BRIDGE_CODEX_TEST_PLATFORM;
  if (typeof raw !== 'string' || raw.length === 0) return process.platform;
  return raw;
}

function resolveProcessIdentityProvider() {
  if (!isTestCapability()) return defaultProcessIdentityProvider;
  const raw = process.env.RUNTIME_BRIDGE_CODEX_FAKE_PROCESS_IDENTITY;
  if (typeof raw !== 'string' || raw.length === 0) return defaultProcessIdentityProvider;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return defaultProcessIdentityProvider;
  }
  if (!parsed || typeof parsed.pid !== 'number' || typeof parsed.executable !== 'string') return defaultProcessIdentityProvider;
  return () => parsed;
}

/**
 * Point E hard gate: a valid pid, an OBSERVED (non-empty) executable, and a
 * NON-EMPTY process-birth are all REQUIRED before any claim consumption or
 * owner write. Point D.3: win32 is EXPLICITLY refused here, before any
 * platform-specific ps/identity probing even runs -- this project has no
 * verified Windows ACL/SID confinement or ProcessIdentityProvider yet, so
 * production must never rely on the ACCIDENTAL byproduct of `ps` merely
 * being absent (which, under WSL/Git-Bash/Cygwin, is not even guaranteed to
 * be true). Any other host where `ps` cannot prove birth also stays
 * honestly PENDING_CI -- it fails closed here, it never fails OPEN by
 * proceeding with a null/absent birth.
 * @returns {{ok:true,pidIdentity:object}|{ok:false,reason:string}}
 */
function requireProvenProcessIdentity() {
  if (resolveObservedPlatform() === 'win32') {
    return { ok: false, reason: 'process-identity-win32-unverified' };
  }
  const identityProvider = resolveProcessIdentityProvider();
  const pidIdentity = identityProvider();
  if (!pidIdentity || !Number.isInteger(pidIdentity.pid) || pidIdentity.pid <= 0) {
    return { ok: false, reason: 'process-identity-pid-unprovable' };
  }
  if (typeof pidIdentity.executable !== 'string' || pidIdentity.executable.length === 0) {
    return { ok: false, reason: 'process-identity-executable-unprovable' };
  }
  if (typeof pidIdentity.birth_observed_at !== 'string' || pidIdentity.birth_observed_at.length === 0) {
    return { ok: false, reason: 'process-identity-birth-unprovable' };
  }
  return { ok: true, pidIdentity };
}

// ── argv parsing (session-run: --action --coordination-root --role[repeat] --session-expiry, PLAN.md ~L787) ──

const SESSION_RUN_SPEC = Object.freeze({
  '--action': { required: true, repeatable: false },
  '--coordination-root': { required: true, repeatable: false },
  '--role': { required: true, repeatable: true },
  '--session-expiry': { required: true, repeatable: false },
});

/**
 * @param {string[]} rawArgv
 * @returns {{ok:true,value:{action:string,coordinationRoot:string,roles:string[],sessionExpiry:string}}|{ok:false,reason:string}}
 */
function parseSessionRunArgv(rawArgv) {
  const out = { action: null, coordinationRoot: null, roles: [], sessionExpiry: null };
  const seen = {};
  let i = 0;
  while (i < rawArgv.length) {
    const flag = rawArgv[i];
    const spec = SESSION_RUN_SPEC[flag];
    if (!spec) return { ok: false, reason: 'unknown-flag: ' + flag };
    if (i + 1 >= rawArgv.length) return { ok: false, reason: 'missing-value-for: ' + flag };
    const value = rawArgv[i + 1];
    if (seen[flag] && !spec.repeatable) return { ok: false, reason: 'duplicate-flag: ' + flag };
    seen[flag] = true;
    if (flag === '--action') out.action = value;
    else if (flag === '--coordination-root') out.coordinationRoot = value;
    else if (flag === '--role') out.roles.push(value);
    else if (flag === '--session-expiry') out.sessionExpiry = value;
    i += 2;
  }
  const missing = Object.keys(SESSION_RUN_SPEC).filter((flag) => SESSION_RUN_SPEC[flag].required && !seen[flag]);
  if (missing.length > 0) return { ok: false, reason: 'missing-required-flag: ' + missing[0] };
  return { ok: true, value: out };
}

// ── action handoff revalidation (defense in depth vs the spawn-gate) ──

function isHexActionId(value) {
  return typeof value === 'string' && /^[0-9a-f]{32,}$/.test(value);
}

// R4 round 3 (block 2d): a SEPARATE, exact-64 contract for genuine SHA-256
// digest fields (coordination_root_id = `sha256(realpath(coordination_root))`,
// PLAN.md ~L289) -- mirrors the sibling module's own `isHexDigest64`
// (local copy, not imported, matching this file's existing convention of
// keeping its own `isHexActionId` copy rather than importing the sibling's).
// `isHexActionId` above stays UNCHANGED ("32 or more") -- supervisor_instance_id/
// rendezvous_instance_id are crypto-random 32-hex ids, a genuinely different
// contract from a 64-hex digest.
function isHexDigest64(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

/**
 * Scans this repo's `sessions/` registry subtree for a record whose
 * `generation_id` equals `generationId` and is not yet expired. `session-run`
 * has no hook-observed identity tuple to independently RE-DERIVE a session
 * generation the way `ensure` does (PLAN.md ~L150: identity comes only from
 * "hook-observed runtime identity", which a detached background process
 * never receives) -- this is the achievable substitute: prove the claimed
 * generation is still a REAL, LIVE record this repo minted, not a stale or
 * fabricated value merely embedded in the action.
 * @param {{repoId:string}} repoDescriptor
 * @param {string} generationId
 * @returns {boolean}
 */
function sessionGenerationIsLive(repoDescriptor, generationId) {
  const sessionsDir = path.join(registryRepoDir(repoDescriptor), 'sessions');
  let entries;
  try {
    entries = fs.readdirSync(sessionsDir, { withFileTypes: true });
  } catch (err) {
    return false;
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    let read;
    try {
      read = readRegistryRecord(path.join(sessionsDir, entry.name));
    } catch (err) {
      continue;
    }
    if (!read.ok || read.absent) continue;
    const rec = read.obj;
    if (rec && rec.schema === 'runtime/session-generation/v1' && rec.generation_id === generationId) {
      return Date.now() < Date.parse(rec.expires_at);
    }
  }
  return false;
}

/**
 * Independently re-derives `projectRoot` from `--coordination-root` (this
 * ABI has no `--project-root`) and revalidates the found action against that
 * fresh derivation end to end: kind/runtime/role/expiry, repo/worktree/plan
 * identity recomputed from scratch, the COMPLETE closed action shape
 * (`payload.bridge` literal, the resolved-node/absolute-bridge-path/
 * subcommand components of `bridge_argv`, `bridge_command`'s own
 * round-trip), the raw received argv tail deep-equal to the action's own
 * minted `bridge_argv`, and the claimed session generation still live on
 * disk. Read-only throughout -- no registry write happens here.
 * @param {{action:string,coordinationRoot:string,roles:string[],sessionExpiry:string}} parsed
 * @param {string[]} rawArgv - the exact tokens this process received after `session-run`.
 * @returns {{ok:true,projectRoot:string,action:object,coordinationRootReal:string}|{ok:false,reason:string}}
 */
function revalidateSupervisorStartAction(parsed, rawArgv) {
  if (!isHexActionId(parsed.action)) return { ok: false, reason: 'malformed-action-id' };

  const coordRootReal = realpathOrSelf(parsed.coordinationRoot);
  const planningDir = path.dirname(coordRootReal);
  const projectRoot = path.dirname(planningDir);
  if (path.basename(coordRootReal) !== 'coordination' || path.basename(planningDir) !== '.planning') {
    return { ok: false, reason: 'coordination-root-not-canonical-shape' };
  }
  const expectedCoordRoot = path.join(projectRoot, '.planning', 'coordination');
  if (realpathOrSelf(expectedCoordRoot) !== coordRootReal) {
    return { ok: false, reason: 'coordination-root-self-consistency-failed' };
  }

  const found = findActionAcrossRepos(parsed.action);
  if (!found.ok) return { ok: false, reason: 'action-lookup-failed' };
  if (found.absent) return { ok: false, reason: 'action-not-found' };
  const action = found.action;

  // Point E: close the action envelope BEFORE trusting any of its fields,
  // and explicitly verify the record's OWN action_id matches what was
  // looked up (never merely trust the lookup-by-path mechanism).
  if (!hasExactKeys(action, ACTION_ENVELOPE_KEYS)) return { ok: false, reason: 'action-envelope-key-set-invalid' };
  if (action.schema !== 'coordination/role-lifecycle-action/v1') return { ok: false, reason: 'action-schema-invalid' };
  if (action.action_id !== parsed.action) return { ok: false, reason: 'action-id-content-path-mismatch' };
  if (action.kind !== 'supervisor-start') return { ok: false, reason: 'wrong-action-kind' };
  if (action.runtime !== 'host-process') return { ok: false, reason: 'wrong-action-runtime' };
  if (action.role !== null) return { ok: false, reason: 'action-role-not-null' };
  const actionExpiryMs = Date.parse(action.expires_at);
  if (!Number.isFinite(actionExpiryMs)) return { ok: false, reason: 'action-expiry-invalid' };
  if (!(Date.now() < actionExpiryMs)) return { ok: false, reason: 'action-expired' };
  // Point E: the session's own operative deadline must correlate with the
  // action's admission window -- today's minting sets both to the identical
  // instant; any divergence is treated as suspicious rather than silently
  // trusting whichever argv happens to have been supplied.
  const parsedSessionExpiryMs = Date.parse(parsed.sessionExpiry);
  if (parsedSessionExpiryMs !== actionExpiryMs) return { ok: false, reason: 'session-expiry-action-expiry-mismatch' };

  let repoIdFresh, worktreeIdFresh;
  try {
    repoIdFresh = computeRepoId(projectRoot);
    worktreeIdFresh = computeWorktreeId(projectRoot);
  } catch (err) {
    return { ok: false, reason: 'identity-derivation-failed' };
  }
  const planFresh = discoverPlan(projectRoot);
  if (!planFresh.ok) return { ok: false, reason: 'plan-not-discoverable' };
  const pair = resolvePolicyPair(projectRoot);
  if (!pair.ok) return { ok: false, reason: 'policy-invalid' };
  const currentPolicyDigest = sha256String(canonicalJSONStringify(pair.routing));

  if (action.repo_id !== repoIdFresh) return { ok: false, reason: 'repo-id-mismatch' };
  if (action.worktree_id !== worktreeIdFresh) return { ok: false, reason: 'worktree-id-mismatch' };
  if (action.plan_digest !== planFresh.planDigest) return { ok: false, reason: 'plan-digest-mismatch' };
  // Point E: the action's own policy_digest must match the CURRENT
  // routing.json, never merely an old snapshot from before a routing change.
  if (action.policy_digest !== currentPolicyDigest) return { ok: false, reason: 'policy-digest-drift' };

  const payload = action.payload;
  if (!hasExactKeys(payload, SUPERVISOR_START_PAYLOAD_KEYS)) return { ok: false, reason: 'supervisor-payload-key-set-invalid' };
  if (payload.bridge !== 'codex-app-server') return { ok: false, reason: 'payload-bridge-literal-mismatch' };
  const expectedArgv = payload.bridge_argv;
  if (!Array.isArray(expectedArgv) || expectedArgv.length < 3) return { ok: false, reason: 'action-payload-malformed' };
  // Point 4: bridge_argv[0] is the resolved, realpath-verified node binary
  // (never a bare "node" PATH-dependent literal) -- this process was ITSELF
  // execve'd with that exact executable, so its own resolvedNodePath() must
  // trivially agree; a mismatch means the action was tampered to point at a
  // different binary than the one actually running.
  if (expectedArgv[0] !== resolvedNodePath()) return { ok: false, reason: 'bridge-argv-node-path-mismatch' };
  // realpathOrSelf on BOTH sides -- Node's own module resolution realpaths
  // __filename (dereferencing e.g. macOS's /tmp -> /private/tmp symlink),
  // while bridge_argv[1] is a plain joined path never realpath'd at mint
  // time; comparing raw path.resolve() on both would false-reject on any
  // host where the project root sits under a symlinked prefix.
  if (realpathOrSelf(expectedArgv[1]) !== realpathOrSelf(__filename)) return { ok: false, reason: 'bridge-argv-path-mismatch' };
  if (expectedArgv[2] !== 'session-run') return { ok: false, reason: 'bridge-argv-subcommand-mismatch' };
  if (typeof payload.bridge_command !== 'string' || renderPosixDirect(expectedArgv) !== payload.bridge_command) {
    return { ok: false, reason: 'bridge-command-round-trip-failed' };
  }
  const expectedTail = expectedArgv.slice(3);
  if (!arraysEqual(rawArgv, expectedTail)) return { ok: false, reason: 'argv-does-not-match-action-payload' };

  if (!sessionGenerationIsLive({ repoId: action.repo_id }, action.session_generation_id)) {
    return { ok: false, reason: 'session-generation-not-live' };
  }

  return { ok: true, projectRoot, action, coordinationRootReal: coordRootReal };
}

/**
 * Point C.8's binding-side check: every requested role's binding must
 * currently be STARTING/REHYDRATING with `pending_action_id` equal to
 * THIS action -- proves a live role-binding actually expects this exact
 * action to be the one authorizing its start, closing the gap where an
 * otherwise-valid-but-orphaned action (no binding references it anymore)
 * could still be presented. Read-only.
 * @returns {{ok:true}|{ok:false,reason:string}}
 */
function validateBindingsPendThisAction(repoDescriptor, action, roles) {
  for (const role of roles) {
    const profileDigest = roleProfileDigestFor(role);
    const stateResult = readRoleBindingState(repoDescriptor, action.worktree_id, action.plan_digest, profileDigest, action.session_generation_id, role);
    if (!stateResult.ok) return { ok: false, reason: 'binding-lookup-failed:' + role };
    if (!stateResult.record || !hasOnlyAllowedKeys(stateResult.record, ROLE_BINDING_ALLOWED_KEYS)) {
      return { ok: false, reason: 'binding-shape-invalid:' + role };
    }
    if (
      (stateResult.state !== 'STARTING' && stateResult.state !== 'REHYDRATING')
      || stateResult.record.pending_action_id !== action.action_id
    ) {
      return { ok: false, reason: 'binding-not-pending-this-action:' + role };
    }
  }
  return { ok: true };
}

// ── registry/rendezvous: the "start marker" (PLAN.md record 13b, role-owner) ──

const ROLE_OWNER_SCHEMA = 'coordination/supervisor-rendezvous-role-owner/v1';

function computeCoordinationRootId(coordinationRootReal) {
  return sha256String(coordinationRootReal);
}

function roleOwnerPathFor(repoDescriptor, coordinationRootId, role) {
  return path.join(registryRepoDir(repoDescriptor), 'rendezvous', 'role-owners', coordinationRootId, role + '.json');
}

// Point E: acquisition and cleanup share ONE per-role exclusion (never a
// bare read-then-unlink) -- the SAME lock directory serializes
// `claimRoleOwner` and `releaseOwnedRoleOwner` for a given owner path, so a
// release's read-then-unlink can never race a concurrent claim/replacement.
function roleOwnerLockDirFor(ownerPath) {
  return ownerPath + '.lock';
}

/**
 * Atomically wins the role-owner record for `(coordination_root_id, role)`
 * -- the "start marker". First-writer-wins / EEXIST-fatal: this is BOTH the
 * process-ownership marker and the one-use/replay guard for the minting
 * action, since a role only ever has one live owner at a time (PLAN.md
 * ~L538: "A second process may neither replace an owner nor start another
 * role child"). `rendezvousInstanceId`/`supervisorInstanceId`/`pidIdentity`
 * are supplied by the caller (ONE shared identity per process, minted once,
 * reused across every role this same `session-run` invocation claims --
 * point C.1), never generated per-role here. An AMBIGUOUS `publishNoClobber`
 * failure (anything other than the clean `AUTHORITY_INVALID` race-loss --
 * e.g. `DURABILITY_UNPROVEN` or a raw fs error) is reported distinctly
 * (`ambiguous:true`) rather than silently folded into "someone else owns
 * this": the caller must roll back/quarantine, never treat it as a clean no-op.
 * @returns {{ok:true,ownerPath:string,record:object}|{ok:false,reason:string,ambiguous?:boolean}}
 */
function claimRoleOwner(repoDescriptor, coordinationRootId, role, rendezvousInstanceId, supervisorInstanceId, pidIdentity) {
  if (!CANONICAL_ROLES.includes(role)) return { ok: false, reason: 'role-not-canonical' };
  const ownerPath = roleOwnerPathFor(repoDescriptor, coordinationRootId, role);
  const dirResult = ensureSecureRegistryDir(path.dirname(ownerPath));
  if (!dirResult.ok) return { ok: false, reason: dirResult.reason };
  const record = {
    schema: ROLE_OWNER_SCHEMA,
    coordination_root_id: coordinationRootId,
    role,
    rendezvous_instance_id: rendezvousInstanceId,
    supervisor_instance_id: supervisorInstanceId,
    pid_identity: pidIdentity,
  };
  const locked = withRegistryLock(roleOwnerLockDirFor(ownerPath), () => {
    try {
      publishNoClobber(ownerPath, Buffer.from(canonicalJSONStringify(record), 'utf8'), { raceDetailCode: 'AUTHORITY_INVALID' });
      return { ok: true };
    } catch (err) {
      if (err && err.detailCode === 'AUTHORITY_INVALID') {
        return { ok: false, reason: 'role-already-owned', ambiguous: false };
      }
      return { ok: false, reason: 'role-owner-claim-ambiguous:' + ((err && (err.detailCode || err.code)) || 'unknown'), ambiguous: true };
    }
  });
  if (!locked.ok) return { ok: false, reason: 'lock-timeout', ambiguous: true };
  if (!locked.value.ok) return locked.value;
  return { ok: true, ownerPath, record, rendezvousInstanceId, supervisorInstanceId };
}

const ROLE_OWNER_KEYS = Object.freeze([
  'coordination_root_id', 'pid_identity', 'rendezvous_instance_id', 'role', 'schema', 'supervisor_instance_id',
].sort());
const PID_IDENTITY_KEYS = Object.freeze(['birth_observed_at', 'executable', 'pid'].sort());

/**
 * Point 4 (R4): a durable, ownership-correlated TOMBSTONE directory
 * sibling to the owner path, namespaced by the exact `supervisor_instance_id`
 * that was on the record being quarantined -- collision-safe across
 * however many claims a role cycles through, and traceable back to exactly
 * which claim produced it (never a bare `.deleted`/timestamp marker that
 * loses that correlation).
 */
function roleOwnerTombstonePathFor(ownerPath, supervisorInstanceId) {
  return path.join(path.dirname(ownerPath), '.tombstone', path.basename(ownerPath) + '.' + supervisorInstanceId);
}

/**
 * Ownership-checked release: re-opens the record on disk and TOMBSTONES it
 * (a durable, RECOVERABLE, GENUINELY NO-CLOBBER copy published into a
 * sibling `.tombstone/` directory via `publishNoClobber` -- never a bare
 * `rename`/`unlink` of the original) ONLY if it still carries the EXACT
 * `supervisor_instance_id`/`rendezvous_instance_id` this process itself
 * minted -- a stale/expired record that a DIFFERENT, later process has
 * since replaced is never touched (point C.4's "no borrar un replacement
 * owner"). Shares `claimRoleOwner`'s own per-role lock (point E), so this
 * read-then-publish-then-unlink can never interleave with a concurrent
 * claim/replacement.
 *
 * Point 4 (R4), hardened R4 round 2 (points 5-6): a plain `lstat`-then-`act`
 * is a CHECK-THEN-ACT over two separate syscalls, never a genuine atomic
 * CAS -- treating it as one overstates the guarantee, and "recoverable" is
 * NOT the same claim as "non-destructive to authority" NOR "no-clobber": a
 * bare `renameSync` unconditionally OVERWRITES whatever already sits at
 * ITS destination on POSIX (a pre-existing tombstone could be silently
 * destroyed), and could, under the SAME race, move a DIFFERENT, legitimate
 * owner's record OUT of the live namespace -- a genuine authority
 * violation, not merely data loss. R4 round 2 splits this into two
 * INDEPENDENT steps with different risk profiles instead of one combined
 * rename: (1) `publishNoClobber` the credited bytes to the tombstone --
 * this step never reads or reasons about `ownerPath`'s CURRENT state at
 * all, so it is unconditionally safe regardless of any rebind, AND it is
 * genuinely no-clobber (a pre-existing tombstone at that exact,
 * instance-id-namespaced path is credited byte-for-byte and this call
 * fails closed, never silently replaced); (2) only once that copy is
 * durable does the function attempt to remove the ORIGINAL, re-verifying
 * its identity immediately beforehand -- if a rebind is detected, the
 * removal is simply skipped (never attempted), and NO restore step is
 * needed because nothing was ever moved or overwritten at `ownerPath` in
 * the first place. This function's actual security contract is
 * deliberately narrower and explicit: it is sound among COOPERATING,
 * LOCK-RESPECTING writers (every real caller in this codebase acquires the
 * SAME per-role lock `claimRoleOwner` does before touching `ownerPath`); a
 * non-lock-respecting adversary forging bytes outside sanctioned surfaces
 * is the separately-scoped Wave 5 peer-authorization threat model, not
 * this one. Destructive garbage collection of aged tombstones is
 * deliberately left to a LATER phase that can accredit the reaping
 * process/path (this wave only proves the write side is safe).
 *
 * WP3 item C correction pass R2 (point 6), hardened R3 (point D.2), R4
 * point 4: the re-open reuses `readRegistryRecord` -- the SAME
 * `classifyDurableRead` primitive every other durable read in this
 * codebase uses (O_NOFOLLOW open, regular-file check, owner-confined-uid
 * check, exact 0600 mode, nlink==2 DURABILITY_UNPROVEN detection) -- never
 * a raw `fs.readFileSync`, which follows symlinks and has none of those
 * guarantees. Three-way correlation verdict, never a single flat
 * "anything unexpected = skip" bucket:
 *   1. Malformed shape, or well-formed but DIFFERENT `supervisor_instance_id`/
 *      `rendezvous_instance_id` (128-bit crypto-random -- a genuine,
 *      later-published REPLACEMENT owner, SUP-RDV-10's legitimate case) --
 *      left untouched, `ok:true, skipped:true`. Malformed and
 *      "instance-id-mismatched" are DISTINGUISHED below, not merged.
 *   2. Malformed shape specifically -- STOP (`ok:false`), never a silent
 *      skip: a malformed record is not evidence of anything, honest or
 *      not, and must not be reasoned about at all. R4 round 2 (point 6)
 *      closes this fully: `role` is CANONICAL_ROLES-enum-validated and
 *      `coordination_root_id`/`supervisor_instance_id`/
 *      `rendezvous_instance_id` are hex-shape-validated, never merely
 *      non-empty strings.
 *   3. Instance ids MATCH (this record claims to be the EXACT one this
 *      process itself published) but role/coordination_root_id/pid_identity
 *      do not (fully or partially) -- STOP (`ok:false`): a genuine
 *      replacement mints FRESH instance ids, so a matching-instance-id/
 *      mismatched-everything-else record is never a legitimate replacement;
 *      it is corruption, tampering, or a pid-reuse coincidence, and must
 *      never be silently treated as "someone else's, skip" (point 4:
 *      "owner malformado o pid_identity ambiguo => rc7/STOP, nunca rc0").
 * @param {object} [expectedPidIdentity] - the `{pid,executable,birth_observed_at}` THIS process minted with; omitted only by tests that do not need this axis.
 * @returns {{ok:true,skipped:boolean,replaced?:boolean}|{ok:false,reason:string}}
 */
function releaseOwnedRoleOwner(ownerPath, expectedSupervisorInstanceId, expectedRendezvousInstanceId, expectedRole, expectedCoordinationRootId, expectedPidIdentity) {
  const locked = withRegistryLock(roleOwnerLockDirFor(ownerPath), () => {
    let preReadStat;
    try {
      preReadStat = fs.lstatSync(ownerPath, { bigint: true });
    } catch (err) {
      if (err && err.code === 'ENOENT') return { ok: true, skipped: true };
      return { ok: false, reason: 'pre-read-stat-failed' };
    }
    const read = readRegistryRecord(ownerPath);
    if (!read.ok) return { ok: false, reason: 'reopen-failed:' + read.reason };
    if (read.absent) return { ok: true, skipped: true };
    const current = read.obj;
    // R4 round 2, point 6 (tightened R4 round 3, block 2d): close the shape
    // of the identity fields themselves -- hasExactKeys alone only proves
    // the KEY SET is right, never that supervisor_instance_id/
    // rendezvous_instance_id are genuinely 32-hex crypto-random ids,
    // coordination_root_id is genuinely a 64-hex sha256 digest (a DIFFERENT
    // contract -- never the same loose "32+" check), or that role is a
    // CLOSED canonical enum member (a bare non-empty-string check would
    // accept anything). The instance-id EQUALITY check below still
    // provides the real security property against a KNOWN-good expected
    // value, but a record that is not even well-shaped is not evidence of
    // anything and must never reach that comparison pretending to be one.
    const shapeOk = (
      current && hasExactKeys(current, ROLE_OWNER_KEYS)
      && current.schema === ROLE_OWNER_SCHEMA
      && CANONICAL_ROLES.includes(current.role)
      && isHexDigest64(current.coordination_root_id)
      && isHexActionId(current.supervisor_instance_id)
      && isHexActionId(current.rendezvous_instance_id)
      && current.pid_identity && hasExactKeys(current.pid_identity, PID_IDENTITY_KEYS)
      && Number.isInteger(current.pid_identity.pid) && current.pid_identity.pid > 0
      && typeof current.pid_identity.executable === 'string' && current.pid_identity.executable.length > 0
      && typeof current.pid_identity.birth_observed_at === 'string' && current.pid_identity.birth_observed_at.length > 0
    );
    if (!shapeOk) {
      // A structurally malformed record is not evidence of anything --
      // never reasoned about as "probably a replacement", never a silent
      // skip. STOP.
      return { ok: false, reason: 'owner-record-shape-invalid' };
    }
    const instanceIdsMismatch = (
      current.supervisor_instance_id !== expectedSupervisorInstanceId
      || current.rendezvous_instance_id !== expectedRendezvousInstanceId
    );
    if (instanceIdsMismatch) {
      // A genuinely DIFFERENT, later-published owner now lives at this
      // path (SUP-RDV-10) -- 128-bit crypto-random ids make this
      // structurally near-impossible to collide with by accident; safe to
      // leave untouched and non-fatal.
      return { ok: true, skipped: true, replaced: true };
    }
    if (
      (expectedRole !== undefined && current.role !== expectedRole)
      || (expectedCoordinationRootId !== undefined && current.coordination_root_id !== expectedCoordinationRootId)
      || (
        expectedPidIdentity !== undefined
        && (
          current.pid_identity.pid !== expectedPidIdentity.pid
          || current.pid_identity.executable !== expectedPidIdentity.executable
          || current.pid_identity.birth_observed_at !== expectedPidIdentity.birth_observed_at
        )
      )
    ) {
      // Instance ids MATCH (claims to be MY exact record) but something
      // else does not -- never a legitimate replacement (one of those
      // would carry fresh instance ids too). Ambiguous: STOP, never a
      // silent skip.
      return { ok: false, reason: 'owner-record-correlation-ambiguous' };
    }

    // Test-only synchronous pause, so a bats test can deterministically
    // rebind the path (real fs.unlink+fs.writeFileSync from a SEPARATE,
    // lock-bypassing script) inside the otherwise sub-microsecond window
    // this check exists to guard. Grants no authority (timing only) --
    // single isTestCapability() gate is sufficient, mirroring this file's
    // other test-only delays. Atomics.wait (not asyncSleep) because this
    // function is synchronous.
    if (isTestCapability()) {
      const raw = process.env.RUNTIME_BRIDGE_CODEX_TEST_PRE_UNLINK_DELAY_MS;
      const delayMs = raw ? parseInt(raw, 10) : NaN;
      if (Number.isFinite(delayMs) && delayMs > 0) {
        try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs); } catch (err) { /* best effort */ }
      }
    }

    // R4 round 2, point 6: the tombstone directory itself is created/
    // verified through the SAME hardened primitive every other
    // host-private registry directory uses (pre-check not-a-symlink,
    // mkdir+chmod 0700, post-check not-a-symlink/owner/mode) -- never a
    // bare mkdirSync that would silently follow/adopt a pre-planted symlink.
    const tombstoneDir = path.join(path.dirname(ownerPath), '.tombstone');
    const tombstoneDirResult = ensureSecureRegistryDir(tombstoneDir);
    if (!tombstoneDirResult.ok) return { ok: false, reason: 'tombstone-dir-failed:' + tombstoneDirResult.reason };

    // R4 round 2, point 6: the tombstone write is now GENUINELY no-clobber
    // (publishNoClobber's own hardlink-from-owned-temp primitive -- the
    // SAME one claimRoleOwner itself uses to win the live owner slot) --
    // never a bare renameSync, which unconditionally OVERWRITES whatever
    // already sits at the destination on POSIX. A pre-existing tombstone at
    // this exact (supervisor_instance_id-namespaced) path is therefore
    // never silently replaced; it is credited byte-for-byte and this call
    // fails closed instead. This step touches ONLY the tombstone
    // destination -- it writes OUR OWN already-credited bytes to a NEW
    // location and never reads or reasons about ownerPath's CURRENT state,
    // so no rebind of ownerPath before this point can affect its
    // correctness at all.
    const tombstonePath = roleOwnerTombstonePathFor(ownerPath, current.supervisor_instance_id);
    try {
      publishNoClobber(tombstonePath, Buffer.from(canonicalJSONStringify(current), 'utf8'), {});
    } catch (err) {
      if (err && err.detailCode === 'AUTHORITY_INVALID') {
        return { ok: false, reason: 'tombstone-already-exists' };
      }
      return { ok: false, reason: 'tombstone-write-failed:' + ((err && (err.detailCode || err.code)) || 'unknown') };
    }

    // R4 round 2, point 6 (wording corrected R4 round 3, round 4 -- finding
    // 3): test-only synchronous pause, positioned strictly AFTER the
    // tombstone write is already durable and BEFORE the pre-unlink identity
    // recheck below, so a bats test can deterministically rebind ownerPath
    // BEFORE that final check runs and observe the check itself catch it.
    // This is honestly a rebind-before-the-final-check proof, NOT a proof
    // of the genuinely irreducible lstat->unlink gap: the delay fires
    // before `fs.lstatSync` is even called, so the rebind it exercises is
    // one the very next lstat call trivially observes -- a real, but much
    // larger and easily-closed window, never the few-CPU-instruction gap
    // between the lstat RETURNING and the unlink EXECUTING. No POSIX
    // primitive can pre-check that narrower gap (there is no "unlink only
    // if inode still matches" syscall); see the comment at the pre-unlink
    // check itself for what actually protects it.
    if (isTestCapability()) {
      const rawPostStat = process.env.RUNTIME_BRIDGE_CODEX_TEST_POST_STAT_PRE_RENAME_DELAY_MS;
      const postStatDelayMs = rawPostStat ? parseInt(rawPostStat, 10) : NaN;
      if (Number.isFinite(postStatDelayMs) && postStatDelayMs > 0) {
        try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, postStatDelayMs); } catch (err) { /* best effort */ }
      }
    }

    // Point D.2, hardened R4 round 2 (point 6): re-verify the path's
    // identity is UNCHANGED since the read above, immediately before the
    // ONLY remaining destructive step -- never remove whatever now lives
    // at this path without proving it is still the SAME file this whole
    // check just credited. Unlike the OLD rename-based design, a failure
    // here needs NO restore step: nothing has been moved or overwritten at
    // ownerPath at any point, so a detected rebind simply means "do not
    // unlink" -- the rebound/foreign file is left completely untouched,
    // and OUR OWN data is already safely durable at the tombstone
    // regardless of this outcome (point 4's "recoverable", never "silently
    // reported as a completed release").
    //
    // Honesty note (R4 round 3, round 4 correction, finding 3): this check
    // closes every window BEFORE it runs (including the one the bats
    // test-only delay above exercises), but it cannot close the genuinely
    // irreducible gap between THIS lstat returning and the unlinkSync call
    // immediately below executing -- no POSIX primitive offers an atomic
    // "unlink iff identity still matches" operation. That narrower gap is
    // NOT covered by any check here; it is covered ENTIRELY by the
    // cooperative lock this whole function already runs under
    // (withRegistryLock, at the call site). The security contract this
    // whole path relies on is scoped exactly that way: authoritative
    // writers to this host-private registry directory all acquire and
    // respect the SAME lock before mutating a role-owner file, so no
    // OTHER lock-respecting writer can rebind ownerPath inside this gap;
    // a non-lock-respecting adversarial process could, in principle, but
    // that is outside this contract's threat model (the same as every
    // other mutation this module performs under the same lock).
    let preUnlinkStat;
    try {
      preUnlinkStat = fs.lstatSync(ownerPath, { bigint: true });
    } catch (err) {
      if (err && err.code === 'ENOENT') return { ok: true, skipped: true };
      return { ok: false, reason: 'pre-unlink-stat-failed' };
    }
    if (preUnlinkStat.dev !== preReadStat.dev || preUnlinkStat.ino !== preReadStat.ino) {
      return { ok: false, reason: 'pre-unlink-identity-mismatch' };
    }
    try {
      fs.unlinkSync(ownerPath);
    } catch (err) {
      if (err && err.code === 'ENOENT') return { ok: true, skipped: true };
      return { ok: false, reason: 'unlink-failed' };
    }
    // Directory-fsync barrier: durably persist the removal from the owner
    // directory. The tombstone side is already durable -- publishNoClobber
    // fsyncs its own barriers internally before ever returning success.
    const ownerDir = path.dirname(ownerPath);
    let fd;
    try {
      fd = fs.openSync(ownerDir, 'r');
      fs.fsyncSync(fd);
    } catch (err) {
      return { ok: false, reason: 'directory-barrier-failed' };
    } finally {
      if (fd !== undefined) { try { fs.closeSync(fd); } catch (e) { /* best effort */ } }
    }
    return { ok: true, skipped: false };
  });
  if (!locked.ok) return { ok: false, reason: 'lock-timeout' };
  return locked.value;
}

/**
 * Point A's singleton check: scans `rendezvous/role-owners/<coordination_root_id>/`
 * for ANY existing owner file (any role) -- at most one retained supervisor
 * per coordination-root, regardless of which role. Read-only; called BEFORE
 * the execution claim is consumed so a conflict never burns the one-use
 * claim on a request that may simply need to wait for the existing
 * supervisor to exit.
 * @returns {{ok:true,found:false}|{ok:true,found:true,role:string}|{ok:false,reason:string}}
 */
function findExistingRoleOwner(repoDescriptor, coordinationRootId) {
  const dir = path.join(registryRepoDir(repoDescriptor), 'rendezvous', 'role-owners', coordinationRootId);
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    if (err && err.code === 'ENOENT') return { ok: true, found: false };
    return { ok: false, reason: 'existing-owner-scan-failed' };
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    return { ok: true, found: true, role: entry.name.slice(0, -'.json'.length) };
  }
  return { ok: true, found: false };
}

function releaseAllClaimed(claimed) {
  let allOk = true;
  for (const claim of claimed) {
    const release = releaseOwnedRoleOwner(claim.ownerPath, claim.supervisorInstanceId, claim.rendezvousInstanceId, claim.record.role, claim.record.coordination_root_id, claim.record.pid_identity);
    if (!release.ok) allOk = false;
  }
  return allOk;
}

// ── session-run ──

let shuttingDown = false;
let keepAliveHandle = null;
let expiryTimer = null;

/**
 * WP3 item C correction pass R2 (point 2): installed BEFORE the execution
 * claim is consumed (never after), so NO window exists where a signal falls
 * through to Node's default (no-cleanup) termination. `state.phase` is the
 * explicit pre-claim/post-claim/ready tracking this correction requires,
 * consulted here to decide what a signal actually needs to do:
 *
 * - PRE_CLAIM: the claim was never consumed -- it remains valid, and a
 *   FRESH session-run invocation could still legitimately use it. Nothing
 *   was claimed and nothing was terminalized; terminalizing here would
 *   incorrectly foreclose that retry. Exit cleanly with nothing to roll back.
 * - POST_CLAIM / READY: the claim is now PERMANENTLY burned (one-use). Both
 *   release whatever role-owners THIS invocation itself claimed (`claimed`,
 *   the SAME mutable array the acquisition loop pushes into, so a signal
 *   mid-loop rolls back only what was actually claimed) AND terminalize the
 *   WHOLE affected batch (point 2: never leave bindings stuck in
 *   STARTING/REHYDRATING referencing a now-dead action) -- both mandatory,
 *   identical handling for these two phases; `state.phase` stays distinct
 *   in the result envelope purely for observability.
 *
 * Returns the `shutdown` function itself so the owned-expiration timer
 * (point C.6) can invoke the identical path.
 */
function installShutdownHandlers(state, claimed, action) {
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (keepAliveHandle) clearInterval(keepAliveHandle);
    if (expiryTimer) clearTimeout(expiryTimer);

    if (state.phase === 'PRE_CLAIM') {
      const result = {
        schema: 'coordination/bridge-result/v1', command: 'session-run', ok: true,
        action_id: action.action_id, reason: 'pre-claim-shutdown', signal, phase: state.phase,
      };
      process.stdout.write(JSON.stringify(result) + '\n');
      process.exit(RC.OK);
    }

    const cleanupOk = releaseAllClaimed(claimed);
    // Point D.1: EXPIRY terminalizes as a deadline, never the generic
    // 'native-tool-error' every signal was previously hardcoded to -- the
    // SAME reason vocabulary action-failed's own CLI uses, so a caller
    // inspecting the terminalized binding/owner's failure_reason can
    // distinguish "ran out of time" from an operator/external interrupt.
    const termReason = signal === 'EXPIRY' ? 'deadline' : 'native-tool-error';
    const termResult = terminalizeSupervisorStartAction(action, termReason);
    if (!cleanupOk || !termResult.ok) {
      const result = {
        schema: 'coordination/bridge-result/v1', command: 'session-run', ok: false,
        action_id: action.action_id, reason: 'cleanup-failed', signal, phase: state.phase,
      };
      process.stdout.write(JSON.stringify(result) + '\n');
      process.exit(RC.CLEANUP_INTERNAL);
    }
    const result = {
      schema: 'coordination/bridge-result/v1', command: 'session-run', ok: true,
      action_id: action.action_id, reason: 'owned-shutdown', signal, phase: state.phase,
    };
    process.stdout.write(JSON.stringify(result) + '\n');
    process.exit(RC.OK);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  return shutdown;
}

/** Point C.6's "schedule owned expiration": auto-shutdown at session-expiry, even absent an external signal. */
function scheduleOwnedExpiration(shutdown, sessionExpiryMs) {
  const delay = Math.max(0, sessionExpiryMs - Date.now());
  expiryTimer = setTimeout(() => shutdown('EXPIRY'), delay);
}

/** Rejects BEFORE acquisition (or mid-acquisition, rolling back partial claims) -- never reports ok:true, distinguishes an authorization rejection (rc4) from a cleanup-mechanics failure (rc7). */
function rejectAndExit(claimed, reason) {
  const cleanupOk = releaseAllClaimed(claimed);
  if (!cleanupOk) {
    process.stderr.write('[session-run] cleanup failed while rejecting: ' + reason + '\n');
    process.exit(RC.CLEANUP_INTERNAL);
  }
  authError(reason);
}

/**
 * Test-only synchronous pause between role claims. Grants no authority
 * (timing only), so a single `isTestCapability()` gate is enough -- unlike
 * the execution-claim/identity double-gated seams. Lets a bats test send a
 * real SIGTERM during a genuine multi-role acquisition window.
 */
function testAcquisitionDelayMs() {
  if (!isTestCapability()) return 0;
  const raw = process.env.RUNTIME_BRIDGE_CODEX_TEST_ACQUISITION_DELAY_MS;
  const parsed = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/**
 * WP3 item C correction pass R2 (point 2): a REAL, event-loop-yielding
 * delay -- never Atomics.wait, which blocks the event loop and would make a
 * "SIGTERM mid-acquisition" test vacuous. Node's signal delivery is
 * asynchronous via libuv (a normal event-loop callback like a timer), so it
 * literally cannot run while synchronous JS -- including a busy-spin -- is
 * executing; only a genuine await point lets the OS-delivered signal's
 * handler actually fire mid-loop.
 */
function asyncSleep(ms) {
  if (!(ms > 0)) return Promise.resolve();
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

/**
 * Point B: rejection AFTER the execution claim has already been consumed --
 * the claim is one-use and now permanently burned, so simply exiting would
 * leave the affected bindings stuck in STARTING/REHYDRATING referencing an
 * action that can never again be admitted (an "imposible ACTION_REQUIRED").
 * Terminalizes every affected binding via the SAME shared function
 * `action-failed` itself uses, in-process (never shells back out to the
 * CLI), THEN rolls back whatever role-owners this invocation itself
 * claimed. Never reports ok:true; a terminalization/cleanup-mechanics
 * failure is rc7, an ordinary rejection is rc4.
 */
function rejectAndExitAfterClaimConsumed(claimed, action, reason, actionFailedReason) {
  const cleanupOk = releaseAllClaimed(claimed);
  const termResult = terminalizeSupervisorStartAction(action, actionFailedReason || 'native-tool-error');
  if (!cleanupOk || !termResult.ok) {
    process.stderr.write('[session-run] cleanup/terminalization failed while rejecting: ' + reason + '\n');
    process.exit(RC.CLEANUP_INTERNAL);
  }
  authError(reason);
}

/**
 * `session-run --action <32+-hex> --coordination-root <absolute> --role
 * <role> [--role <role>...] --session-expiry <ISO-8601>` (PLAN.md ~L787,
 * ~L889). Foreground supervisor -- see the file header for the full,
 * strictly-ordered validation sequence. C2 replaces the terminal wait with
 * the real app-server child lifecycle.
 * @param {string[]} rawArgv
 */
async function cmdSessionRun(rawArgv) {
  const parsed = parseSessionRunArgv(rawArgv);
  if (!parsed.ok) return usageError(parsed.reason);
  const p = parsed.value;

  const sessionExpiryMs = Date.parse(p.sessionExpiry);
  if (!Number.isFinite(sessionExpiryMs) || Date.now() >= sessionExpiryMs) {
    return authError('session-expiry-invalid-or-past');
  }

  if (p.roles.length === 0 || !p.roles.every((r) => CANONICAL_ROLES.includes(r))) {
    return usageError('role-not-canonical');
  }
  if (new Set(p.roles).size !== p.roles.length) return usageError('duplicate-role');
  if (!arraysEqual(p.roles, p.roles.slice().sort())) return usageError('roles-not-sorted');

  // 1. Point E hard gate: a provably-real process identity is required
  // before ANYTHING else that could consume the claim or write an owner.
  const identityResult = requireProvenProcessIdentity();
  if (!identityResult.ok) return authError(identityResult.reason);
  const pidIdentity = identityResult.pidIdentity;

  // 2. Read-only action revalidation.
  const revalidated = revalidateSupervisorStartAction(p, rawArgv);
  if (!revalidated.ok) return authError(revalidated.reason);
  const { action, coordinationRootReal, projectRoot } = revalidated;
  const repoDescriptor = { repoId: action.repo_id };

  // WP3 item C correction pass R2 (point 2): explicit pre-claim/post-claim/
  // ready state, and shutdown handlers installed HERE -- before the
  // execution claim is consumed, not after -- so no window exists where a
  // signal falls through to Node's default (no-cleanup) termination.
  // `claimed` is declared now (still empty) so the SAME array the
  // acquisition loop later pushes into is already the one the early-
  // installed handler closes over.
  const state = { phase: 'PRE_CLAIM' };
  const claimed = [];
  const shutdown = installShutdownHandlers(state, claimed, action);

  // 3. Read-only binding-state check (point C.8 / E).
  const bindingsOk = validateBindingsPendThisAction(repoDescriptor, action, p.roles);
  if (!bindingsOk.ok) return authError(bindingsOk.reason);

  // 4. Read-only root confinement (point D) -- reuses the EXACT primitive
  // `root-validate` already uses, never a second weaker check.
  try {
    validateRootConfinement(coordinationRootReal);
  } catch (err) {
    return authError('coordination-root-confinement-failed: ' + ((err && err.message) || 'unknown'));
  }

  // 5. Point A singleton pre-check (read-only) -- BEFORE the claim is
  // consumed, so a conflict never burns the one-use claim on a request that
  // may simply need to wait for the existing supervisor to exit.
  const coordinationRootId = computeCoordinationRootId(coordinationRootReal);
  const existingOwner = findExistingRoleOwner(repoDescriptor, coordinationRootId);
  if (!existingOwner.ok) return authError(existingOwner.reason);
  if (existingOwner.found) return authError('singleton-supervisor-already-retained:' + existingOwner.role);

  if (Date.now() >= sessionExpiryMs) return authError('session-expiry-elapsed-before-execution-claim');

  // Test-only real (event-loop-yielding) pause immediately before claim
  // consumption, so a bats test can deterministically deliver a genuine
  // SIGTERM while state.phase is still PRE_CLAIM -- proving that path never
  // terminalizes (the claim remains valid for a fresh retry). Same
  // isTestCapability() single-gate convention as testAcquisitionDelayMs.
  if (isTestCapability()) {
    const raw = process.env.RUNTIME_BRIDGE_CODEX_TEST_PRE_CLAIM_DELAY_MS;
    const delayMs = raw ? parseInt(raw, 10) : NaN;
    if (Number.isFinite(delayMs) && delayMs > 0) await asyncSleep(delayMs);
  }

  // Point D.1: expiry is re-validated immediately after the await above,
  // BEFORE the claim-consuming write below is even attempted -- time spent
  // awaiting can invalidate an earlier snapshot, and a write must never
  // proceed on a stale one. Cheaper AND safer than relying solely on the
  // claim's own downstream expiry check: state is still PRE_CLAIM here, so
  // rejection costs nothing to terminalize (the claim was never touched).
  if (Date.now() >= sessionExpiryMs) {
    return authError('session-expiry-elapsed-before-execution-claim-write');
  }

  // 6. Execution claim -- the FIRST actual write, and the one that proves
  // this action was admitted for execution (point B). EVERY exit from this
  // point onward must terminalize the affected bindings (the claim can
  // never be reused).
  const argvDigest = sha256String(canonicalJSONStringify(action.payload.bridge_argv));
  const claimResult = validateAndConsumeExecutionClaim(repoDescriptor, action, argvDigest, projectRoot);
  if (!claimResult.ok) return authError(claimResult.reason);
  // The claim is now permanently burned -- from here on, ANY exit (signal,
  // deadline, owner conflict, partial failure) must terminalize the whole
  // batch. Flipped BEFORE the deadline re-check below so even that narrow
  // window is covered by the state a concurrent signal would observe.
  state.phase = 'POST_CLAIM';

  if (Date.now() >= sessionExpiryMs) {
    rejectAndExitAfterClaimConsumed([], action, 'session-expiry-elapsed-before-acquisition', 'deadline');
    return;
  }

  // 7. ONE shared identity for this whole process (point C.1/C.7, already
  // proven in step 1), and ordered all-or-nothing role-owner acquisition
  // (point C.3) with shutdown handling already live since BEFORE claim
  // consumption (point 2) so a signal mid-loop rolls back cleanly. A
  // second, race-closing singleton check is implicit in the per-role
  // no-clobber claim itself combined with the earlier pre-check -- a
  // concurrent winner between the pre-check and this loop surfaces as an
  // ordinary (ambiguous-safe) claim failure below, handled via the
  // post-claim-consumed terminalization path.
  const rendezvousInstanceId = crypto.randomBytes(16).toString('hex');
  const supervisorInstanceId = crypto.randomBytes(16).toString('hex');

  for (const role of p.roles) {
    // Test-only synchronous pause BETWEEN claims so a bats test can reliably
    // deliver a REAL SIGTERM mid-acquisition (never a substitute via an
    // owner conflict) -- grants no authority, so a single test-capability
    // gate is sufficient (see testAcquisitionDelayMs).
    if (claimed.length > 0) await asyncSleep(testAcquisitionDelayMs());
    // Point D.1: expiry is re-validated AFTER the await, immediately before
    // the WRITE it guards -- never merely before it. A pre-await snapshot
    // can be invalidated by time spent awaiting; the write must always act
    // on a freshly-rechecked deadline, on every iteration (trivially
    // satisfied on the first, which has nothing to await yet).
    if (Date.now() >= sessionExpiryMs) {
      rejectAndExitAfterClaimConsumed(claimed, action, 'session-expired-during-acquisition', 'deadline');
      return;
    }
    const claim = claimRoleOwner(repoDescriptor, coordinationRootId, role, rendezvousInstanceId, supervisorInstanceId, pidIdentity);
    if (!claim.ok) {
      rejectAndExitAfterClaimConsumed(claimed, action, claim.reason, 'native-tool-error');
      return;
    }
    claimed.push(claim);
  }
  // Fully acquired -- the state VALUE itself distinguishes this from
  // POST_CLAIM purely for observability; shutdown handling treats both
  // identically (see installShutdownHandlers).
  state.phase = 'READY';

  scheduleOwnedExpiration(shutdown, sessionExpiryMs);
  // C1 terminal behavior: block until signaled or expiry fires (no
  // app-server child exists yet to hold the event loop open instead).
  keepAliveHandle = setInterval(() => {}, 1 << 30);
}

// ── main dispatch ──

function main(argv) {
  const subcommand = argv[0];
  const rest = argv.slice(1);
  if (subcommand === 'session-run') return cmdSessionRun(rest);
  if (!subcommand) return usageError('missing subcommand');
  return usageError('unknown subcommand: ' + subcommand);
}

module.exports = {
  parseSessionRunArgv,
  revalidateSupervisorStartAction,
  validateBindingsPendThisAction,
  sessionGenerationIsLive,
  claimRoleOwner,
  releaseOwnedRoleOwner,
  roleOwnerPathFor,
  computeCoordinationRootId,
  defaultProcessIdentityProvider,
  requireProvenProcessIdentity,
  findExistingRoleOwner,
  RC,
};

if (require.main === module) {
  // main() is synchronous for usage/dispatch errors but delegates to the now
  // async cmdSessionRun -- Promise.resolve() uniformly handles either return
  // shape, and .catch() guards against an unhandled rejection ever reaching
  // Node's default (non-zero, unstructured) crash path.
  Promise.resolve(main(process.argv.slice(2))).catch((err) => {
    process.stderr.write('[runtime-bridge-codex] fatal: ' + String((err && err.stack) || err) + '\n');
    process.exit(RC.CLEANUP_INTERNAL);
  });
}
