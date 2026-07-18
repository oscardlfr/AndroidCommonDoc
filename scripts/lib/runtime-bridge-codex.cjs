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
const {
  sha256String, canonicalJSONStringify, realpathOrSelf, validateRootConfinement,
  // WP3 item C2 (R7): single canonical RuntimeTurnEnvelope/v1 source now lives
  // in runtime-consultation.cjs (PLAN.md ~L932) -- this file imports it rather
  // than keeping a second copy (see the re-export at the bottom of this file).
  runtimeTurnEnvelopeSchema, validateRuntimeTurnEnvelope,
} = rc;

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

// ── C2: app-server JSONL client + schemas ──
// PLAN.md "Real RPC surface" ~L67, "App-server worker" ~L887-978,
// "Exact app-server child/RPC contract" ~L901-926, server-request handler
// table ~L957-972 (SR-01..10). Scope: the JSONL wire client itself --
// framing, request/response correlation, initialize handshake, the
// fail-closed server-request table, login correlation, thread/turn
// request-building and response/schema validation. NOT this slice's job:
// wiring into `cmdSessionRun`'s control flow (a later scheduling item) or
// `CredentialBroker/v1` (undesigned; login below takes an injectable
// `refreshProvider`/credential provider, test-only in this repo today).

// R7: an internal safety bound on a single unterminated (no '\n' yet) buffered
// line -- NOT protocol authority, purely an accelerator/OOM guard. A hostile
// or badly-broken transport that never sends a newline must not be allowed to
// grow `buffer` without limit.
const MAX_JSONL_FRAME_BYTES = 4 * 1024 * 1024;

/**
 * Incrementally feeds raw bytes, splitting on '\n' and JSON-parsing each
 * complete line as exactly one plain object -- never an array/string/
 * number/boolean/null, and never carrying an invented `jsonrpc` member
 * (PLAN.md ~L903: "app-server frames are {id,method,params} / {id,result|
 * error} with no invented jsonrpc member"). A malformed line reports
 * onError and is skipped; it does not corrupt buffering of subsequent
 * lines (the caller's own protocol-phase logic decides whether continuing
 * after a malformed frame is safe). A blank line is tolerated silently
 * (neither a frame nor an error) -- some writers emit a stray one.
 *
 * R9: uses `TextDecoder('utf-8', {fatal:true})` decoded incrementally (not
 * `chunk.toString('utf8')`, and no longer `StringDecoder`) so a multi-byte
 * UTF-8 character split across two chunk boundaries decodes correctly, AND a
 * genuinely invalid byte sequence throws synchronously instead of silently
 * substituting U+FFFD (which was ambiguous with a legitimately-encoded
 * U+FFFD already present in a valid payload -- Codex NO-GO P2). Accepts an
 * optional `shouldStop()` predicate, checked before each line is parsed --
 * once true (the caller's connection has begun terminal STOP), no further
 * buffered line in the SAME chunk is parsed or dispatched, even if several
 * arrived together (A1: a malformed frame must STOP delivery of anything
 * queued behind it in the same read). An unterminated partial line that
 * exceeds `MAX_JSONL_FRAME_BYTES` is reported via onError and the buffer is
 * dropped (never retained) -- a safety bound, not protocol authority.
 * @param {(frame: object) => void} onFrame
 * @param {(reason: string, rawLine: string|null) => void} onError
 * @param {() => boolean} [shouldStop]
 * @returns {(chunk: Buffer|string) => void}
 */
function createJsonlFrameFeeder(onFrame, onError, shouldStop) {
  // R9 (Codex NO-GO P2): `StringDecoder` + "does the decoded string contain
  // U+FFFD" was ambiguous by construction -- a REPLACEMENT CHARACTER is also
  // a perfectly legitimate Unicode code point a genuine payload can contain
  // (its own valid UTF-8 encoding is the 3 bytes EF BF BD), and that case is
  // indistinguishable from StringDecoder's OWN substitution for a genuinely
  // invalid byte sequence by inspecting the OUTPUT alone. `TextDecoder('utf-8',
  // {fatal:true})` decoded incrementally via `{stream:true}` is the correct
  // tool: it throws SYNCHRONOUSLY on a truly invalid byte sequence, while
  // still correctly buffering a not-yet-complete multi-byte sequence split
  // across chunk boundaries (stream:true) and correctly ACCEPTING a
  // legitimately-encoded U+FFFD without ever raising it as an error.
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '';
  let poisoned = false; // R8: this feeder's OWN permanent fail-closed latch -- independent of an external `shouldStop`, so a standalone/unit-tested feeder (no wrapping connection) still never "recovers" after a fatal condition.
  return function feed(chunk) {
    if (poisoned || (shouldStop && shouldStop())) return;
    let decoded;
    if (Buffer.isBuffer(chunk)) {
      try {
        decoded = decoder.decode(chunk, { stream: true });
      } catch (err) {
        poisoned = true;
        buffer = '';
        onError('invalid-utf8-encoding', null);
        return;
      }
    } else {
      decoded = chunk;
    }
    buffer += decoded;
    let idx;
    while ((idx = buffer.indexOf('\n')) !== -1) {
      if (poisoned || (shouldStop && shouldStop())) { buffer = ''; return; }
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      if (line.length === 0) continue;
      // R8 (item 10): the 4MiB safety bound must apply to a COMPLETE line
      // too, not merely an unterminated leftover -- a single overlong
      // complete line used to be parsed regardless of size.
      if (Buffer.byteLength(line, 'utf8') > MAX_JSONL_FRAME_BYTES) {
        poisoned = true;
        buffer = '';
        onError('frame-too-large-complete-line', null);
        return;
      }
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch (err) {
        onError('malformed-json', line);
        continue;
      }
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        onError('frame-not-object', line);
        continue;
      }
      if (Object.prototype.hasOwnProperty.call(parsed, 'jsonrpc')) {
        onError('frame-has-invented-jsonrpc-member', line);
        continue;
      }
      onFrame(parsed);
    }
    if (buffer.length > 0 && Buffer.byteLength(buffer, 'utf8') > MAX_JSONL_FRAME_BYTES) {
      poisoned = true;
      buffer = '';
      onError('frame-too-large-no-newline', null);
    }
  };
}

/**
 * Writes exactly one canonical JSON object + one trailing '\n' as a single
 * write() call. No shape validation -- callers construct exact frames.
 * `onFlushed(err)`, when supplied, is Node's own write-completion callback
 * (fires once the chunk is fully flushed to the underlying transport, or
 * with an Error if the write itself failed) -- this is the mechanism used
 * to distinguish "confirmed-before-commit" (the write itself failed) from
 * "possibly-delivered" (the write flushed; anything after that is
 * ambiguous until a response/EOF/timeout resolves it), per PLAN.md ~L934
 * ("Once the line is fully flushed... is ambiguous/possibly-delivered").
 * A synchronous throw from `.write()` itself (rare, but not impossible for
 * a hostile/broken transport) is also routed through `onFlushed`, never
 * left to propagate and crash the caller.
 */
function writeJsonlFrame(writable, obj, onFlushed) {
  const line = JSON.stringify(obj) + '\n';
  try {
    writable.write(line, 'utf8', onFlushed);
  } catch (err) {
    if (typeof onFlushed === 'function') onFlushed(err);
  }
}

// Fixed, frozen server-request response rows (PLAN.md ~L961-972, SR-02..
// SR-10). SR-01 (account/chatgptAuthTokens/refresh) is handled separately
// below via the caller-supplied refreshProvider -- it is the sole row that
// may continue the connection rather than STOP.
const SERVER_REQUEST_FIXED_ROWS = Object.freeze({
  applyPatchApproval: Object.freeze({ result: Object.freeze({ decision: 'denied' }) }),
  'attestation/generate': Object.freeze({ error: Object.freeze({ code: -32601, message: 'non-interactive bridge issues no attestation' }) }),
  execCommandApproval: Object.freeze({ result: Object.freeze({ decision: 'denied' }) }),
  'item/commandExecution/requestApproval': Object.freeze({ result: Object.freeze({ decision: 'decline' }) }),
  'item/fileChange/requestApproval': Object.freeze({ result: Object.freeze({ decision: 'decline' }) }),
  'item/permissions/requestApproval': Object.freeze({ result: Object.freeze({ permissions: {} }) }),
  'item/tool/call': Object.freeze({ result: Object.freeze({ contentItems: [], success: false }) }),
  'item/tool/requestUserInput': Object.freeze({ result: Object.freeze({ answers: {} }) }),
  'mcpServer/elicitation/request': Object.freeze({ result: Object.freeze({ action: 'decline' }) }),
});

const SERVER_REQUEST_UNKNOWN_METHOD_ERROR = Object.freeze({ code: -32601, message: 'unknown method' });
// PLAN.md specifies "error+STOP" for a failed refresh but does not freeze
// an exact code/message for that row (unlike SR-03's literal -32601) --
// documented interpretive choice, not a PLAN-literal mapping (mirrors the
// RC table's own "documented interpretive choice" precedent above).
const SERVER_REQUEST_REFRESH_FAILED_ERROR = Object.freeze({ code: -32000, message: 'account-refresh-unavailable' });
// R8 (item 8): a distinct error for a server-request whose params fail
// method-specific validation -- reuses JSON-RPC's own numeric "Invalid
// params" convention (-32602) purely as a familiar code, not a claim that
// this transport IS JSON-RPC 2.0 (PLAN.md ~L903 is explicit it is not).
const SERVER_REQUEST_INVALID_PARAMS_ERROR = Object.freeze({ code: -32602, message: 'invalid params' });

const DEFAULT_RPC_TIMEOUT_MS = 10000; // PLAN.md ~L932's literal control-plane response window default.
// R14 (turn-id replay fence, PLAN.md "Turn Lifecycle State Machine"): a
// bounded, per-thread-lifetime cap on retired turn ids this connection will
// remember for replay detection. FROZEN, host-owned -- no project/operator
// configuration surface exists for this value in production (the R14 spike's
// own reduced-cap test seam, gated behind an exact test-only token, is
// deliberately NOT ported here -- see turn-state-model.cjs's own comment on
// why that seam must never become a public string-based production override).
const MAX_RETIRED_TURN_IDS_PER_THREAD = 4096;

/**
 * R8 (item 8): method-specific params validators for SR-01..SR-10
 * (prep/phase-a/codex-schema/ts-run1/{,v2/}*Params.ts) -- previously only
 * checked that `params` was A plain object, regardless of method. Every
 * validator closes REQUIRED keys via `hasExactKeys`/`hasOnlyAllowedKeys`
 * (the latter where the real type has optional `?` fields) and type-checks
 * every field.
 *
 * R10 (Codex NO-GO P1-3): the R8/R9 passes left several ARRAY/nested-value
 * fields checked only at the container level (`Array.isArray(...)`, "is an
 * object") -- `command:[42]`, `parsedCmd:[42]`, `questions:[42]`,
 * `commandActions:[42]`, `fileChanges:{"/x":42}`, and a float `startedAtMs`
 * (e.g. `1.5`) all passed as "valid" despite the real pinned schema
 * requiring string array elements / real nested-object shapes / an integer.
 * `FileChange`/`ParsedCommand`/`CommandAction`/`ToolRequestUserInputQuestion`
 * are now validated per-element via the helpers below (each a small closed
 * `oneOf`/required-fields check, matching `isSchemaValidThreadItem`'s own
 * per-variant style). Deeply-nested reference types NEITHER this client NOR
 * any of the structures above ever interprets (NetworkApprovalContext,
 * ExecPolicyAmendment, NetworkPolicyAmendment, McpElicitationPrimitiveSchema,
 * JsonValue) remain a coarse type check only -- a narrower, honestly-scoped
 * proportionality boundary than before.
 */
/**
 * WP3 (second capability-pin remint + C2 design addendum): every validator
 * below is now a thin wrapper over the tracked generated schema-validator
 * bundle (scripts/lib/schema/c2-schema-bundle.json + scripts/tools/
 * generate-c2-schema-validators.cjs + scripts/lib/generated/
 * c2-schema-validators.generated.cjs -- PLAN.md "C2 Schema Validator
 * Bundle", R14 design authority). Function names/call-site shape are
 * unchanged from the R7-R10 hand-transcribed originals (preserved in git
 * history) so every caller below is untouched; only each function's OWN
 * body now delegates to the generated, Ajv-compiled validator instead of
 * re-deriving the shape by hand. `generated` has zero dependency on Ajv/
 * mcp-server/node_modules/.planning at runtime (build/test-time only).
 */
const generated = require('./generated/c2-schema-validators.generated.cjs');

/** `FileChange` (json-run2 `definitions.FileChange`): `oneOf` add/delete (both `{content:string,type}`) or update (`{type,unified_diff:string,move_path?}`). */
function isValidFileChange(fc) {
  return generated.definitions.FileChange(fc);
}
/** `ParsedCommand` (json-run2 `definitions.ParsedCommand`): `oneOf` read/list_files/search/unknown, each requiring at least `cmd,type`. */
function isValidParsedCommand(pc) {
  return generated.definitions.ParsedCommand(pc);
}
/** `CommandAction` (json-run2 `definitions.CommandAction`): structurally identical shape to ParsedCommand, `command`/`type`-keyed instead of `cmd`/`type`. */
function isValidCommandAction(ca) {
  return generated.definitions.CommandAction(ca);
}
/** `ToolRequestUserInputQuestion` (json-run2 `definitions.ToolRequestUserInputQuestion`): required `header,id,question` all strings; `isOther`/`isSecret` optional booleans, `options` optional array|null. */
function isValidToolRequestUserInputQuestion(q) {
  return generated.definitions.ToolRequestUserInputQuestion(q);
}
function isValidChatgptAuthTokensRefreshParams(p) {
  return generated.roots['base::ChatgptAuthTokensRefreshParams'](p);
}
function isValidApplyPatchApprovalParams(p) {
  return generated.roots['base::ApplyPatchApprovalParams'](p);
}
function isValidAttestationGenerateParams(p) {
  return generated.roots['base::AttestationGenerateParams'](p); // Record<string, never> -- must be exactly {}.
}
function isValidExecCommandApprovalParams(p) {
  return generated.roots['base::ExecCommandApprovalParams'](p);
}
function isValidCommandExecutionRequestApprovalParams(p) {
  return generated.roots['base::CommandExecutionRequestApprovalParams'](p);
}
function isValidFileChangeRequestApprovalParams(p) {
  return generated.roots['base::FileChangeRequestApprovalParams'](p);
}
function isValidPermissionsRequestApprovalParams(p) {
  return generated.roots['base::PermissionsRequestApprovalParams'](p);
}
function isValidDynamicToolCallParams(p) {
  return generated.roots['base::DynamicToolCallParams'](p); // `arguments` is JsonValue -- any already-parsed JSON value is legal.
}
function isValidToolRequestUserInputParams(p) {
  return generated.roots['base::ToolRequestUserInputParams'](p);
}
function isValidMcpServerElicitationRequestParams(p) {
  return generated.roots['base::McpServerElicitationRequestParams'](p);
}
const SERVER_REQUEST_PARAMS_VALIDATORS = Object.freeze({
  applyPatchApproval: isValidApplyPatchApprovalParams,
  'attestation/generate': isValidAttestationGenerateParams,
  execCommandApproval: isValidExecCommandApprovalParams,
  'item/commandExecution/requestApproval': isValidCommandExecutionRequestApprovalParams,
  'item/fileChange/requestApproval': isValidFileChangeRequestApprovalParams,
  'item/permissions/requestApproval': isValidPermissionsRequestApprovalParams,
  'item/tool/call': isValidDynamicToolCallParams,
  'item/tool/requestUserInput': isValidToolRequestUserInputParams,
  'mcpServer/elicitation/request': isValidMcpServerElicitationRequestParams,
});

// R7: real generated enums (prep/phase-a/codex-schema/ts-run1/{AuthMode,
// PlanType,v2/TurnStatus,v2/TurnItemsView,MessagePhase}.ts) -- validated
// against membership, not merely "is a string", so a value outside the
// live schema's own universe is distinguished from one that is merely the
// wrong (but real) enum member.
const AUTH_MODE_VALUES = Object.freeze(['apikey', 'chatgpt', 'chatgptAuthTokens', 'headers', 'agentIdentity', 'personalAccessToken', 'bedrockApiKey']);
const PLAN_TYPE_VALUES = Object.freeze(['free', 'go', 'plus', 'pro', 'prolite', 'team', 'self_serve_business_usage_based', 'business', 'enterprise_cbp_usage_based', 'enterprise', 'edu', 'unknown']);
// R14 (Codex NO-GO, Bloque B): the field-level key-set/type checks that
// used to live here (THREAD_START_RESPONSE_KEYS/REQUIRED_KEYS, THREAD_KEYS/
// REQUIRED_KEYS, hasAllRequiredKeys) are removed -- they duplicated exactly
// what the generated `v2::ThreadStartResponse`/`v2::ThreadResumeResponse`
// validators now prove as the FIRST choke point in
// validateThreadStartLikeResponse, and (reproduced empirically) had gaps
// the generated validator does not: e.g. `thread.createdAt: 1.5` passed the
// old `typeof x === 'number'` check but is correctly rejected by the real
// schema's integer typing.

/**
 * R9 (Codex NO-GO on R8's ThreadItem validation): faithful per-variant
 * validation against the REAL pinned JSON Schema
 * (prep/phase-a/codex-schema/json-run2/codex_app_server_protocol.v2.schemas.json
 * `definitions.ThreadItem`'s 17-way `oneOf`), not merely "is `type` one of
 * the known strings" (the R8 pass's `isKnownThreadItemVariant`, which let
 * an item missing every OTHER required field through as long as `type` was
 * spelled correctly -- exactly what the audit exploited). Each variant's
 * OWN `required` array from the real schema is checked exactly; a field
 * carrying a JSON Schema `default` (e.g. agentMessage's `memoryCitation`/
 * `phase`, reasoning's `content`/`summary`) is genuinely OPTIONAL, never
 * forced obligatory just because the ts-rs `.ts` type spells it without
 * `?`. Deeply-nested $ref types this bridge never itself interprets
 * (CommandAction, FileUpdateChange, McpToolCallResult, WebSearchAction,
 * CollabAgentState, McpToolCallAppContext, etc.) get a coarse
 * correct-JS-container-type check only -- a narrower, honestly-scoped
 * proportionality boundary than R8's: every variant's OWN required fields
 * are now checked; only THEIR nested reference types stop at "correct JS
 * type", never at "type string alone".
 */
function isSchemaValidThreadItem(it) {
  return generated.definitions.ThreadItem(it);
}

/** `MemoryCitationEntry` (json-run2 `definitions.MemoryCitationEntry`): required `lineEnd,lineStart,note,path`, the two line numbers non-negative integers. */
function isValidMemoryCitationEntry(e) {
  return generated.definitions.MemoryCitationEntry(e);
}

/** `MemoryCitation` (json-run2 `definitions.MemoryCitation`): required `entries,threadIds`. */
function isValidMemoryCitation(mc) {
  return generated.definitions.MemoryCitation(mc);
}

/** Full closed-shape validation of one `agentMessage` ThreadItem (json-run2 `ThreadItem`'s agentMessage variant). Guards `type==='agentMessage'` itself (the generated ThreadItem validator accepts ANY valid variant, not only this one) before delegating shape validation to the generated bundle. */
function isValidAgentMessageItem(it) {
  return !!it && typeof it === 'object' && it.type === 'agentMessage' && generated.definitions.ThreadItem(it);
}

/**
 * A `Turn` (json-run2 `definitions.Turn`, used identically by
 * `TurnStartResponse.turn`, `TurnStartedNotification.turn`,
 * `TurnCompletedNotification.turn`, and `Thread.turns[]`): required
 * `id,items,status` exactly -- `itemsView` carries `default: "full"` and is
 * genuinely OPTIONAL (R9 correction: the R8 pass's `isSchemaValidPersistedTurn`
 * wrongly required it present), `error`/`startedAt`/`completedAt`/
 * `durationMs` are deliberately not required present here -- this client
 * never reads them for ANY Turn it validates (only the active turn's own
 * `turn/completed` items are acted on), a narrower, honest proportionality
 * choice than requiring fields nothing ever consumes.
 */
function isSchemaValidTurn(t) {
  return generated.definitions.Turn(t);
}

/**
 * `SubAgentSource` (json-run2 `definitions.SubAgentSource`): a `oneOf` of
 * the closed 3-member string enum above, OR exactly
 * `{thread_spawn: {depth: integer, parent_thread_id: string, ...optionals}}`,
 * OR exactly `{other: string}`. R10 (Codex NO-GO on R9's OWN "full schema
 * fidelity" claim): R9's coarse "is an object" check both wrongly ACCEPTED
 * `{subAgent:{}}` (matches neither object variant -- both have their own
 * `required`) and wrongly REJECTED the valid string variant
 * `{subAgent:"review"}`.
 */
function isValidSubAgentSource(v) {
  return generated.definitions.SubAgentSource(v);
}

/**
 * `SessionSource` (json-run2 `definitions.SessionSource`): a `oneOf` of the
 * closed 5-member string enum above, OR exactly `{custom: string}`, OR
 * exactly `{subAgent: SubAgentSource}`, now faithfully validated via
 * `isValidSubAgentSource` above (R10 correction of R9's coarse stand-in).
 */
function isValidSessionSource(v) {
  return generated.definitions.SessionSource(v);
}

/**
 * Correctness note (R5 correction, this revision): the response/
 * notification shapes below were rebuilt against the ACTUAL generated
 * schemas (`prep/phase-a/codex-schema/ts-run1/{v2/ThreadStartResponse,v2/
 * TurnStartResponse,v2/TurnCompletedNotification,v2/Thread,v2/Turn,
 * InitializeResponse,v2/LoginAccountResponse,v2/AccountUpdatedNotification,
 * AuthMode,PlanType}.ts`, re-confirmed against a fresh live regeneration
 * this session -- not inferred from PLAN.md's prose description of WHICH
 * fields to check without verifying WHERE they live. `ThreadStartResponse`/
 * `ThreadResumeResponse` nest the thread id/ephemeral/turns fields inside a
 * `thread: Thread` object, never flat `threadId`/`ephemeral`/`turns` at the
 * response's own top level; `TurnStartResponse` is exactly `{turn: Turn}`;
 * `TurnCompletedNotification` is exactly `{threadId, turn: Turn}`, never a
 * flat `{threadId,turnId,status,items}`. This was the R4-pass session's own
 * bug (adversarial audit NO-GO), fixed here test-first against the real
 * shapes, not merely against PLAN's abstract validation-predicate prose.
 *
 * R7 stabilization (this revision) rebuilds `createAppServerConnection`
 * around an explicit, closed connection phase machine (`NEW -> INITIALIZED
 * -> AUTHENTICATED -> STOPPING -> STOPPED`, PLAN.md ~L899/~L934), a single
 * idempotent terminal-STOP primitive that actually gates every subsequent
 * write/pending-registration/frame-dispatch (the R5 revision's `stopped`
 * flag was observable via `isStopped()` but nothing internal actually
 * consulted it before continuing to process buffered frames or accept new
 * calls), a single deadline-aware request primitive (`min(10s,
 * backend_deadline-now)`, PLAN.md ~L934), and (R14 consolidation) a single
 * thread/turn lifecycle record (`threadLifecycleState`/`activeThreadId`/
 * `currentTurn`) so `turn/start` genuinely enforces "known, active thread"
 * and "at most one turn in flight per thread" rather than accepting any
 * caller-supplied ID.
 */

/**
 * Creates a bidirectional app-server JSONL connection over the given
 * transport. `transport` is `{stdin: Writable, stdout: Readable}` -- either
 * a real ChildProcess's stdio pair or a test fake (e.g. a `stream.
 * PassThrough` pair). Owns frame ID allocation, request/response
 * correlation, and fail-closed handling of the 10 live-observed
 * server-initiated requests (PLAN.md ~L957 "Server-request handler
 * (fail-closed)"). `refreshProvider`, when supplied, is called
 * synchronously for `account/chatgptAuthTokens/refresh` and must return
 * `{ok:true,accessToken,chatgptAccountId,chatgptPlanType}` or `{ok:false}`
 * -- production wires this to `CredentialBroker/v1` (not yet built); tests
 * inject an explicit fake. Absent, refresh fails closed.
 *
 * Fail-closed transport contract (R5 correction, this revision): a
 * malformed frame, a `stdout` `'end'`/`'error'` event, or a failed/thrown
 * `stdin.write()` all mark the connection STOPped and settle every
 * currently-pending call with a distinct failure reason -- nothing is ever
 * left hanging indefinitely, and a corrupted/desynced transport is never
 * silently trusted to keep framing correctly afterward. Every request
 * registers its pending entry BEFORE the write that could (for a
 * synchronous fake transport) trigger an immediate response -- the
 * opposite order previously left a genuinely-synchronous echo unmatched.
 * @param {{stdin:object, stdout:object, refreshProvider?:Function}} opts
 */
function createAppServerConnection(opts) {
  const { stdin, stdout, refreshProvider } = opts;
  let nextId = 1;
  const pending = new Map(); // id -> {finish(result)}

  // ── R7: explicit closed connection phase machine (PLAN.md ~L899/~L934) ──
  // NEW -> INITIALIZED -> AUTHENTICATED -> STOPPING -> STOPPED. STOPPING is a
  // brief, no-authority-but-not-yet-fully-torn-down window used ONLY by the
  // server-request reply path (A6: "entra primero en estado STOPPING/
  // no-authority, acredita el flush de la respuesta exacta, después pasa a
  // STOPPED") -- every other STOP trigger (malformed frame, EOF, transport
  // error, a failed write, a validation failure) has no in-flight reply to
  // finish and goes straight to STOPPED via `terminalStop`.
  let phase = 'NEW';
  let stopReason = null;
  let initializeCalled = false;
  let loginCalled = false;
  let authenticatedIdentity = null; // {chatgptAccountId,chatgptPlanType} once login() succeeds -- SR-01's own cross-check identity (D4).
  // R10 (Codex NO-GO on R9's OWN refresh hardening): a single shared
  // boolean (`refreshFlushPending`) plus a single shared `currentAccessToken`
  // could not survive TWO concurrent refresh attempts -- the first
  // attempt's callback cleared the boolean/updated the token EVEN THOUGH a
  // second, independently-processed refresh was still in flight (two
  // providers invoked, two responses emitted), and the "same token" check
  // ran at REQUEST time against a value that could be stale by COMMIT time
  // (a genuine TOCTOU race). Replaced with a single exclusive epoch: at
  // most ONE refresh may ever be in flight; a second SR-01 while one is
  // active is a protocol violation (STOP), never processed concurrently.
  const usedAccessTokens = new Set(); // every accessToken this connection has EVER been authenticated with (login + every CONFIRMED refresh) -- rejects A->B->A rollback, not merely "differs from the single most-recent one".
  let refreshEpoch = 0; // monotonically increasing; each refresh attempt gets its own number.
  let activeRefreshEpoch = null; // null = no refresh in flight; otherwise the epoch number of the one currently in flight -- a stale callback from a NO-LONGER-active epoch checks this and no-ops.
  function isRefreshing() { return activeRefreshEpoch !== null; }

  // ── R14 (post-NO-GO consolidation, Bloque A): ONE authoritative per- ──
  // connection thread/turn lifecycle record. Codex's adversarial audit
  // correctly identified that the PRIOR design -- authority scattered
  // across six independent structures (threadsKnown, threadTurnInFlight,
  // turnCompletionHandlers, pendingCompletions, deferredCompletionsDuringRefresh,
  // retiredTurnIds) -- allowed contradictory partial views: nothing
  // prevented two concurrently-active threads; flushDeferredCompletions()
  // invoked the handler directly, bypassing the turn-id-retirement
  // transition; and delivery only ever required completion+handler, never
  // turnStart's OWN response, letting a completion "deliver" before its
  // originating turn/start RPC had even settled. This block mirrors
  // r11-spike/turn-state-model.cjs's TurnStateMachine class -- adapted to
  // the real wire protocol (RPC dispatch/response the pure model doesn't
  // have) -- as the SINGLE source of truth; every function below reads and
  // mutates ONLY this record, never a second parallel structure.
  let threadLifecycleState = 'IDLE'; // 'IDLE' | 'THREAD_START_PENDING' | 'THREAD_RESUME_PENDING' | 'ACTIVE' -- at most one active root-chain thread (PLAN.md "App-server worker").
  let activeThreadId = null; // non-null only while threadLifecycleState === 'ACTIVE'.
  let pendingThreadId = null; // the id a dispatched thread/resume expects to see correlated back; null otherwise (thread/start doesn't know its id until the response names it).
  let lastArchivedThreadId = null; // collision guard: the server reusing an id this connection already told it to retire is a STOP, never a silent identity reuse.
  // The ONE current-turn record for activeThreadId, or null. Shape:
  //   { turnId: string|null, responseObserved: bool, completion: object|null,
  //     handlerEntry: {expectedResultKind,allowedChildRoles,handler}|null,
  //     startedObserved: bool, refreshDeferralEpoch: number|null,
  //     state: 'IN_PROGRESS' | 'DEFERRED_FOR_REFRESH' | 'DELIVERED' }
  // Delivery/deferral fires only once responseObserved && completion!==null
  // && handlerEntry!==null are ALL true (turnResponse/completion/
  // registerHandler are orthogonal prerequisites of this SAME record; any
  // of the three may be the one that completes the set) -- see
  // tryDeliverCurrentTurn(), the single transition every one of those three
  // paths (and the refresh-confirm path) funnels through.
  let currentTurn = null;
  const retiredTurnIds = new Set(); // every turn id fully delivered on activeThreadId's CURRENT lifetime; reset whenever a new thread activates or on archive/STOP. Only one active thread now, so this is a plain per-connection Set, not a Map.

  /** R14: records `turnId` as retired, enforcing the frozen cap. Returns false (having already called terminalStop internally) if the cap is exhausted -- callers must check isTerminal()/the return value afterward rather than assuming success. */
  function retireTurnId(turnId) {
    if (retiredTurnIds.size >= MAX_RETIRED_TURN_IDS_PER_THREAD) {
      terminalStop('retired-turn-id-registry-exhausted');
      return false;
    }
    retiredTurnIds.add(turnId);
    return true;
  }
  /** R14: true iff `turnId` has already been retired on the active thread's current lifetime -- binding a NEW turn to a retired id is a replay, never a legitimate reuse. */
  function isRetiredTurnId(turnId) {
    return retiredTurnIds.has(turnId);
  }
  /**
   * True iff `currentTurn` exists and has reached its one authoritative
   * delivery -- safe to start a genuinely NEW turn on this thread. Mirrors
   * turn-state-model.cjs's `_turnIsSafelyTerminal()`.
   *
   * R14 (Codex NO-GO 2026-07-18, Bloque A2): deliberately EXCLUDES
   * `INTERRUPTED` -- an interrupted turn is terminal enough to ARCHIVE from
   * (see `isCurrentTurnSafeToArchive` below) but PLAN.md's own
   * closure/recovery contract requires the thread to actually be archived
   * (and a fresh thread/turn cycle started) before any new turn may begin;
   * a bare `turnStart()` immediately after an interrupt must still be
   * refused as "already in flight," forcing the caller through archive.
   */
  function isCurrentTurnSafelyTerminal() {
    return currentTurn === null || (currentTurn.state === 'DELIVERED' && currentTurn.responseObserved === true && currentTurn.refreshDeferralEpoch === null);
  }
  /**
   * R14 (Codex NO-GO 2026-07-18, Bloque A2): the WIDER predicate used only by
   * `threadArchive` -- a genuinely `INTERRUPTED` turn (terminal, its id
   * already retired) is ALSO safe to archive from, in addition to every
   * `isCurrentTurnSafelyTerminal()` case. Deliberately NOT used by
   * `turnStart` (see that function's own docstring above).
   */
  function isCurrentTurnSafeToArchive() {
    return isCurrentTurnSafelyTerminal() || (currentTurn !== null && currentTurn.state === 'INTERRUPTED');
  }
  /** Binds `turnId` to the current turn's own id the FIRST time it's seen, or verifies an exact match thereafter. Rejects (without binding) a fresh id that replays an already-retired one. Never called once `currentTurn` is null. */
  function bindOrVerifyCurrentTurnId(turnId) {
    if (currentTurn.turnId === null) {
      if (isRetiredTurnId(turnId)) return { ok: false, retiredReplay: true };
      currentTurn.turnId = turnId;
      return { ok: true };
    }
    if (currentTurn.turnId !== turnId) return { ok: false };
    return { ok: true };
  }

  function isTerminal() { return phase === 'STOPPING' || phase === 'STOPPED'; }

  /** Settles every currently-pending call with `reason` and clears the map -- used on malformed frame / transport EOF / transport error / full teardown, never leaving a caller hanging. */
  function failAllPending(reason) {
    const waiters = Array.from(pending.values());
    pending.clear();
    for (const w of waiters) w.finish({ ok: false, reason });
  }

  /** Idempotent: first reason wins, phase only ever moves forward. Does NOT yet fail pending calls -- see finalizeStop. */
  function beginStop(reason) {
    if (isTerminal()) return;
    stopReason = reason;
    phase = 'STOPPING';
  }

  /**
   * Idempotent terminal teardown: settles all pending calls, drops all
   * notification handlers and turn-completion registrations, and frees
   * per-thread/turn tracking (E3 "no crecen sin límite; se limpian en
   * archive y STOP"). `pendingReason` lets a caller give currently-pending
   * calls a MORE SPECIFIC rejection reason (e.g. "...-possibly-delivered")
   * than the connection's own diagnostic `stopReason` (queried via
   * `stopReason()`) -- these are deliberately two different strings for
   * transport EOF/error (PLAN.md ~L934's commit-point language is about the
   * CALL's own outcome, not the connection's diagnostic label).
   */
  function finalizeStop(pendingReason) {
    if (phase === 'STOPPED') return;
    phase = 'STOPPED';
    failAllPending(typeof pendingReason === 'string' ? pendingReason : stopReason);
    notificationHandlers.clear();
    activeRefreshEpoch = null; // R10: harmless once terminal (isTerminal() already gates every dispatch), but keeps state tidy; also drops any stale epoch a late callback might still reference.
    // R14 (Bloque A): STOP clears ALL lifecycle authority -- the single
    // consolidated record, not several independent structures.
    threadLifecycleState = 'IDLE';
    activeThreadId = null;
    pendingThreadId = null;
    lastArchivedThreadId = null;
    currentTurn = null;
    retiredTurnIds.clear();
  }

  /** The single terminal-STOP primitive for every trigger EXCEPT the server-request reply path (which needs the STOPPING window to finish its own flush first -- see handleServerRequest). */
  function terminalStop(reason, pendingReason) {
    beginStop(reason);
    finalizeStop(pendingReason);
  }

  /**
   * R10 (Codex NO-GO P2, Block D): every server-request negative-path reply
   * used to finalize ONLY from `writeJsonlFrame`'s own completion callback --
   * `beginStop` had already run, so `phase` was 'STOPPING', but if that
   * callback never fires (a hung/broken stdin the transport itself never
   * surfaces as an error or close event), `finalizeStop` never runs either:
   * `failAllPending` never runs, so any OTHER concurrently pending call
   * (e.g. an unrelated dispatchRequest already in flight) hangs
   * indefinitely too, and `phase` never reaches 'STOPPED'. A bounded
   * timeout now races the real write callback -- settle-once, same pattern
   * as the refresh flush timer below.
   */
  function writeThenFinalizeStop(frame) {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      finalizeStop();
    }, DEFAULT_RPC_TIMEOUT_MS);
    writeJsonlFrame(stdin, frame, () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      finalizeStop();
    });
  }

  function allocateId() { return nextId++; }

  /**
   * The single request-dispatch primitive (Preferencias §5): checks
   * terminal state, registers `pending` BEFORE the write (fixes the
   * synchronous-echo race), computes `min(explicitTimeoutMs,
   * backendDeadlineMs-now)` when a deadline is supplied and refuses to write
   * at all when that window is non-positive (PLAN.md ~L934), and tracks
   * write-flush success separately from response arrival (commit-point
   * distinction) via Node's own per-write completion callback. Callers that
   * need the id BEFORE the write (e.g. turn/start's thread binding, C5)
   * call `allocateId()` themselves and pass it in.
   * @param {number} id
   * @param {string} method
   * @param {object} params
   * @param {{timeoutMs?:number, backendDeadlineMs?:number}} [reqOpts]
   */
  /**
   * R9 (post-P0-3 hardening): the three reasons `dispatchRequest` may
   * refuse to even START a call, extracted so a CALLER that must commit its
   * own bookkeeping state BEFORE dispatching (turnStart's `currentTurn`
   * bind, C5 "bound BEFORE the write") can check this FIRST and skip that
   * commit entirely on rejection -- otherwise a non-terminal, retriable
   * refusal (refresh-flush-pending) would leave the caller's own state
   * PERMANENTLY marking a request in flight that was never actually sent,
   * with no response ever coming to eventually clear it (a genuine bug this
   * exact session's own P0-3 fix introduced and this extraction closes).
   * Returns `{ok:true, timeoutMs}` or `{ok:false, reason}`.
   */
  function computeDispatchWindow(reqOpts) {
    reqOpts = reqOpts || {};
    if (isTerminal()) return { ok: false, reason: 'connection-stopped' };
    // R9 (P0-3): while a just-succeeded refresh's own reply flush is still
    // unconfirmed, the connection is deliberately NON-AUTHORITATIVE for
    // every OTHER RPC -- "ninguna nueva RPC puede salir hasta callback
    // exitoso". This is a soft, retriable refusal (not a STOP): the caller
    // may simply try again once the flush confirms.
    if (isRefreshing()) return { ok: false, reason: 'refresh-flush-pending' };
    // R9 (Codex NO-GO P1-4): PLAN.md's "within 10 seconds" is a HARD CEILING
    // on this client's own patience, not merely a fallback DEFAULT used only
    // when the caller specifies nothing -- the R8 pass's `explicitTimeoutMs`
    // let a caller-requested `timeoutMs` of e.g. 60000 sail straight past
    // it. The real formula is min(10000, requested, backendDeadline-now),
    // every term optional except the 10000 ceiling itself.
    const explicitTimeoutMs = (typeof reqOpts.timeoutMs === 'number' && reqOpts.timeoutMs > 0) ? reqOpts.timeoutMs : DEFAULT_RPC_TIMEOUT_MS;
    let timeoutMs = Math.min(DEFAULT_RPC_TIMEOUT_MS, explicitTimeoutMs);
    if (typeof reqOpts.backendDeadlineMs === 'number') {
      timeoutMs = Math.min(timeoutMs, reqOpts.backendDeadlineMs - Date.now());
      if (timeoutMs <= 0) return { ok: false, reason: 'deadline-non-positive' }; // PLAN.md ~L934 "non-positive means do not start" -- never writes.
    }
    return { ok: true, timeoutMs };
  }

  function dispatchRequest(id, method, params, reqOpts) {
    const window = computeDispatchWindow(reqOpts);
    if (!window.ok) return Promise.resolve({ ok: false, reason: window.reason });
    const timeoutMs = window.timeoutMs;
    return new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => finish({ ok: false, reason: 'timeout-possibly-delivered' }), timeoutMs);
      function finish(result) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        pending.delete(id);
        resolve(result);
      }
      pending.set(id, { finish });
      writeJsonlFrame(stdin, { id, method, params }, (err) => {
        if (err) finish({ ok: false, reason: 'write-failed-confirmed-before-commit:' + String((err && err.message) || err) });
        // else: flushed successfully -- genuinely possibly-delivered now; wait for response/timeout/EOF.
      });
    });
  }


  /**
   * R7: closed classification of one already-JSON-parsed, non-jsonrpc-tainted
   * frame object (the frame feeder already rejected malformed/non-object/
   * jsonrpc-tainted lines before this ever runs). Distinguishes a genuine
   * `{id,result}` XOR `{id,error}` response (B3) from an ambiguous/extra-key
   * wrapper, validates `id`/`method`/`params` shape for both responses and
   * server-requests (B4/D1), and closes notifications to exactly
   * `{method,params}`. Anything that doesn't cleanly classify is `invalid`
   * -- treated by the caller exactly like a malformed wire frame (STOP),
   * never silently reinterpreted as whichever shape looks closest.
   *
   * R14 (Codex NO-GO 2026-07-18, P1): the four frame-level wrapper roots
   * (`base::JSONRPCResponse`/`JSONRPCError`/`JSONRPCRequest`/
   * `JSONRPCNotification`) are now the FIRST choke point for each of the
   * four classes, applied as soon as the ambiguous-wrapper precondition
   * (which schema even applies) is resolved. None of the four declare
   * `additionalProperties:false` and `RequestId`'s string arm has no
   * `minLength`, so every existing hand-rolled check below (idOk exact
   * key-set, non-empty method, params-is-object) remains as the PLAN's own
   * stricter gate, run immediately afterward -- exactly the schema-first/
   * business-rule-after pattern already established for the Bloque B
   * response/notification roots.
   */
  function classifyIncomingFrame(frame) {
    const hasId = Object.prototype.hasOwnProperty.call(frame, 'id');
    const hasMethod = Object.prototype.hasOwnProperty.call(frame, 'method');
    const hasResult = Object.prototype.hasOwnProperty.call(frame, 'result');
    const hasError = Object.prototype.hasOwnProperty.call(frame, 'error');
    const idOk = (v) => typeof v === 'string' ? v.length > 0 : (typeof v === 'number' && Number.isInteger(v));
    if (hasId && !hasMethod) {
      if (hasResult === hasError) return { kind: 'invalid', reason: 'response-wrapper-ambiguous' }; // neither or both -- never guess; also which schema applies is still undetermined here.
      if (hasResult) {
        if (!generated.roots['base::JSONRPCResponse'](frame)) return { kind: 'invalid', reason: 'response-schema-invalid' };
      } else {
        if (!generated.roots['base::JSONRPCError'](frame)) return { kind: 'invalid', reason: 'response-error-schema-invalid' };
      }
      if (!idOk(frame.id)) return { kind: 'invalid', reason: 'response-id-not-string-or-integer' };
      const expectedKeys = (hasResult ? ['id', 'result'] : ['id', 'error']).sort();
      if (!hasExactKeys(frame, expectedKeys)) return { kind: 'invalid', reason: 'response-wrapper-extra-keys' };
      return { kind: 'response', id: frame.id, ok: hasResult, result: frame.result, error: frame.error };
    }
    if (hasId && hasMethod) {
      if (!generated.roots['base::JSONRPCRequest'](frame)) return { kind: 'invalid', reason: 'server-request-schema-invalid' };
      if (!idOk(frame.id)) return { kind: 'invalid', reason: 'server-request-id-not-string-or-integer' };
      if (typeof frame.method !== 'string' || frame.method.length === 0) return { kind: 'invalid', reason: 'server-request-method-invalid' };
      if (!hasExactKeys(frame, ['id', 'method', 'params'].sort())) return { kind: 'invalid', reason: 'server-request-extra-keys' };
      if (!frame.params || typeof frame.params !== 'object' || Array.isArray(frame.params)) return { kind: 'invalid', reason: 'server-request-params-not-object' };
      return { kind: 'server-request', frame };
    }
    if (!hasId && hasMethod) {
      if (!generated.roots['base::JSONRPCNotification'](frame)) return { kind: 'invalid', reason: 'notification-schema-invalid' };
      if (!hasExactKeys(frame, ['method', 'params'].sort())) return { kind: 'invalid', reason: 'notification-extra-keys' };
      return { kind: 'notification', method: frame.method, params: frame.params };
    }
    return { kind: 'invalid', reason: 'frame-neither-request-response-notification' };
  }

  /**
   * R7: STOPPING-then-flush-then-STOPPED (A6). SR-01 (refresh) is the sole
   * row that may continue the connection; every other row/unknown-method
   * transitions to STOPPING (no-authority already applies) BEFORE its reply
   * is even written, flushes the exact frozen reply, and only THEN
   * finalizes to STOPPED -- regardless of whether that flush itself
   * succeeds (A6 "Si el write falla, igualmente termina STOPPED").
   */
  function handleServerRequest(frame) {
    if (isTerminal()) return; // A2/D5: never process a server request once STOP has begun.
    const { id, method, params } = frame;
    if (method === 'account/chatgptAuthTokens/refresh') {
      // R10 (Codex NO-GO P0, Block B): a SECOND SR-01 arriving while one is
      // ALREADY in flight is a genuine protocol violation -- at most ONE
      // refresh may ever be processed at a time. The R9 pass had no such
      // guard at all: two concurrent refreshes each independently invoked
      // refreshProvider and each independently emitted a response.
      if (isRefreshing()) {
        beginStop('refresh-concurrent-request');
        writeThenFinalizeStop({ id, error: SERVER_REQUEST_REFRESH_FAILED_ERROR });
        return;
      }
      // R8 (item 9): SR-01 only after AUTHENTICATED -- explicit and
      // defense-in-depth alongside the identity check below (which already
      // implies it, since `authenticatedIdentity` is only ever set together
      // with phase===AUTHENTICATED in login()).
      if (phase !== 'AUTHENTICATED') {
        beginStop('refresh-before-authenticated');
        writeThenFinalizeStop({ id, error: SERVER_REQUEST_REFRESH_FAILED_ERROR });
        return;
      }
      // R8 (item 8): invalid params -> provider is NEVER invoked, an error
      // is credited, and the connection STOPs -- previously params were not
      // validated at all before calling refreshProvider.
      if (!isValidChatgptAuthTokensRefreshParams(params)) {
        beginStop('refresh-invalid-params');
        writeThenFinalizeStop({ id, error: SERVER_REQUEST_INVALID_PARAMS_ERROR });
        return;
      }
      // R9 (P1-2): a claimed `previousAccountId` that CONTRADICTS the
      // connection's own authenticated account is a genuine identity
      // inconsistency -- rejected before ever invoking the provider, same
      // fail-closed posture as an invalid shape.
      if (params.previousAccountId != null && params.previousAccountId !== authenticatedIdentity.chatgptAccountId) {
        beginStop('refresh-contradictory-previous-account');
        writeThenFinalizeStop({ id, error: SERVER_REQUEST_REFRESH_FAILED_ERROR });
        return;
      }
      // R9 (Codex NO-GO P1-2): the ENTIRE result-inspection block below --
      // not merely the `refreshProvider(params)` call itself -- now runs
      // inside one try/catch. The R8 pass only wrapped the CALL; a
      // hostile/buggy provider returning an object with a THROWING getter
      // (e.g. on `.ok`) still crashed the process the instant `result.ok`
      // was read on the next line, entirely outside that narrower
      // try/catch. Any exception anywhere in this block is now treated
      // exactly like a shape-invalid result -- refresh-failed, never a
      // crash, never a fabricated success.
      let shapeOk = false;
      let identityOk = false;
      let tokenGenuinelyNew = false;
      let result;
      try {
        result = typeof refreshProvider === 'function' ? refreshProvider(params) : { ok: false };
        shapeOk = !!result && result.ok === true
          && typeof result.accessToken === 'string' && result.accessToken.length > 0
          && typeof result.chatgptAccountId === 'string' && result.chatgptAccountId.length > 0
          && (result.chatgptPlanType === null || typeof result.chatgptPlanType === 'string');
        // D4/PLAN.md SR-01 row: the refreshed account/plan MUST equal this
        // connection's own already-authenticated identity ("<validated-same-
        // account>") -- never merely shape-valid. No identity at all (login
        // never completed) means nothing to validate against, so refresh
        // never succeeds.
        identityOk = shapeOk && !!authenticatedIdentity
          && result.chatgptAccountId === authenticatedIdentity.chatgptAccountId
          && (result.chatgptPlanType === null || result.chatgptPlanType === authenticatedIdentity.chatgptPlanType);
        // R10 (Codex NO-GO P0): a "refreshed" token that was EVER used
        // before -- not merely one that differs from the single
        // most-recent one -- is a rollback and must fail closed. The R9
        // pass's `result.accessToken !== currentAccessToken` let an A->B->A
        // sequence through on the THIRD call (A differs from the
        // then-current B). `usedAccessTokens` is permanent history, never
        // just the latest value, and is only ever ADDED to on a CONFIRMED
        // flush (never at check time), closing the TOCTOU window between
        // this synchronous check and the async commit below.
        tokenGenuinelyNew = shapeOk && !usedAccessTokens.has(result.accessToken);
      } catch (err) {
        shapeOk = false; identityOk = false; tokenGenuinelyNew = false;
      }
      if (shapeOk && identityOk && tokenGenuinelyNew) {
        // R10 (Block B): this refresh attempt owns its own epoch from this
        // instant. `isRefreshing()` (used by dispatchRequest AND by
        // tryDeliverCurrentTurn) becomes true the moment this is set,
        // and ONLY this epoch's own callbacks may ever clear it -- a stale
        // callback from a since-superseded attempt checks
        // `activeRefreshEpoch === myEpoch` and no-ops otherwise.
        const myEpoch = ++refreshEpoch;
        activeRefreshEpoch = myEpoch;
        let flushSettled = false;
        const flushTimer = setTimeout(() => {
          if (flushSettled || activeRefreshEpoch !== myEpoch) return;
          flushSettled = true;
          activeRefreshEpoch = null;
          terminalStop('refresh-reply-flush-timeout');
        }, DEFAULT_RPC_TIMEOUT_MS);
        writeJsonlFrame(stdin, { id, result: { accessToken: result.accessToken, chatgptAccountId: result.chatgptAccountId, chatgptPlanType: result.chatgptPlanType } }, (err) => {
          if (flushSettled || activeRefreshEpoch !== myEpoch) return;
          flushSettled = true;
          clearTimeout(flushTimer);
          activeRefreshEpoch = null;
          // R9 (P0-1 class): re-check isTerminal() before granting anything
          // -- an unrelated STOP (stdin/stdout close/error, a malformed
          // frame) could have begun during this exact flush window.
          if (isTerminal()) return;
          // R8 (item 9): the reply's own flush is now credited -- a write
          // failure (e.g. EPIPE) used to be silently absorbed (no callback
          // at all), leaving the connection wrongly believing it had
          // continued authenticated. Only a CONFIRMED flush genuinely
          // "continues"; a failed one is now itself a STOP trigger.
          if (err) { terminalStop('refresh-reply-write-failed:' + String((err && err.message) || err)); return; }
          usedAccessTokens.add(result.accessToken); // R10: only a CONFIRMED flush commits the token to history.
          onRefreshConfirmed(myEpoch); // R14: anything deferred while THIS epoch was active is now safe to deliver, via the single delivery transition.
        });
        return; // sole row that may continue the connection -- no STOP (barring the write failure/timeout above).
      }
      beginStop('refresh-failed');
      writeThenFinalizeStop({ id, error: SERVER_REQUEST_REFRESH_FAILED_ERROR });
      return;
    }
    // R8 (item 13): a bare `SERVER_REQUEST_FIXED_ROWS[method]` bracket lookup
    // on a plain object literal would return an INHERITED Object.prototype
    // member (e.g. `.toString`, truthy) for a method literally named
    // "toString"/"constructor"/etc., producing an invalid wire reply instead
    // of the correct fail-closed unknown-method error -- hasOwnProperty
    // closes that inherited-property hole.
    const row = Object.prototype.hasOwnProperty.call(SERVER_REQUEST_FIXED_ROWS, method) ? SERVER_REQUEST_FIXED_ROWS[method] : undefined;
    if (!row) {
      beginStop('unknown-server-request-method:' + method);
      writeThenFinalizeStop({ id, error: SERVER_REQUEST_UNKNOWN_METHOD_ERROR });
      return;
    }
    // R8 (item 8): method-specific params validation for SR-02..SR-10 -- an
    // invalid shape now gets a dedicated error response and STOP instead of
    // the row's normal frozen reply.
    const validator = Object.prototype.hasOwnProperty.call(SERVER_REQUEST_PARAMS_VALIDATORS, method) ? SERVER_REQUEST_PARAMS_VALIDATORS[method] : null;
    if (validator && !validator(params)) {
      beginStop('invalid-server-request-params:' + method);
      writeThenFinalizeStop({ id, error: SERVER_REQUEST_INVALID_PARAMS_ERROR });
      return;
    }
    beginStop('server-request-' + method);
    writeThenFinalizeStop(Object.assign({ id }, row));
  }

  const notificationHandlers = new Map(); // method -> Array<(params) => void>
  /** E1: returns an unsubscribe function so a caller's own listener never outlives its need. */
  function onNotification(method, handler) {
    if (!notificationHandlers.has(method)) notificationHandlers.set(method, []);
    const arr = notificationHandlers.get(method);
    arr.push(handler);
    let removed = false;
    return function unsubscribe() {
      if (removed) return;
      removed = true;
      const idx = arr.indexOf(handler);
      if (idx !== -1) arr.splice(idx, 1);
    };
  }

  /**
   * Runs the itemsView/agentMessage/envelope validation and invokes
   * `entry.handler` exactly once. Called only from `tryDeliverCurrentTurn`
   * (the single delivery transition), so every path that can trigger
   * delivery -- turn/start's own response, a live turn/completed
   * notification, registerHandler, or a resolved refresh deferral -- shares
   * the identical validation logic.
   */
  function invokeTurnCompletionHandler(entry, turn) {
    const deliver = (res) => {
      try { entry.handler(res); } catch (err) { terminalStop('turn-completion-handler-exception:' + String((err && err.message) || err)); } // E4: a throwing handler fails closed, never crashes the process.
    };
    if (turn.status !== 'completed') { deliver({ ok: false, reason: 'turn-not-completed:' + turn.status }); return; }
    // C7/PLAN.md ~L936 literal: "itemsView absent/full" -- BOTH tolerated;
    // only a present-and-non-full value (summary/notLoaded/anything else)
    // is rejected.
    if (turn.itemsView !== undefined && turn.itemsView !== 'full') { deliver({ ok: false, reason: 'turn-completed-items-view-not-full:' + turn.itemsView }); return; }
    const items = Array.isArray(turn.items) ? turn.items : [];
    const claimedAgentMessages = items.filter((it) => it && it.type === 'agentMessage');
    for (const it of claimedAgentMessages) {
      if (!isValidAgentMessageItem(it)) { deliver({ ok: false, reason: 'turn-completed-agent-message-item-invalid-shape' }); return; } // C8: fail closed, never silently skip a malformed agentMessage-claiming item.
    }
    const finalAnswers = claimedAgentMessages.filter((it) => it.phase === 'final_answer');
    let chosen;
    if (finalAnswers.length === 1) {
      chosen = finalAnswers[0];
    } else if (finalAnswers.length === 0) {
      const compat = claimedAgentMessages.filter((it) => it.phase === null || it.phase === undefined);
      if (claimedAgentMessages.length === 1 && compat.length === 1) chosen = compat[0];
    }
    if (!chosen) { deliver({ ok: false, reason: 'turn-completed-no-unambiguous-final-answer' }); return; }
    if (chosen.text.length === 0) { deliver({ ok: false, reason: 'turn-completed-content-not-bare-json' }); return; }
    // `JSON.parse` throws on any leading prose/fence or trailing bytes after
    // the first complete value -- sufficient on its own for PLAN.md ~L934's
    // "no fence, prose, or trailing bytes" requirement.
    let parsed;
    try {
      parsed = JSON.parse(chosen.text);
    } catch (err) {
      deliver({ ok: false, reason: 'turn-completed-content-not-bare-json' });
      return;
    }
    const result = validateRuntimeTurnEnvelope(parsed, entry.expectedResultKind, entry.allowedChildRoles);
    if (!result.ok) { deliver({ ok: false, reason: 'turn-completed-envelope-invalid:' + result.reason }); return; }
    deliver({ ok: true, envelope: parsed });
  }

  /**
   * R14 (Bloque A): the SINGLE delivery transition for the current turn --
   * every one of the three orthogonal prerequisites (turnResponse arriving,
   * a turn/completed notification, registerHandler) calls this same
   * function after updating its own field on `currentTurn`, and it is the
   * ONLY place that retires a turn id or marks a turn DELIVERED. Codex's
   * NO-GO correctly found that the prior design's `flushDeferredCompletions`
   * bypassed this exact transition by invoking the handler directly -- that
   * can no longer happen because refresh-confirm (below) now also funnels
   * through here. Fires only once responseObserved && completion!==null &&
   * handlerEntry!==null are ALL true; any of the three may be the last
   * event to complete that set.
   */
  function tryDeliverCurrentTurn() {
    const t = currentTurn;
    if (!t || !(t.responseObserved && t.completion !== null && t.handlerEntry !== null)) return; // not all three yet, or no current turn -- no-op, correct, not an error.
    // R14 (Codex NO-GO 2026-07-18, Bloque A2): once turnInterrupt has begun
    // (INTERRUPT_PENDING, set BEFORE the wire write) or succeeded
    // (INTERRUPTED), this turn is IRREVOCABLY ineligible to produce
    // {ok:true,envelope} -- even if all three delivery prerequisites happen
    // to race in anyway. Defense in depth: correlateTurnNotification and
    // onTurnCompleted already refuse new completions/handlers once
    // interrupted, so this should be unreachable in practice, but delivery
    // itself must never assume that.
    if (t.state === 'INTERRUPT_PENDING' || t.state === 'INTERRUPTED') return;
    if (isRefreshing()) {
      t.refreshDeferralEpoch = activeRefreshEpoch;
      t.state = 'DEFERRED_FOR_REFRESH';
      return;
    }
    // R14 (replay fence): this turn id is retired the instant delivery
    // genuinely proceeds -- regardless of whether the envelope content
    // `invokeTurnCompletionHandler` goes on to validate as ok:true or
    // ok:false, this turn has had its one authoritative delivery attempt
    // and must never bind again on this thread's lifetime. Cap exhaustion
    // STOPs the connection (terminalStop already invoked internally by
    // retireTurnId) and this specific delivery never fires -- consistent
    // with every other STOP path in this file never invoking a handler
    // after the connection is torn down.
    if (!retireTurnId(t.turnId)) return;
    t.state = 'DELIVERED';
    invokeTurnCompletionHandler(t.handlerEntry, t.completion);
  }

  /**
   * Called once an active refresh epoch resolves SUCCESSFULLY. Routes
   * through the SAME `tryDeliverCurrentTurn` transition as the live-wire
   * paths -- never invokes the handler directly (the exact bug Codex's
   * NO-GO found in the prior `flushDeferredCompletions`). A no-op if
   * nothing is deferred, or if the deferral belongs to a since-superseded
   * epoch (a stale callback from an epoch no longer active).
   */
  function onRefreshConfirmed(epoch) {
    const t = currentTurn;
    if (!t || t.state !== 'DEFERRED_FOR_REFRESH' || t.refreshDeferralEpoch !== epoch) return;
    t.refreshDeferralEpoch = null;
    t.state = 'IN_PROGRESS'; // tryDeliverCurrentTurn re-checks isRefreshing() (now false) and re-derives DELIVERED itself -- never assumed here.
    tryDeliverCurrentTurn();
  }

  /**
   * C6: shared wire-level correlator for BOTH `turn/started` and
   * `turn/completed` (both exactly `{threadId, turn:Turn}` --
   * prep/phase-a/codex-schema/ts-run1/v2/{TurnStartedNotification,
   * TurnCompletedNotification}.ts). An unknown thread (nothing tracked
   * in-flight) is silently ignored -- diagnostic-only noise, matching this
   * suite's existing "wrong-thread notifications are ignored" precedent.
   * A KNOWN in-flight thread whose notification names a CONFLICTING turn id
   * is a genuine protocol violation (not noise) and STOPs the connection --
   * "un pair arbitrario nunca puede registrarse como autoridad" is enforced
   * against the WIRE here; the first live notification (or turnStart's own
   * response, in turnStart below) legitimately BINDS the pair.
   */
  function correlateTurnNotification(methodName, params) {
    if (isTerminal()) return;
    if (!params || typeof params !== 'object' || Array.isArray(params)) return;
    if (!hasExactKeys(params, ['threadId', 'turn'].sort())) return;
    const { threadId, turn } = params;
    if (typeof threadId !== 'string' || !turn || typeof turn !== 'object' || typeof turn.id !== 'string' || turn.id.length === 0) return;
    // R14 (Codex NO-GO 2026-07-18, Bloque A1): mirrors turn-state-model.cjs's
    // lateFrame() EXACTLY -- a notification for a thread that is not the
    // current active one is UNCONDITIONALLY diagnostic-only noise, covering
    // both never-known threads and already-archived ones. It must NEVER
    // consult activeThreadId's own retiredTurnIds set: retired ids are a
    // per-active-thread-lineage concept, and a coincidental turn.id match
    // against an UNRELATED (non-active) thread's frame is not a replay of
    // anything -- treating it as one was a false-positive cross-thread STOP
    // this correction removes.
    if (threadLifecycleState !== 'ACTIVE' || activeThreadId !== threadId) return;
    // R10 (Codex NO-GO P0): the R9 pass built `isSchemaValidTurn` (used by
    // turnStart's response and thread/resume's persisted turns) but never
    // actually WIRED it into the notification path -- this function only
    // ever checked `turn.id`, so a structurally invalid Turn (e.g. a
    // sibling `plan` item missing its own required `text`, alongside an
    // otherwise-valid final `agentMessage`) still reached delivery and
    // produced `{ok:true,envelope}`. A KNOWN, active thread naming an
    // invalid Turn is a genuine protocol violation (not noise) -- STOP,
    // never bind/deliver anything from it.
    // R14 (Codex NO-GO 2026-07-18, Bloque B): validates the FULL
    // {threadId,turn} notification wrapper against its own generated root
    // (TurnStartedNotification/TurnCompletedNotification), not merely the
    // nested Turn definition -- the single choke point PLAN.md's
    // schema-validator-bundle contract requires, in place of a
    // hand-transcribed duplicate that could silently drift from the real
    // schema. threadId/turn presence and basic typing are already confirmed
    // above, so this is a strict superset check, not a behavior change for
    // any well-formed frame.
    if (!generated.roots[methodName === 'turn/started' ? 'v2::TurnStartedNotification' : 'v2::TurnCompletedNotification'](params)) { terminalStop('turn-notification-schema-invalid:' + methodName); return; }
    if (!currentTurn) return; // no turn dispatched yet on this thread -- diagnostic-only noise.
    // R14 (replay fence): ANY retired id -- an older turn from this thread's
    // lineage, or the CURRENT turn that just delivered (retireTurnId() runs
    // synchronously as part of delivery, strictly before `state` flips to
    // DELIVERED, so the current turn's own id is already retired by the
    // time this is reached) -- is a genuine replay and gets this specific
    // diagnostic. Checked BEFORE the generic delivered-state fast path
    // below so the more precise reason always wins.
    if (isRetiredTurnId(turn.id)) { terminalStop('turn-notification-turn-id-replay-of-retired-id:' + methodName); return; }
    // R14 (Bloque A): a duplicate/late notification for a turn that has
    // ALREADY reached its one authoritative delivery is a genuine replay,
    // not noise -- STOP (covers both turn/started and turn/completed).
    if (currentTurn.state === 'DELIVERED') { terminalStop((methodName === 'turn/started' ? 'turn-started-after-delivered' : 'turn-completed-after-delivered')); return; }
    // R14 (Codex NO-GO 2026-07-18, Bloque A2): a notification arriving once
    // this turn has begun (or completed) interruption is likewise never
    // noise -- PLAN.md's own contract is explicit that interrupted turns
    // never produce a result, so a late/racing notification here STOPs
    // rather than being silently buffered-but-undelivered.
    if (currentTurn.state === 'INTERRUPT_PENDING' || currentTurn.state === 'INTERRUPTED') { terminalStop((methodName === 'turn/started' ? 'turn-started-after-interrupt' : 'turn-completed-after-interrupt')); return; }
    // R14 point C3: a duplicate turn/started, or one arriving after
    // completion was already observed (even if full delivery is still
    // outstanding -- response/handler may not have arrived yet), both STOP
    // -- checked before id-binding/verification, mirroring turn-state-model.cjs.
    if (methodName === 'turn/started') {
      if (currentTurn.startedObserved) { terminalStop('duplicate-turn-started'); return; }
      if (currentTurn.completion !== null) { terminalStop('turn-started-after-completion-observed'); return; }
    } else if (currentTurn.completion !== null) {
      // R14 (Codex NO-GO 2026-07-18, Bloque A1): the pinned turn-state-model.cjs
      // completion() STOPs unconditionally on ANY second completion once
      // t.completion !== null -- identical or genuinely different, no
      // equality exception. Reproduced empirically before this fix: two
      // byte-identical completions arriving before response+handler left
      // the connection operative, and a genuine result still delivered once
      // response+handler eventually arrived -- exactly the "un pair
      // arbitrario nunca puede registrarse como autoridad" violation this
      // STOP exists to catch, regardless of wire-level identity between the
      // two frames.
      terminalStop('turn-completed-duplicate-early-completion');
      return;
    }
    const bind = bindOrVerifyCurrentTurnId(turn.id);
    if (!bind.ok) { terminalStop((bind.retiredReplay ? 'turn-notification-turn-id-replay-of-retired-id:' : 'turn-notification-conflicting-turn-id:') + methodName); return; }
    if (methodName === 'turn/started') { currentTurn.startedObserved = true; return; }
    currentTurn.completion = turn;
    tryDeliverCurrentTurn();
  }

  const feed = createJsonlFrameFeeder(
    (frame) => {
      if (isTerminal()) return; // defense in depth -- the feeder's own shouldStop already gates this in the normal dispatch path.
      const classified = classifyIncomingFrame(frame);
      if (classified.kind === 'invalid') { terminalStop('invalid-frame:' + classified.reason); return; }
      if (classified.kind === 'response') {
        const waiter = pending.get(classified.id);
        if (!waiter) {
          // R14 (Codex NO-GO 2026-07-18, P0 duplicate turn/start response
          // bypass): a second response sharing the SAME id as the current
          // turn's own turn/start request -- identical or conflicting
          // content, whether it arrives in the same chunk (before its
          // sibling's dispatchRequest .then() microtask even runs) or a
          // later one (after the first was already accredited but before
          // the join completes) -- must reach the lifecycle machine and
          // STOP, never fall through as an unrelated stray. Reproduced
          // empirically before this fix: the duplicate silently hit this
          // exact branch (no waiter left -- the first response's `finish`
          // already deleted it), so it never surfaced, and a later
          // completion+handler still delivered a genuine result. Bounded to
          // this ONE currentTurn record's own turnStartRequestId field -- no
          // second id authority, no unbounded registry.
          if (currentTurn && currentTurn.turnStartRequestId === classified.id) {
            terminalStop('duplicate-rpc-response');
          }
          return; // otherwise: no matching pending call -- diagnostic-only, never fabricated (B4).
        }
        waiter.finish(classified.ok ? { ok: true, result: classified.result } : { ok: false, error: classified.error });
        return;
      }
      if (classified.kind === 'server-request') { handleServerRequest(classified.frame); return; }
      // notification
      if (classified.method === 'turn/started' || classified.method === 'turn/completed') {
        correlateTurnNotification(classified.method, classified.params);
        return;
      }
      const handlers = (notificationHandlers.get(classified.method) || []).slice(); // snapshot -- a handler unsubscribing mid-dispatch must not skip a sibling.
      for (const h of handlers) {
        try { h(classified.params); } catch (err) { terminalStop('notification-handler-exception:' + String((err && err.message) || err)); return; } // E4.
      }
    },
    // R5 correction: a malformed/non-object/jsonrpc-tainted line used to be
    // silently swallowed here. A transport that just emitted a byte
    // sequence that isn't valid framing cannot be trusted to still be
    // correctly framed afterward -- fail closed: STOP the connection and
    // settle every currently-pending call rather than let them hang.
    (reason, rawLine) => {
      terminalStop('malformed-frame:' + reason);
    },
    () => isTerminal(),
  );
  stdout.on('data', feed);
  // R5 correction: EOF/transport-error used to leave every pending call
  // hanging forever. Both are "possibly-delivered, never confirmed" per
  // PLAN.md ~L934 -- settle everything currently pending, never silently
  // stall a caller.
  stdout.on('end', () => {
    terminalStop('transport-eof', 'transport-eof-possibly-delivered');
  });
  stdout.on('error', (err) => {
    const msg = String((err && err.message) || err);
    terminalStop('transport-error:' + msg, 'transport-error-possibly-delivered:' + msg);
  });
  // R9 (Codex NO-GO P1-5): a real Readable can emit 'close' WITHOUT ever
  // emitting 'end' or 'error' first (an abrupt destroy/pipe-break) -- the
  // R8 pass only listened for 'end'/'error', leaving that path silently
  // unnoticed and the connection thinking it was still operative.
  stdout.on('close', () => {
    terminalStop('transport-close', 'transport-close-possibly-delivered');
  });
  // R8 (item 10): `stdin` itself had no error listener at all -- an
  // unhandled 'error' event on any EventEmitter is fatal by Node's own
  // default (it throws and crashes the process). A broken write-side pipe
  // (e.g. EPIPE) must STOP this connection, never crash the host process.
  // Guarded by `typeof stdin.on === 'function'`: a REAL production stdin is
  // always a genuine Writable stream (always has `.on`); a minimal test
  // fake that implements only `.write()` must not be forced to also
  // implement the full EventEmitter interface just for this listener.
  if (typeof stdin.on === 'function') {
    stdin.on('error', (err) => {
      const msg = String((err && err.message) || err);
      terminalStop('stdin-error:' + msg, 'stdin-error-possibly-delivered:' + msg);
    });
    // R9 (P1-5): symmetric with stdout's own 'close' handling above -- a
    // Writable can also be destroyed/closed without an 'error' ever firing.
    stdin.on('close', () => {
      terminalStop('stdin-close', 'stdin-close-possibly-delivered');
    });
  }

  /**
   * `initialize` (PLAN.md ~L897/~L899): request id EXACTLY 1 (structurally
   * guaranteed -- only `initialize` may run from phase NEW, and it is the
   * sole thing that ever consumes an id while phase===NEW), only from
   * phase NEW, never called twice (C1 "segunda llamada... -> STOP", latched
   * independent of phase so a second CONCURRENT call while the first is
   * still pending is caught too). Validated against the real
   * `InitializeResponse` shape (`userAgent,codexHome,platformFamily,
   * platformOs`, all required non-empty strings); `initialized`'s own
   * flush is credited (Node's write-completion callback) BEFORE the
   * connection transitions to INITIALIZED or the call resolves ok (C1
   * "initialized debe escribirse y acreditar flush antes de success").
   */
  function initialize(timeoutOpts) {
    if (isTerminal()) return Promise.resolve({ ok: false, reason: 'connection-stopped' });
    if (phase !== 'NEW' || initializeCalled) { terminalStop('initialize-wrong-phase-or-called-more-than-once'); return Promise.resolve({ ok: false, reason: 'initialize-wrong-phase-or-called-more-than-once' }); }
    initializeCalled = true;
    const id = allocateId();
    return dispatchRequest(id, 'initialize', {
      clientInfo: { name: 'android-common-doc-runtime-bridge', version: '1.0.0' },
      capabilities: { experimentalApi: true },
    }, timeoutOpts).then((res) => {
      // `res` already reflects whatever happened -- including a STOP the
      // dispatch layer itself triggered (malformed frame/EOF/transport
      // error), with its own more specific reason. Do NOT re-check
      // isTerminal() here and override it; that would replace a specific
      // "...-possibly-delivered" reason with a generic connection-level one.
      if (!res.ok) { terminalStop('initialize-rejected:' + (res.reason || 'error-response')); return res; }
      // R8 (P0-1): `res.ok===true` means a genuinely valid response was
      // MATCHED, but this `.then()` continuation is a deferred microtask --
      // if a LATER line in the SAME synchronous chunk already STOPped the
      // connection (e.g. a malformed frame immediately following a valid
      // response), that STOP happened before this callback ever runs. A
      // stale-but-valid response must never be allowed to "resurrect" the
      // connection (write `initialized`, advance phase) after that.
      if (isTerminal()) return { ok: false, reason: stopReason };
      const r = res.result;
      // R14 (Codex NO-GO 2026-07-18, Bloque B): the generated root validator
      // is now the FIRST choke point for structural validity (required
      // fields, types, nested shapes), per PLAN.md's schema-validator-bundle
      // contract -- previously this response was validated by an entirely
      // hand-transcribed check with zero dependency on the generated bundle.
      if (!r || typeof r !== 'object' || Array.isArray(r) || !generated.roots['v1::InitializeResponse'](r)) {
        terminalStop('initialize-response-schema-invalid');
        return { ok: false, reason: 'initialize-response-schema-invalid' };
      }
      // Non-empty-string is a business rule the schema itself does not
      // enforce (type:string alone, no minLength) -- preserved as its own
      // check, with its own specific reason, after the schema gate.
      if (r.userAgent.length === 0 || r.codexHome.length === 0 || r.platformFamily.length === 0 || r.platformOs.length === 0) {
        terminalStop('initialize-response-invalid-shape');
        return { ok: false, reason: 'initialize-response-invalid-shape' };
      }
      return new Promise((resolve) => {
        writeJsonlFrame(stdin, { method: 'initialized', params: {} }, (err) => {
          // R9 (P0-1): this callback is ITSELF a deferred continuation --
          // an unrelated transport failure (malformed frame / stdin-stdout
          // error-close) can STOP the connection during the window between
          // issuing this write and its callback firing. Re-checking
          // isTerminal() here, symmetric with the dispatchRequest `.then()`
          // check above, is what makes the phase machine irrevocably
          // monotonic: once STOPPING/STOPPED, NO later-settling callback may
          // ever write `phase = 'INITIALIZED'` again ("resurrection").
          if (isTerminal()) { resolve({ ok: false, reason: stopReason }); return; }
          if (err) { terminalStop('initialized-notification-write-failed'); resolve({ ok: false, reason: 'initialized-notification-write-failed' }); return; }
          phase = 'INITIALIZED';
          resolve(res);
        });
      });
    });
  }

  /**
   * `account/login/start` (PLAN.md ~L897). Within `timeoutMs` (default
   * 10000, PLAN's literal "within 10 seconds"), requires in EITHER arrival
   * order: exactly one schema-valid id-matched `LoginAccountResponse` with
   * `type:"chatgptAuthTokens"`, AND an `account/updated` notification whose
   * `authMode=="chatgptAuthTokens"` AND whose `planType` (`AccountUpdated
   * Notification.planType`, real field -- R5 correction: this session's
   * first pass never checked it) either equals the supplied
   * `credentials.chatgptPlanType` or is `null` (PLAN.md ~L897's "the
   * validated supplied plan or the allowed derived/null->unknown
   * semantics"). A duplicate identical notification is ignored; a
   * conflicting authMode OR conflicting planType, or either condition
   * missing by the deadline, rejects. `credentials` is `{accessToken,
   * chatgptAccountId,chatgptPlanType}` -- production sources this from
   * `CredentialBroker/v1` (not yet built); this function does not itself
   * validate WHERE the caller got them, only the wire correlation.
   * R8 (item 11): also accepts an optional `backendDeadlineMs`, applying the
   * SAME `min(explicitTimeoutMs, backendDeadlineMs-now)` window as
   * `dispatchRequest` (PLAN.md ~L934) -- previously only the
   * dispatchRequest-based RPCs honored this; `login` had its own hand-rolled
   * timeout with no deadline awareness at all.
   * @param {{accessToken:string,chatgptAccountId:string,chatgptPlanType:(string|null)}} credentials
   * @param {{timeoutMs?:number,backendDeadlineMs?:number}} [opts]
   */
  function login(credentials, opts) {
    if (isTerminal()) return Promise.resolve({ ok: false, reason: 'connection-stopped' });
    if (phase !== 'INITIALIZED' || loginCalled) { terminalStop('login-wrong-phase-or-called-more-than-once'); return Promise.resolve({ ok: false, reason: 'login-wrong-phase-or-called-more-than-once' }); }
    // R9 (Codex NO-GO P1-6): `loginCalled` used to latch UNCONDITIONALLY
    // right here, BEFORE the deadline check below could still refuse the
    // call without ever attempting anything. A non-positive-deadline call
    // then permanently consumed the one-shot latch -- the connection was
    // left neither STOPped NOR usable: every LATER, genuinely valid login()
    // attempt would hit the guard above and be treated as "called more than
    // once", terminalStopping the whole connection for no real reason. The
    // latch now only commits once this call has confirmed it will actually
    // proceed.
    // R9 (P1-4): same real min(10000, requested, deadline-now) formula as
    // dispatchRequest -- login()'s own hand-rolled timeout had the identical
    // uncapped-explicit-timeout bug.
    const explicitTimeoutMs = (opts && typeof opts.timeoutMs === 'number' && opts.timeoutMs > 0) ? opts.timeoutMs : DEFAULT_RPC_TIMEOUT_MS;
    let timeoutMs = Math.min(DEFAULT_RPC_TIMEOUT_MS, explicitTimeoutMs);
    if (opts && typeof opts.backendDeadlineMs === 'number') {
      timeoutMs = Math.min(timeoutMs, opts.backendDeadlineMs - Date.now());
      if (timeoutMs <= 0) return Promise.resolve({ ok: false, reason: 'deadline-non-positive' }); // PLAN.md ~L934 "non-positive means do not start" -- never writes (mirrors dispatchRequest).
    }
    loginCalled = true; // R9: latched only now that this call is genuinely proceeding -- see the comment above.
    return new Promise((resolve) => {
      let responseOk = false;
      let notifiedOk = false;
      let settled = false;
      const timer = setTimeout(() => finish({ ok: false, reason: 'login-timeout' }), timeoutMs);
      function finish(result) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        pending.delete(id);
        if (typeof unsubscribeUpdated === 'function') unsubscribeUpdated();
        if (!result.ok) terminalStop('login-failed:' + result.reason);
        resolve(result);
      }
      let commitScheduled = false;
      function maybeSucceed() {
        if (responseOk && notifiedOk && !settled && !commitScheduled) {
          commitScheduled = true;
          // R10 (Codex NO-GO P1, Block D): the ACTUAL commit is deferred by
          // one microtask. Both `responseOk` and `notifiedOk` can become
          // true from processing TWO DIFFERENT lines within the SAME
          // synchronous chunk (e.g. the login response, then the
          // account/updated notification, then a malformed frame -- all
          // delivered together) -- the R9 pass committed `phase =
          // 'AUTHENTICATED'` and called the outer `finish({ok:true})`
          // SYNCHRONOUSLY the instant the second condition became true,
          // which deletes this call's `pending` entry immediately. A LATER
          // line in that same chunk (e.g. malformed JSON) then STOPs via
          // `failAllPending`, but by then there was nothing left in
          // `pending` to fail -- login had already resolved ok:true.
          // Deferring the commit past the synchronous feed() loop lets
          // `failAllPending` reach this call's still-present `pending`
          // entry FIRST, settling it ok:false; the `isTerminal()` recheck
          // below is then a defensive backstop for the (currently
          // unreached) case where nothing already settled it that way.
          queueMicrotask(() => {
            if (settled) return; // defensive -- the timeout timer cannot outrace a microtask, but never assume that invariant silently.
            if (isTerminal()) { finish({ ok: false, reason: stopReason }); return; }
            phase = 'AUTHENTICATED';
            authenticatedIdentity = { chatgptAccountId: credentials.chatgptAccountId, chatgptPlanType: credentials.chatgptPlanType };
            usedAccessTokens.add(credentials.accessToken); // R10: the login token counts as "already used" -- a later refresh rolling back to it must be rejected too, not merely one differing from the single most-recent token.
            // R8 (item 11): the handshake's OWN account/updated listener
            // (`unsubscribeUpdated`, below) unsubscribes once settled --
            // "vigilancia" continues via a SEPARATE, permanent listener so a
            // LATER conflicting notification (the authenticated identity
            // changing underneath this connection) still STOPs it, rather
            // than being silently unwatched entirely after login. An
            // identical/compatible (including null-planType) later
            // notification is harmless and ignored -- idempotent, not a
            // second rejection path. Cleaned up implicitly by
            // finalizeStop()'s wholesale notificationHandlers.clear().
            onNotification('account/updated', (postParams) => {
              if (isTerminal()) return;
              // R14 (Codex NO-GO 2026-07-18, Bloque B): same schema-first gate as the pre-login watcher above.
              if (!postParams || typeof postParams !== 'object' || Array.isArray(postParams) || !generated.roots['v2::AccountUpdatedNotification'](postParams)) { terminalStop('post-login-account-updated-schema-invalid'); return; }
              if (!hasExactKeys(postParams, ['authMode', 'planType'].sort())) { terminalStop('post-login-account-updated-shape-invalid'); return; }
              if (postParams.authMode !== null && !AUTH_MODE_VALUES.includes(postParams.authMode)) { terminalStop('post-login-account-updated-authmode-not-enum'); return; }
              if (postParams.authMode !== 'chatgptAuthTokens') { terminalStop('post-login-conflicting-account-updated'); return; }
              if (postParams.planType !== null && !PLAN_TYPE_VALUES.includes(postParams.planType)) { terminalStop('post-login-account-updated-plantype-not-enum'); return; }
              if (postParams.planType !== null && authenticatedIdentity && postParams.planType !== authenticatedIdentity.chatgptPlanType) { terminalStop('post-login-conflicting-plan-type'); return; }
            });
            finish({ ok: true });
          });
        }
      }
      const id = nextId++;
      pending.set(id, {
        finish: (frameRes) => {
          if (!frameRes.ok) { finish({ ok: false, reason: frameRes.reason || 'login-response-invalid' }); return; }
          // R14 (Codex NO-GO 2026-07-18, Bloque B): the generated root
          // validator is now the FIRST choke point -- LoginAccountResponse
          // is a closed oneOf union (apiKey/chatgpt/chatgptDeviceCode/
          // chatgptAuthTokens/...); this bridge only ever accepts the
          // chatgptAuthTokens variant, a business rule that stays a
          // SEPARATE, more specific check after the schema gate.
          const r = frameRes.result;
          if (!r || typeof r !== 'object' || Array.isArray(r) || !generated.roots['v2::LoginAccountResponse'](r)) { finish({ ok: false, reason: 'login-response-schema-invalid' }); return; }
          if (r.type !== 'chatgptAuthTokens') { finish({ ok: false, reason: 'login-response-invalid' }); return; }
          responseOk = true;
          maybeSucceed();
        },
      });
      const unsubscribeUpdated = onNotification('account/updated', (params) => {
        if (settled) return;
        // R14 (Codex NO-GO 2026-07-18, Bloque B): schema gate first -- both
        // authMode/planType are optional-and-nullable per the real schema,
        // so this alone would rarely reject anything the hand-rolled
        // hasExactKeys check below doesn't already catch; wired for
        // architectural consistency with the rest of the bundle.
        if (!params || typeof params !== 'object' || Array.isArray(params) || !generated.roots['v2::AccountUpdatedNotification'](params)) { finish({ ok: false, reason: 'login-account-updated-schema-invalid' }); return; }
        if (!hasExactKeys(params, ['authMode', 'planType'].sort())) { finish({ ok: false, reason: 'login-account-updated-shape-invalid' }); return; }
        if (params.authMode !== null && !AUTH_MODE_VALUES.includes(params.authMode)) { finish({ ok: false, reason: 'login-account-updated-authmode-not-enum' }); return; }
        if (params.authMode !== 'chatgptAuthTokens') { finish({ ok: false, reason: 'login-conflicting-account-updated' }); return; }
        if (params.planType !== null && !PLAN_TYPE_VALUES.includes(params.planType)) { finish({ ok: false, reason: 'login-account-updated-plantype-not-enum' }); return; }
        if (params.planType !== null && params.planType !== credentials.chatgptPlanType) {
          finish({ ok: false, reason: 'login-conflicting-plan-type' });
          return;
        }
        notifiedOk = true; // duplicate identical notifications: this is idempotent, never a second rejection path.
        maybeSucceed();
      });
      writeJsonlFrame(stdin, {
        id,
        method: 'account/login/start',
        params: {
          type: 'chatgptAuthTokens',
          accessToken: credentials.accessToken,
          chatgptAccountId: credentials.chatgptAccountId,
          chatgptPlanType: credentials.chatgptPlanType,
        },
      }, (err) => {
        if (err) finish({ ok: false, reason: 'write-failed-confirmed-before-commit:' + String((err && err.message) || err) });
      });
    });
  }

  /**
   * `thread/start` (PLAN.md ~L906-912, full validation ~L932). Exact
   * params; every unlisted optional field omitted (~L928). Returns
   * `{ok:true,threadId}` only after full `ThreadStartResponse` validation
   * against the REAL generated shape (R5 correction -- see the file-level
   * note above this function): `approvalPolicy`/`approvalsReviewer`/`cwd`/
   * `sandbox`/`instructionSources`/`model`/`modelProvider` are top-level
   * response fields exactly as before, but `id`/`ephemeral`/`turns` are
   * nested inside `result.thread` (`Thread`), never flat on `result`
   * itself.
   * @param {{role:string,developerInstructions:string,baseInstructions:string,cwd:string}} opts
   * @param {{timeoutMs?:number}} [timeoutOpts]
   */
  function threadStart(opts, timeoutOpts) {
    if (isTerminal()) return Promise.resolve({ ok: false, reason: 'connection-stopped' });
    if (phase !== 'AUTHENTICATED') { terminalStop('thread-start-wrong-phase'); return Promise.resolve({ ok: false, reason: 'thread-start-wrong-phase' }); }
    // R14 (Bloque A, Codex NO-GO finding #2): at most one active root-chain
    // thread -- a second thread/start (or thread/resume) while one is
    // already PENDING or ACTIVE is refused before ever dispatching, exactly
    // mirroring turn-state-model.cjs's dispatchThreadStart() busy guard.
    // Reproduced empirically before this fix: two consecutive threadStart
    // calls, neither archived, both resolved ok:true for distinct thread
    // ids -- a genuine violation of PLAN.md's own "at most one active...
    // root-chain thread" contract.
    if (threadLifecycleState !== 'IDLE') return Promise.resolve({ ok: false, reason: 'thread-lifecycle-busy' });
    threadLifecycleState = 'THREAD_START_PENDING';
    const id = allocateId();
    return dispatchRequest(id, 'thread/start', {
      approvalPolicy: 'never',
      approvalsReviewer: 'user',
      baseInstructions: opts.baseInstructions,
      config: null,
      cwd: opts.cwd,
      developerInstructions: opts.developerInstructions,
      ephemeral: false,
      model: null,
      modelProvider: null,
      personality: null,
      sandbox: null,
      serviceTier: null,
    }, timeoutOpts).then((frameRes) => {
      // R8 (P0-1): a stale-but-valid response arriving in the same
      // synchronous chunk as a LATER STOP-triggering line must never revive
      // the connection -- see the identical comment in initialize().
      // R14 (Bloque A): finalizeStop unconditionally resets
      // threadLifecycleState to IDLE on EVERY STOP (not just ones this call
      // itself triggered), so once terminal, frameRes.reason (or stopReason)
      // is ALREADY the most specific diagnostic available -- checked for
      // BOTH frameRes.ok outcomes, not just ok:true, or a generic
      // lost-tracking label would silently discard it (reproduced
      // empirically: an unrelated server-request STOP left this orphaned
      // call resolving 'thread-start-lost-tracking' instead of the real
      // stop reason). The state-based fallback below is reserved for the
      // non-terminal invariant-violation case that should never otherwise occur.
      if (isTerminal()) return { ok: false, reason: frameRes.reason || stopReason };
      if (threadLifecycleState !== 'THREAD_START_PENDING') return { ok: false, reason: 'thread-start-lost-tracking' };
      const result = validateThreadStartLikeResponse(frameRes, opts.cwd, 'thread-start', {});
      if (!result.ok) { terminalStop('thread-start-invalid:' + result.reason); return result; }
      // R14: reusing an id this connection already told the server to
      // retire (archive) is not a silent, recoverable refusal -- STOP so
      // this never resolves into a silently-orphaned server-side thread.
      if (result.threadId === lastArchivedThreadId) { terminalStop('thread-start-response-reuses-archived-id'); return { ok: false, reason: 'thread-start-response-reuses-archived-id' }; }
      activeThreadId = result.threadId;
      threadLifecycleState = 'ACTIVE';
      currentTurn = null;
      retiredTurnIds.clear(); // R14: a freshly-activated thread starts with a clean replay lineage.
      return result;
    });
  }

  /**
   * `thread/resume` (PLAN.md ~L913-918, R5 addition -- previously entirely
   * unimplemented and unflagged as a gap). Exact params per PLAN's frozen
   * resume block; the generated `ThreadResumeResponse` is structurally
   * identical to `ThreadStartResponse` (same nested `thread: Thread`
   * pattern, confirmed against both the PREP-era capture and a fresh live
   * regeneration this session), so validation reuses the same helper. PLAN
   * notes a zero-turn resume is known to fail live ("no rollout found") --
   * this function does not itself retry or fall back to a fresh
   * `threadStart`; that policy decision belongs to the caller (C4's
   * eventual scheduler), not this transport-layer client.
   * @param {{threadId:string,developerInstructions:string,baseInstructions:string,cwd:string}} opts
   * @param {{timeoutMs?:number}} [timeoutOpts]
   */
  function threadResume(opts, timeoutOpts) {
    if (isTerminal()) return Promise.resolve({ ok: false, reason: 'connection-stopped' });
    if (phase !== 'AUTHENTICATED') { terminalStop('thread-resume-wrong-phase'); return Promise.resolve({ ok: false, reason: 'thread-resume-wrong-phase' }); }
    // R14 (Bloque A): at most one active root-chain thread -- same busy
    // guard as threadStart, checked BEFORE the soft dispatch-window
    // pre-check below (a genuinely busy/active lifecycle is itself a
    // proven pre-dispatch rejection, recoverable, never a STOP).
    if (threadLifecycleState !== 'IDLE') return Promise.resolve({ ok: false, reason: 'thread-lifecycle-busy' });
    // R14 point C1 (PLAN.md ~L934 "un rechazo demostrado antes de enviar
    // puede ser recoverable"): a soft, retriable pre-dispatch refusal
    // (refresh-flush-pending; a non-positive deadline) must never escalate
    // into a hard STOP -- only a genuine POST-dispatch failure does (see
    // below). Checked here, before committing to dispatch, mirroring
    // turnStart's own identical pre-check.
    const preDispatchWindow = computeDispatchWindow(timeoutOpts);
    if (!preDispatchWindow.ok) return Promise.resolve({ ok: false, reason: preDispatchWindow.reason });
    threadLifecycleState = 'THREAD_RESUME_PENDING';
    pendingThreadId = opts.threadId;
    const id = allocateId();
    return dispatchRequest(id, 'thread/resume', {
      threadId: opts.threadId,
      approvalPolicy: 'never',
      approvalsReviewer: 'user',
      baseInstructions: opts.baseInstructions,
      config: null,
      cwd: opts.cwd,
      developerInstructions: opts.developerInstructions,
      model: null,
      modelProvider: null,
      personality: null,
      sandbox: null,
      serviceTier: null,
    }, timeoutOpts).then((frameRes) => {
      // R8 (P0-1): see the identical comment in initialize()/threadStart().
      // R14 (Bloque A): see the identical fix in threadStart() -- terminal
      // takes priority regardless of frameRes.ok, so the real diagnostic
      // is never discarded in favor of a generic lost-tracking label.
      if (isTerminal()) return { ok: false, reason: frameRes.reason || stopReason };
      if (threadLifecycleState !== 'THREAD_RESUME_PENDING') return { ok: false, reason: 'thread-resume-lost-tracking' };
      const result = validateThreadStartLikeResponse(frameRes, opts.cwd, 'thread-resume', { requireNonEmptyTurns: true, expectedThreadId: opts.threadId });
      // R14 point C1: ANY post-dispatch resume failure -- error response,
      // timeout, EOF, or an invalid/mismatched response -- is a hard STOP.
      // Per PLAN.md line 934, a nested same-thread continuation STOPs
      // rather than silently substituting a fresh thread/start's identity;
      // the caller decides whether to retain the original handle or start
      // an independent thread, at a layer outside this connection.
      if (!result.ok) { terminalStop('thread-resume-invalid:' + result.reason); return result; }
      if (result.threadId === lastArchivedThreadId) { terminalStop('thread-resume-response-reuses-archived-id'); return { ok: false, reason: 'thread-resume-response-reuses-archived-id' }; }
      pendingThreadId = null;
      activeThreadId = result.threadId;
      threadLifecycleState = 'ACTIVE';
      currentTurn = null;
      retiredTurnIds.clear();
      return result;
    });
  }

  /**
   * Shared `ThreadStartResponse`/`ThreadResumeResponse` validator -- both
   * are structurally identical (`{thread:Thread, model, modelProvider, cwd,
   * instructionSources, approvalPolicy, approvalsReviewer, sandbox, ...}`).
   *
   * R14 (Codex NO-GO, Bloque B): the generated schema validator is now the
   * FIRST choke point, before any hand-rolled check runs. It proves every
   * structural constraint the real pinned JSON Schema defines -- required
   * fields, `additionalProperties:false`, exact field typing (including
   * integer-vs-float, which the old hand-rolled `typeof x === 'number'`
   * checks could never distinguish -- reproduced empirically: a response
   * with `thread.createdAt: 1.5` was wrongly accepted before this fix),
   * and every nested shape (Thread, SessionSource, SubAgentSource, and each
   * persisted Turn/ThreadItem). Business rules that are NOT part of the
   * generic schema -- the exact required `approvalPolicy`/cwd-matching/
   * sandbox shape/thread identity/idle-vs-turn-count rules PLAN.md itself
   * freezes -- still run afterward, with their own granular reason
   * strings, exactly as before.
   */
  function validateThreadStartLikeResponse(frameRes, expectedCwd, reasonPrefix, respOpts) {
    // `frameRes.reason` (timeout / write-failed-confirmed-before-commit /
    // a transport-fail-closed reason) is a MORE SPECIFIC diagnostic than a
    // generic "-error-response" and must survive, not be overwritten --
    // only a genuine {ok:false,error:{...}} JSON-RPC error (no `.reason`)
    // falls back to the generic label.
    if (!frameRes.ok) return { ok: false, reason: frameRes.reason || (reasonPrefix + '-error-response') };
    const r = frameRes.result;
    const rootKey = reasonPrefix === 'thread-resume' ? 'v2::ThreadResumeResponse' : 'v2::ThreadStartResponse';
    if (!r || typeof r !== 'object' || Array.isArray(r) || !generated.roots[rootKey](r)) return { ok: false, reason: reasonPrefix + '-response-schema-invalid' };
    const thread = r.thread;
    if (r.approvalPolicy !== 'never' || r.approvalsReviewer !== 'user') return { ok: false, reason: reasonPrefix + '-wrong-approval-policy' };
    if (r.cwd !== expectedCwd) return { ok: false, reason: reasonPrefix + '-cwd-mismatch' };
    if (!r.sandbox || r.sandbox.type !== 'readOnly' || r.sandbox.networkAccess !== false) return { ok: false, reason: reasonPrefix + '-wrong-sandbox' };
    // R10: instructionSources carries `default:[]` and is NOT in
    // ThreadStartResponse's real `required` array -- omitted entirely is
    // valid (defaults to empty), not just "present and empty". (Presence-
    // and-type are already proven by the generated validator above; only
    // the EMPTINESS business rule is checked here.)
    if (Object.prototype.hasOwnProperty.call(r, 'instructionSources') && r.instructionSources.length !== 0) return { ok: false, reason: reasonPrefix + '-nonempty-instruction-sources' };
    // R7: the nested Thread object carries its OWN cwd/modelProvider/status
    // (prep/phase-a/codex-schema/ts-run1/v2/Thread.ts) -- PLAN.md ~L934
    // "matching cwd/provider" requires these to agree with the top-level
    // fields just checked above, never validated at only one level.
    if (thread.cwd !== expectedCwd || thread.cwd !== r.cwd) return { ok: false, reason: reasonPrefix + '-thread-cwd-mismatch' };
    if (thread.modelProvider !== r.modelProvider) return { ok: false, reason: reasonPrefix + '-thread-provider-mismatch' };
    if (!thread.status || thread.status.type !== 'idle') return { ok: false, reason: reasonPrefix + '-thread-status-not-idle' };
    if (thread.ephemeral !== false) return { ok: false, reason: reasonPrefix + '-not-ephemeral-false' };
    if (respOpts && respOpts.requireNonEmptyTurns) {
      if (respOpts.expectedThreadId !== undefined && thread.id !== respOpts.expectedThreadId) return { ok: false, reason: reasonPrefix + '-thread-id-substitution' };
      if (!Array.isArray(thread.turns) || thread.turns.length === 0) return { ok: false, reason: reasonPrefix + '-zero-turn-resume-rejected' };
      // Per-item schema validity is already proven by the generated
      // validator above (it compiles the full nested tree, including
      // thread.turns[].items[]) -- no separate per-turn loop needed.
    } else {
      if (!Array.isArray(thread.turns) || thread.turns.length !== 0) return { ok: false, reason: reasonPrefix + '-not-idle' };
    }
    return { ok: true, threadId: thread.id };
  }

  /**
   * `turn/start` (PLAN.md ~L919-926, validation ~L932). `TurnStartResponse`
   * is exactly `{turn: Turn}` -- `id`/`status`/`items` are nested inside
   * `result.turn`, never flat on `result` (R5 correction). Because the
   * response carries no `threadId`, the caller supplies it and this
   * function is the frame-ID<->thread-ID correlation point the PLAN
   * describes ("the host maps frame ID -> thread ID"); `onTurnCompleted`
   * below is registered separately by the caller, keyed on `(threadId,
   * turnId)`, once `turnId` is known from this call's own result.
   *
   * R8 (item 6): `outputSchema` is built INTERNALLY via the single
   * canonical `runtimeTurnEnvelopeSchema(expectedResultKind,
   * allowedChildRoles)` (imported from runtime-consultation.cjs, bucket F)
   * -- a caller can no longer inject an arbitrary schema object, which would
   * otherwise defeat the entire closed-shape guarantee `outputSchema` exists
   * to enforce on the model's own response.
   * @param {{threadId:string,inputText:string,expectedResultKind:string,allowedChildRoles:string[],cwd:string}} opts
   * @param {{timeoutMs?:number}} [timeoutOpts]
   */
  function turnStart(opts, timeoutOpts) {
    if (isTerminal()) return Promise.resolve({ ok: false, reason: 'connection-stopped' });
    if (phase !== 'AUTHENTICATED') { terminalStop('turn-start-wrong-phase'); return Promise.resolve({ ok: false, reason: 'turn-start-wrong-phase' }); }
    if (threadLifecycleState !== 'ACTIVE' || activeThreadId !== opts.threadId) { terminalStop('turn-start-thread-not-known'); return Promise.resolve({ ok: false, reason: 'turn-start-thread-not-known' }); }
    // R14 (Bloque A): a NEW turn may only start once the current one (if
    // any) has reached its one authoritative delivery -- mirrors
    // turn-state-model.cjs's beginTurn() guard exactly, replacing the old
    // `threadTurnInFlight.has()` presence check.
    if (!isCurrentTurnSafelyTerminal()) { terminalStop('turn-start-already-in-flight-for-thread'); return Promise.resolve({ ok: false, reason: 'turn-start-already-in-flight-for-thread' }); }
    // R9 (post-P0-3 hardening): check the SAME window dispatchRequest itself
    // will check, BEFORE committing currentTurn -- a non-terminal,
    // RETRIABLE refusal (refresh-flush-pending; a non-positive deadline)
    // must never permanently mark this thread in flight for a request that
    // was never actually sent. Nothing async happens between this check and
    // dispatchRequest's own identical one below, so this can never observe
    // a different answer than dispatchRequest itself will.
    const window = computeDispatchWindow(timeoutOpts);
    if (!window.ok) return Promise.resolve({ ok: false, reason: window.reason });
    const id = allocateId();
    // C5: frame ID<->thread ID bound BEFORE the write. R14: this is the ONE
    // current-turn record; responseObserved/completion/handlerEntry are its
    // three orthogonal delivery prerequisites, startedObserved tracks
    // turn/started-duplicate/after-completion STOP conditions.
    // turnStartRequestId (R14, Codex NO-GO 2026-07-18, P0): the dispatched
    // request id, kept on this SAME single record -- lets the frame-dispatch
    // loop recognize a second response sharing this id as a duplicate of
    // THIS turn's own request, without a second id authority or an
    // unbounded registry.
    currentTurn = { turnId: null, responseObserved: false, completion: null, handlerEntry: null, startedObserved: false, refreshDeferralEpoch: null, state: 'IN_PROGRESS', turnStartRequestId: id };
    const outputSchema = runtimeTurnEnvelopeSchema(opts.expectedResultKind, opts.allowedChildRoles);
    return dispatchRequest(id, 'turn/start', {
      threadId: opts.threadId,
      input: [{ type: 'text', text: opts.inputText, text_elements: [] }],
      approvalPolicy: 'never',
      approvalsReviewer: 'user',
      cwd: opts.cwd,
      effort: null,
      model: null,
      outputSchema,
      personality: null,
      sandboxPolicy: null,
      serviceTier: null,
      summary: 'none',
    }, timeoutOpts).then((frameRes) => {
      const fail = (reason) => { terminalStop('turn-start-invalid:' + reason); return { ok: false, reason }; };
      // R8 (P0-1): see the identical comment in initialize().
      // R14 (Bloque A): see the identical fix in threadStart() -- terminal
      // takes priority regardless of frameRes.ok, so the real diagnostic is
      // never discarded in favor of a generic lost-tracking label.
      if (isTerminal()) return { ok: false, reason: frameRes.reason || stopReason };
      const t = currentTurn;
      if (!t) return fail('turn-start-lost-tracking'); // currentTurn is null and yet we are NOT terminal -- an invariant violation that should never legitimately occur.
      if (!frameRes.ok) return fail(frameRes.reason || 'turn-start-error-response');
      const r = frameRes.result;
      // R14 (Codex NO-GO 2026-07-18, Bloque B): the generated root validator
      // is now the FIRST choke point for the whole {turn:Turn} shape
      // (including every nested item), subsuming the old separate
      // missing-turn/turn-schema-invalid checks. Empty-turn-id remains a
      // distinct business rule below -- the schema itself has no minLength.
      if (!r || typeof r !== 'object' || Array.isArray(r) || !generated.roots['v2::TurnStartResponse'](r)) return fail('turn-start-response-schema-invalid');
      if (r.turn.id.length === 0) return fail('turn-start-empty-turn-id');
      if (t.state === 'DELIVERED') return fail('rpc-response-after-delivered');
      if (t.responseObserved) return fail('duplicate-rpc-response');
      // R8 (item 4/P0 follow-up): a `turn/started` notification may have
      // already bound a DIFFERENT turn id for this thread (a genuine race --
      // the notification and this RPC response are independent wire
      // events). The response can never silently SUBSTITUTE a conflicting
      // id as authority; that is exactly the "un pair arbitrario nunca
      // puede registrarse como autoridad" violation C6 exists to prevent,
      // just approached from the response side instead of the notification
      // side. R14 (replay fence): binding also rejects an id this thread's
      // lineage already retired -- a genuine replay, never a silent rebind.
      const bind = bindOrVerifyCurrentTurnId(r.turn.id);
      if (!bind.ok) return fail(bind.retiredReplay ? 'turn-start-response-turn-id-replay-of-retired-id' : 'turn-start-response-conflicting-turn-id');
      // R14 (Bloque A, Codex NO-GO finding #1): `responseObserved` is now a
      // REQUIRED third prerequisite for delivery, not merely bookkeeping --
      // reproduced empirically before this fix: with this exact RPC
      // response still pending, a turn/completed notification plus a
      // registered handler alone delivered `{ok:true}`. tryDeliverCurrentTurn
      // now requires all three (response, completion, handler) regardless
      // of arrival order.
      t.responseObserved = true;
      tryDeliverCurrentTurn();
      if (isTerminal()) return { ok: false, reason: stopReason }; // cap exhaustion or another STOP triggered by the delivery attempt above.
      return { ok: true, turnId: r.turn.id };
    });
  }

  /**
   * Registers the terminal handler for exactly one (threadId, turnId) pair.
   *
   * R8 (P0-2, Codex NO-GO): this used to LAZILY seed authority for ANY
   * (threadId,turnId) pair with no prior tracking at all -- meaning a
   * caller (or a confused/compromised upstream component) could invent an
   * arbitrary pair in phase NEW, with no `initialize`/`login`/`turnStart`
   * ever having happened, and a matching `turn/completed` frame would still
   * deliver `{ok:true,envelope}` as if it were an authorized result.
   * Reproduced and confirmed empirically before this fix. Authority for a
   * pair now REQUIRES `threadLifecycleState === 'ACTIVE'` with
   * `activeThreadId === threadId` AND a live `currentTurn` record already
   * allocated by this connection's own `turnStart()` call -- never lazily
   * created by this function itself. An unknown/inactive thread, or one
   * with no in-flight turn, is a silent no-op registration (C6: "un pair
   * arbitrario nunca puede registrarse como autoridad").
   *
   * R14 (Bloque A): authority now lives in the single `currentTurn` record
   * -- there is no separate handler map to fall out of sync with it. If a
   * matching completion already arrived (item 4: `turn/completed` racing
   * ahead of `turnStart`'s own response resolving to the caller),
   * `tryDeliverCurrentTurn()` delivers it immediately instead of waiting
   * for a live notification that will never come again.
   *
   * R14 (Codex NO-GO 2026-07-18, Bloque A1): a KNOWN, currently-tracked
   * turn (an active thread with a live `currentTurn`) rejecting a
   * conflicting/retired/already-delivered registration is a genuine
   * protocol violation, not noise -- it now STOPs, mirroring
   * turn-state-model.cjs's `registerHandler()` exactly (delivered / occupied
   * / duplicate / conflicting-or-retired, in that order). Only a genuinely
   * UNKNOWN or inactive THREAD (no tracked authority to violate at all)
   * remains a silent no-op, per C6 "un pair arbitrario nunca puede
   * registrarse como autoridad".
   * @param {string} threadId
   * @param {string} turnId
   * @param {string} expectedResultKind
   * @param {string[]} allowedChildRoles
   * @param {(res:{ok:boolean,envelope?:object,reason?:string}) => void} handler
   */
  function onTurnCompleted(threadId, turnId, expectedResultKind, allowedChildRoles, handler) {
    if (isTerminal()) return;
    // P0-2: never lazily seed authority for a thread this connection does
    // not currently recognize as active.
    if (threadLifecycleState !== 'ACTIVE' || activeThreadId !== threadId) return;
    const t = currentTurn;
    if (!t) return; // no turn dispatched yet -- nothing to register against.
    if (t.state === 'DELIVERED') { terminalStop('handler-registration-after-delivered'); return; }
    // R14 (Codex NO-GO 2026-07-18, Bloque A2): no handler may ever acquire
    // delivery authority once interruption has begun or completed --
    // "ningun handler puede entregar autoridad despues de interruptRequested."
    if (t.state === 'INTERRUPT_PENDING' || t.state === 'INTERRUPTED') { terminalStop('handler-registration-after-interrupt'); return; }
    if (t.state === 'DEFERRED_FOR_REFRESH') { terminalStop('second-handler-for-occupied-slot'); return; }
    // R14: a second registration for a turn id that already has a LIVE
    // (not-yet-delivered) handler must never silently overwrite the first
    // -- that would drop the original caller's own handler with no trace.
    if (t.handlerEntry !== null) { terminalStop('duplicate-turn-completed-handler-registration'); return; }
    const bind = bindOrVerifyCurrentTurnId(turnId);
    if (!bind.ok) { terminalStop((bind.retiredReplay ? 'turn-notification-turn-id-replay-of-retired-id:' : 'turn-notification-conflicting-turn-id:') + 'onTurnCompleted'); return; }
    t.handlerEntry = { expectedResultKind, allowedChildRoles, handler };
    tryDeliverCurrentTurn();
  }

  /**
   * `turn/interrupt` -- exact `{threadId,turnId}` params. Only from phase
   * AUTHENTICATED, and only for a thread/turn this connection itself
   * genuinely owns and has correlated (R8 item 12): `threadLifecycleState`
   * must be `ACTIVE` with `activeThreadId === threadId`.
   * `TurnInterruptResponse` is `Record<string,never>` -- the wrapper must
   * carry exactly an empty-object `result`, not merely any truthy value (C9).
   *
   * R14 (Codex NO-GO 2026-07-18, Bloque A2): interrupt is now part of the
   * SAME single `currentTurn` state machine, not a second parallel
   * authority. Reproduced empirically before this fix: with `turnId` still
   * `null` (the turn/start response not yet observed), a caller-chosen,
   * never-accredited id was accepted and DISPATCHED TO THE WIRE -- the old
   * guard `currentTurn.turnId !== null && currentTurn.turnId !== turnId`
   * is trivially false whenever `turnId` is still null, regardless of what
   * the caller supplies. Interrupt now REQUIRES the turn to be genuinely
   * accredited: `responseObserved===true` AND a non-null `turnId` EXACTLY
   * equal to the caller's -- an unaccredited pair writes ZERO bytes and
   * fails closed, same as a conflicting one.
   *
   * Also reproduced empirically: a fully successful interrupt left the
   * turn's `state` untouched (`IN_PROGRESS`), so a late `turn/completed`
   * still delivered `{ok:true,envelope}` -- directly violating PLAN.md's
   * "Failed/interrupted/mismatched/duplicate/conflicting/late frames never
   * produce a result." `state` now flips to `INTERRUPT_PENDING`
   * IRREVOCABLY BEFORE the wire write (so even a race with an
   * already-buffered completion+handler can never still deliver -- see
   * `tryDeliverCurrentTurn`'s own defensive check), and a successful
   * response retires the turn id exactly once and moves to the terminal
   * `INTERRUPTED` state, safe to archive from (`isCurrentTurnSafeToArchive`)
   * but deliberately NOT safe to start a bare new turn from
   * (`isCurrentTurnSafelyTerminal` excludes it) -- PLAN.md's own
   * closure/recovery contract requires archive first.
   */
  function turnInterrupt(threadId, turnId, timeoutOpts) {
    if (isTerminal()) return Promise.resolve({ ok: false, reason: 'connection-stopped' });
    if (phase !== 'AUTHENTICATED') { terminalStop('turn-interrupt-wrong-phase'); return Promise.resolve({ ok: false, reason: 'turn-interrupt-wrong-phase' }); }
    if (threadLifecycleState !== 'ACTIVE' || activeThreadId !== threadId) { terminalStop('turn-interrupt-thread-not-known'); return Promise.resolve({ ok: false, reason: 'turn-interrupt-thread-not-known' }); }
    const t = currentTurn;
    if (!t || !t.responseObserved || t.turnId === null || t.turnId !== turnId) { terminalStop('turn-interrupt-turn-not-correlated'); return Promise.resolve({ ok: false, reason: 'turn-interrupt-turn-not-correlated' }); }
    if (t.state !== 'IN_PROGRESS' && t.state !== 'DEFERRED_FOR_REFRESH') { terminalStop('turn-interrupt-turn-not-interruptible'); return Promise.resolve({ ok: false, reason: 'turn-interrupt-turn-not-interruptible' }); }
    // Irrevocable from this exact point on -- BEFORE any wire byte is written.
    t.state = 'INTERRUPT_PENDING';
    const id = allocateId();
    return dispatchRequest(id, 'turn/interrupt', { threadId, turnId }, timeoutOpts).then((frameRes) => {
      // R8 (P0-1): see the identical comment in initialize().
      if (isTerminal() && frameRes.ok) return { ok: false, reason: stopReason };
      if (!frameRes.ok) { const reason = frameRes.reason || 'turn-interrupt-error-response'; terminalStop('turn-interrupt-failed:' + reason); return { ok: false, reason }; }
      // R14 (Codex NO-GO 2026-07-18, Bloque B): schema gate first, per the
      // bundle contract -- the real TurnInterruptResponse schema is just a
      // bare `{type:"object"}` with no additionalProperties:false, so this
      // alone would accept almost anything; the exact-empty-object business
      // rule immediately below remains the real enforcement (C9).
      if (!frameRes.result || typeof frameRes.result !== 'object' || Array.isArray(frameRes.result) || !generated.roots['v2::TurnInterruptResponse'](frameRes.result)) { terminalStop('turn-interrupt-result-schema-invalid'); return { ok: false, reason: 'turn-interrupt-result-schema-invalid' }; }
      if (!hasExactKeys(frameRes.result, [])) { terminalStop('turn-interrupt-result-not-empty-object'); return { ok: false, reason: 'turn-interrupt-result-not-empty-object' }; }
      // Successful interrupt: retire the turn id exactly once, then the
      // terminal INTERRUPTED state -- mirrors tryDeliverCurrentTurn's own
      // once-only retirement-then-terminal-state sequencing exactly.
      if (!retireTurnId(t.turnId)) return { ok: false, reason: stopReason }; // cap exhaustion STOPs internally.
      t.state = 'INTERRUPTED';
      return { ok: true };
    });
  }

  /**
   * `thread/archive` -- exact `{threadId}` params. Only from phase
   * AUTHENTICATED, and only for a thread this connection itself genuinely
   * owns (R8 item 12: `threadLifecycleState === 'ACTIVE'` with
   * `activeThreadId === threadId`). `ThreadArchiveResponse` is likewise
   * `Record<string,never>` (C9). On success, clears the single
   * `threadLifecycleState`/`activeThreadId`/`currentTurn` record wholesale
   * (E3 "se limpian en archive y STOP") -- there is no separate handler or
   * buffered-completion map that could be left stale behind it.
   */
  function threadArchive(threadId, timeoutOpts) {
    if (isTerminal()) return Promise.resolve({ ok: false, reason: 'connection-stopped' });
    if (phase !== 'AUTHENTICATED') { terminalStop('thread-archive-wrong-phase'); return Promise.resolve({ ok: false, reason: 'thread-archive-wrong-phase' }); }
    if (threadLifecycleState !== 'ACTIVE' || activeThreadId !== threadId) { terminalStop('thread-archive-thread-not-known'); return Promise.resolve({ ok: false, reason: 'thread-archive-thread-not-known' }); }
    // R14 (archive-refuses-unsafe-turn): never archive out from under a turn
    // that has not yet fully delivered -- refuse before ever touching the
    // wire, erasing nothing, so the turn can still complete normally. This
    // is a recoverable refusal (not a STOP): the caller may retry once the
    // turn is safely terminal. Mirrors turn-state-model.cjs's archiveSuccess
    // guard exactly, now against the single consolidated `currentTurn`.
    // R14 (Codex NO-GO 2026-07-18, Bloque A2): uses the WIDER
    // isCurrentTurnSafeToArchive -- a genuinely INTERRUPTED turn (terminal,
    // id already retired) is also safe to archive from, closing the thread
    // per PLAN.md's closure/recovery contract; INTERRUPT_PENDING itself is
    // deliberately still refused (the interrupt's own outcome is not yet known).
    if (!isCurrentTurnSafeToArchive()) return Promise.resolve({ ok: false, reason: 'thread-archive-refused-turn-in-flight' });
    const id = allocateId();
    return dispatchRequest(id, 'thread/archive', { threadId }, timeoutOpts).then((frameRes) => {
      // R8 (P0-1): see the identical comment in initialize().
      // R14 (Bloque A): see the identical fix in threadStart() -- terminal
      // takes priority regardless of frameRes.ok, so the real diagnostic
      // is never discarded in favor of a generic lost-tracking label.
      if (isTerminal()) return { ok: false, reason: frameRes.reason || stopReason };
      if (threadLifecycleState !== 'ACTIVE' || activeThreadId !== threadId) return { ok: false, reason: 'thread-archive-lost-tracking' }; // not terminal, yet the tracked thread changed underneath us -- an invariant violation that should never legitimately occur.
      if (!frameRes.ok) { const reason = frameRes.reason || 'thread-archive-error-response'; terminalStop('thread-archive-failed:' + reason); return { ok: false, reason }; }
      // R14 (Codex NO-GO 2026-07-18, Bloque B): schema gate first, same
      // reasoning as turnInterrupt above -- ThreadArchiveResponse is also a
      // bare `{type:"object"}`, so the exact-empty-object check remains the
      // real enforcement (C9).
      if (!frameRes.result || typeof frameRes.result !== 'object' || Array.isArray(frameRes.result) || !generated.roots['v2::ThreadArchiveResponse'](frameRes.result)) { terminalStop('thread-archive-result-schema-invalid'); return { ok: false, reason: 'thread-archive-result-schema-invalid' }; }
      if (!hasExactKeys(frameRes.result, [])) { terminalStop('thread-archive-result-not-empty-object'); return { ok: false, reason: 'thread-archive-result-not-empty-object' }; }
      // R14: successful archive resets ALL active-thread state at once --
      // the single consolidated record, not several independent structures.
      lastArchivedThreadId = threadId;
      activeThreadId = null;
      currentTurn = null;
      threadLifecycleState = 'IDLE';
      retiredTurnIds.clear(); // a FUTURE thread/start reusing this same server-side id starts with a clean slate, matching turn-state-model.cjs's archiveSuccess.
      return { ok: true };
    });
  }

  // R8 (item 3, Codex NO-GO): `sendRequest`/`sendNotification` used to be
  // exported as raw, ungated escape hatches -- `sendRequest` could dispatch
  // ANY method (e.g. 'thread/start') bypassing every phase/ownership check
  // the dedicated methods above enforce, consuming a frame id in the
  // process; `sendNotification` had NO isTerminal() gate at all and could
  // still write bytes after STOP. Neither is used internally by this
  // module's own dedicated methods (each calls `dispatchRequest`/
  // `writeJsonlFrame` directly with its own gating already applied), so
  // eliminating them from the public surface removes the escape hatch
  // entirely rather than merely gating it.
  return {
    initialize,
    login,
    threadStart,
    threadResume,
    turnStart,
    onTurnCompleted,
    turnInterrupt,
    threadArchive,
    onNotification,
    isStopped: () => isTerminal(),
    stopReason: () => stopReason,
    connectionPhase: () => phase,
  };
}

// R7 (F1-F5): `buildRuntimeTurnEnvelopeOutputSchema`/`validateRuntimeTurnEnvelope`
// used to be defined here. They now live exactly once in
// runtime-consultation.cjs as `runtimeTurnEnvelopeSchema`/
// `validateRuntimeTurnEnvelope` (imported at the top of this file as `rc`)
// -- this file re-exports them below under its existing public names rather
// than keeping a second copy.

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
  createJsonlFrameFeeder,
  writeJsonlFrame,
  createAppServerConnection,
  buildRuntimeTurnEnvelopeOutputSchema: runtimeTurnEnvelopeSchema,
  validateRuntimeTurnEnvelope,
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
