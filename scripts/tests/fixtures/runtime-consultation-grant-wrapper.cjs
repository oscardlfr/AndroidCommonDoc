#!/usr/bin/env node
'use strict';

// M7/WP4 Phase B.3 regression fixture (dispatch arch-testing-20260809T092330Z);
// extended to the FULL 18-command matrix by M7 completeness (2026-08-09,
// dispatch team-lead-20260809-final-completeness, task #24) once
// runtime-consultation.cjs's own ROLE_COMMAND_GRANT_AUTHORITY_FOR_COMMAND
// landed all 14 requester + 4 target subcommands. Transparent grant-injecting
// wrapper around scripts/lib/runtime-consultation.cjs, for the pre-existing
// suites (runtime-consultation-cli.bats/.test.js, runtime-consultation-state.bats,
// runtime-consultation-roots.bats) that predate the M7/WP4 role-command-grant/v1
// mandatory-grant requirement (PLAN.md §15b). runtime-consultation-protocol.bats
// does NOT use this wrapper (zero references, confirmed) -- it is fixed
// separately, per-test, not through this file.
//
// Drop-in CLI-shape replacement for `node runtime-consultation.cjs <subcommand>
// ...`: for every one of the 18 gated subcommands, mints a REAL,
// correctly-scoped grant via the SAME production primitives the real hooks use
// (rll.createRequesterBinding / rll.createRoleActorBinding + rll.mintRoleCommandGrant),
// with a canonical_argv_digest computed over EXACTLY the argv this invocation is about
// to send (`rest`, i.e. every token after the subcommand) -- mirroring
// context-provider-gate.js's tryInjectRequesterGrant and
// runtime-consultation-target-gate.js's handleConsultationTargetOwning
// byte-for-byte (`rc.sha256String(rc.canonicalJSONStringify(rest))`). This
// wrapper never judges argv validity -- a deliberately incomplete/malformed
// `rest` still gets a grant whose digest matches THAT exact (possibly
// malformed) argv, so a pre-existing argv-validation test still reaches its
// OWN original assertion point (requireFlags/enum checks/etc.) exactly as
// before grants existed; it does not change what happens downstream of a
// valid grant, only removes the new AUTHORITY_INVALID precondition wall.
// There are no non-gated subcommands left -- every PLAN.md §15b subcommand
// this file's own REQUESTER_GATED/TARGET_GATED sets name is now mint-eligible;
// the passthrough branch below exists only for a genuinely unrecognized
// subcommand string (e.g. a typo), never a designed-in gap.
//
// Never imported by production code or any hook -- purely additive,
// test-only infrastructure living under scripts/tests/fixtures/.
//
// Env vars (read ONLY by this wrapper):
//   RCC_GRANT_PROJECT_ROOT (optional -- see deriveProjectRootFromCoordinationRoot
//     for the fallback used when absent) -- the git worktree root a real hook
//     would resolve via CLAUDE_PROJECT_DIR; needs a real, discoverable PLAN.md
//     under .planning/wave-*/PLAN.md.
//   RCC_GRANT_SESSION (optional, default below) -- the runtime_session_key a
//     hook-observed identity would carry. Fixed across calls within one test
//     so repeated gated calls (e.g. claim then lease-heartbeat) share one
//     coherent session generation.
//   RCC_GRANT_AGENT_ID (optional, default 'runtime-consultation-grant-wrapper-agent',
//     resolved via `??` never `||` -- see resolveGrantAgentId below) -- the
//     agent_id a hook-observed identity would carry, passed as
//     createRequesterBinding's own agentKey. M6+M7 requester-authority
//     closure (Group A): createRequesterBinding now REJECTS an empty
//     agentKey outright, so this can no longer be the bare `''` this wrapper
//     used before -- a stable, non-empty, explicitly test-only default is
//     substituted ONLY when the env var is genuinely unset; an explicitly
//     empty value is passed straight through, so createRequesterBinding's
//     own rejection stays honest and observable, never silently papered over.
//   RCC_GRANT_ROLE (optional, default 'arch-testing') -- for root-init/
//     root-validate, the requester's own role. M7 completeness
//     (2026-08-09): a null/main-orchestrator-shaped requester role no
//     longer exists in production at all (createRequesterBinding's own role
//     parameter is NEVER null; the main-orchestrator/null-role path was
//     removed once CLAUDE-ID-01 excluded the main orchestrator from
//     requester-binding minting entirely) -- RCC_GRANT_ROLE='' therefore no
//     longer represents any valid, mintable identity; it stays supported
//     here only as a pass-through to createRequesterBinding's own honest
//     invalid-role rejection, never as a working configuration. For
//     lease-heartbeat/publish-result/worker-stop-ack (which carry no --role
//     of their own), the acting role a fresh RoleActorBinding is minted
//     for; claim's own --role argv value is used instead when present, so
//     one call is never internally inconsistent between its argv and its
//     own minted identity.
//   RCC_GRANT_PROVIDER (optional, default 'codex-supervisor') -- M6+M7 FULL
//     CLOSURE (2026-08-11, dispatch team-lead "FULL CLOSURE"): the REQUESTER_GATED
//     branch's own opener identity.provider, fed to createRequesterBinding
//     (never the TARGET_GATED branch below, which mints via
//     createRoleActorBinding -- a function with no provider/identity concept
//     at all, confirmed by direct read, so it is structurally unaffected by
//     this env var). Defaults to 'codex-supervisor' -- a provider CLAUDE-ID-01
//     never gates (PLAN.md ~L588 scopes the bounded-proof requirement to
//     identity.provider==='claude-hook' specifically) -- so this wrapper's own
//     hundreds of pre-existing callers (testing generic CLI/grant round-trip
//     mechanics: tamper/replay/expiry/authority-swap/scope-mismatch/argv
//     grammar, never Claude-specific identity proof) keep minting successfully
//     once createRequesterBinding itself is gated on CLAUDE-ID-01, with zero
//     per-test changes. The small minority of tests that genuinely need a
//     claude-hook-provider grant (e.g. proving CLAUDE-ID-01-adjacent behavior)
//     opt in explicitly via RCC_GRANT_PROVIDER=claude-hook, mirroring this
//     file's own established RCC_GRANT_* override convention.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync, execFileSync } = require('child_process');
const rll = require('../../lib/runtime-role-lifecycle.cjs');
const rc = require('../../lib/runtime-consultation.cjs');
const rbc = require('../../lib/runtime-bridge-codex.cjs');

const REAL_CLI = path.resolve(__dirname, '../../lib/runtime-consultation.cjs');
const ROLE_LIFECYCLE_CLI = path.resolve(__dirname, '../../lib/runtime-role-lifecycle.cjs');
const RETAINED_SUPPORT_ROLES = Object.freeze([
  'arch-platform', 'arch-testing', 'arch-integration', 'context-provider', 'doc-updater',
]);

/**
 * Test-only prerequisite builder for Sixteenth joined surface tests. It
 * drives the real five-role ensure/claim/READY primitives and publishes the
 * exact process-owner evidence production routing requires. The root ingress
 * under test is still created only by its real hook/CLI surface; this helper
 * supplies the already-accepted retained support plane, never the root
 * action/request/binding being asserted.
 */
function establishRetainedCodexSupportPlane(projectRoot, mainBinding) {
  projectRoot = fs.realpathSync(projectRoot);
  const roles = RETAINED_SUPPORT_ROLES.slice().sort();
  const grant = rll.mintLifecycleCommandGrant(
    projectRoot, mainBinding, rc.sha256String('ensure:' + roles.join(',')), roles,
    'ensure', 'main-orchestrator', 'orchestrator', 'normal', null,
  );
  if (!grant.ok) throw new Error('retained-plane ensure grant failed: ' + JSON.stringify(grant));
  const argv = [ROLE_LIFECYCLE_CLI, 'ensure', '--project-root', projectRoot];
  for (const role of RETAINED_SUPPORT_ROLES) argv.push('--role', role);
  argv.push('--lifecycle-binding', grant.grantId);
  const ensured = spawnSync(process.execPath, argv, {
    encoding: 'utf8',
    env: Object.assign({}, process.env, { RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES: '["codex-app-server"]' }),
  });
  if (ensured.status !== 0) throw new Error('retained-plane ensure failed: ' + JSON.stringify(ensured));
  const envelope = JSON.parse(String(ensured.stdout).trim());
  const advertised = envelope.actions.find((candidate) => candidate.kind === 'supervisor-start');
  if (!advertised) throw new Error('retained-plane supervisor action absent: ' + ensured.stdout);
  const found = rll.findActionAcrossRepos(advertised.action_id);
  if (!found.ok || found.absent) throw new Error('retained-plane action lookup failed: ' + JSON.stringify(found));
  const action = found.action;
  const repoDescriptor = { repoId: rll.computeRepoId(projectRoot) };
  const claim = rll.mintSupervisorExecutionClaim(repoDescriptor, action, mainBinding.binding_id, 120);
  if (!claim.ok) throw new Error('retained-plane claim failed: ' + JSON.stringify(claim));
  const evidence = roles.map((role) => {
    const workerSessionId = crypto.randomBytes(16).toString('hex');
    const now = new Date();
    const record = {
      schema: 'coordination/worker-presence/v1', role,
      worker_session_id: workerSessionId, worktree_id: action.worktree_id,
      thread_id: 's16-thread-' + workerSessionId,
      role_profile_digest: rll.roleProfileDigestFor(role), pid: process.pid,
      started_at: now.toISOString(), heartbeat_at: now.toISOString(),
      lease_expiry: new Date(now.getTime() + 60_000).toISOString(),
    };
    const recordPath = path.join(rll.registryRepoDir(projectRoot), 'workers', role, workerSessionId, 'presence.json');
    const written = rll.writeRegistryRecordReplace(recordPath, Buffer.from(JSON.stringify(record), 'utf8'));
    if (!written.ok) throw new Error('retained-plane presence failed for ' + role + ': ' + JSON.stringify(written));
    return { role, worker_session_id: workerSessionId };
  });
  const priorReady = process.env.RUNTIME_ROLE_LIFECYCLE_TEST_BATCH_READY_CAPABILITY;
  process.env.RUNTIME_ROLE_LIFECYCLE_TEST_BATCH_READY_CAPABILITY = 's16-shared-retained-plane-capability';
  const pidIdentity = rbc.defaultProcessIdentityProvider();
  const transitioned = rll.transitionSupervisorBatchToReady(repoDescriptor, action, roles, evidence, pidIdentity);
  if (priorReady === undefined) delete process.env.RUNTIME_ROLE_LIFECYCLE_TEST_BATCH_READY_CAPABILITY;
  else process.env.RUNTIME_ROLE_LIFECYCLE_TEST_BATCH_READY_CAPABILITY = priorReady;
  if (!transitioned.ok) throw new Error('retained-plane READY failed: ' + JSON.stringify(transitioned));
  const coordinationRootId = rll.computeCoordinationRootId(projectRoot);
  const rendezvousInstanceId = crypto.randomBytes(16).toString('hex');
  const supervisorInstanceId = crypto.randomBytes(16).toString('hex');
  for (const role of roles) {
    const owner = rbc.claimRoleOwner(
      repoDescriptor, coordinationRootId, role,
      rendezvousInstanceId, supervisorInstanceId, pidIdentity,
    );
    if (!owner.ok) throw new Error('retained-plane owner failed for ' + role + ': ' + JSON.stringify(owner));
  }
  for (const role of ['arch-platform', 'context-provider']) {
    const live = rbc.resolveLiveCodexAppServerWorker(projectRoot, role, rll.roleProfileDigestFor(role));
    if (!live.ok || !live.available) throw new Error('retained-plane worker unavailable for ' + role + ': ' + JSON.stringify(live));
  }
  return { action, evidence, pidIdentity };
}

// M7 completeness (2026-08-09): extended to the FULL PLAN.md §15b requester
// matrix once runtime-consultation.cjs's own ROLE_COMMAND_GRANT_AUTHORITY_FOR_COMMAND
// landed all 14 (see that constant's own comment).
//
// M6+M7 requester-authority closure (Group B, superseding the paragraph this
// replaces): core NOW DOES cross-reference request_id/attempt_id/lease_epoch
// against real transaction state for a grant's transactional subcommands --
// null/null/null is correct ONLY for the non-transaction administrative
// subcommands (root-init, root-validate, publish-blob, publish-request --
// none of which operate against an existing request). Every transactional
// subcommand (dispatch, record-delivery, takeover, await-result,
// accept-result, transaction-ack, cancel, worker-stop, cleanup, validate)
// must instead mint with the EXACT current triple, resolved the SAME way
// context-provider-gate.js's own tryInjectRequesterGrant resolves it for a
// real hook-injected grant: via the ONE shared resolveRequesterGrantScope
// helper (runtime-consultation.cjs), never a second, wrapper-local
// reimplementation. worker-stop is its own distinct case within that:
// resolveRequesterGrantScope resolves it to a real transaction triple only
// when it targets one specific request; a session-shutdown worker-stop
// (no single transaction) still resolves to null/null/null, exactly like
// the admin subcommands.
const REQUESTER_GATED = new Set([
  'root-init', 'root-validate', 'publish-blob', 'publish-request', 'dispatch',
  'record-delivery', 'takeover', 'await-result', 'accept-result',
  'transaction-ack', 'cancel', 'worker-stop', 'cleanup', 'validate',
]);
const TARGET_GATED = new Set(['claim', 'lease-heartbeat', 'publish-result', 'worker-stop-ack']);

// Fallback scope resolution when RCC_GRANT_PROJECT_ROOT is not set (needed by
// callers -- e.g. runtime-consultation-cli.test.js's own spawnCli -- that
// invoke this wrapper directly via a fixed argv-building helper with no
// per-call env injection point of their own). Every gated subcommand this
// wrapper handles genuinely carries --coordination-root in `rest`; walks up
// from it to the DEEPEST EXISTING ancestor (mirrors runtime-consultation.cjs's
// own realpathDeepestExisting -- root-init's own --coordination-root
// legitimately does not exist yet) and resolves ITS enclosing git worktree,
// exactly mirroring assertRootConfinedToWorktree's own lookup. Returns null
// (never throws) if --coordination-root is absent or does not resolve to any
// git worktree -- the caller's own tryMintGrant degrades to a no-grant
// passthrough either way (see its own doc comment for why that is correct).
function deriveProjectRootFromCoordinationRoot(rest) {
  const idx = rest.indexOf('--coordination-root');
  if (idx === -1 || idx + 1 >= rest.length) return null;
  let candidate = path.resolve(rest[idx + 1]);
  while (true) {
    if (fs.existsSync(candidate)) break;
    const parent = path.dirname(candidate);
    if (parent === candidate) return null;
    candidate = parent;
  }
  try {
    return execFileSync('git', ['-C', candidate, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  } catch (e) {
    return null;
  }
}

// Deterministic-fault-injection / rendezvous env vars (isTestCapability()-gated,
// see runtime-consultation.cjs's own isDirFsyncFaultActive/isReplacePostRenameFaultActive/
// testRendezvous family) are GLOBAL to the whole process, not scoped to one
// specific caller's publishNoClobber/publishReplace call. This wrapper's OWN
// internal grant-minting (rll.createRequesterBinding/createRoleActorBinding/
// mintRoleCommandGrant) reuses those SAME shared, fd-bound durability
// primitives (runtime-role-lifecycle.cjs's own registry layer is built on
// runtime-consultation.cjs's publishNoClobber/publishReplace, "never a second
// reimplementation of this security-critical logic") -- so a fault/rendezvous
// env var a test set to target the REAL CLI's own write would, without this
// shielding, ALSO fire during this wrapper's unrelated setup work, before the
// real CLI is ever even spawned. Stripped here for the wrapper's own in-process
// work, then restored ONLY in the env explicitly passed to the spawned real CLI
// child, so fault injection lands exactly where a test intends it: the real
// CLI's own write, never this wrapper's.
const SHIELDED_ENV_PREFIXES = ['RUNTIME_CONSULTATION_FAULT_', 'RUNTIME_CONSULTATION_TEST_RENDEZVOUS', 'RUNTIME_M7_TEST_'];

function shieldFaultInjectionEnv() {
  const saved = {};
  for (const key of Object.keys(process.env)) {
    if (SHIELDED_ENV_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  }
  return saved;
}

function envWithRestored(saved) {
  return Object.assign({}, process.env, saved);
}

// M6+M7 requester-authority closure (Group A): createRequesterBinding now
// rejects an empty agentKey outright -- resolves RCC_GRANT_AGENT_ID via `??`
// (nullish coalescing), never `||`, so an EXPLICITLY empty env var value is
// passed straight through (createRequesterBinding then fails honestly on
// it, never silently papered over) while a genuinely UNSET env var
// substitutes a stable, non-empty, explicitly test-only default.
function resolveGrantAgentId() {
  return process.env.RCC_GRANT_AGENT_ID ?? 'runtime-consultation-grant-wrapper-agent';
}

// A caller-set restrictive process umask (e.g. a test proving the REAL CLI's
// own fchmod-hardening is independent of umask) is inherited by THIS process
// too -- and this wrapper's own in-process registry writes (createRequesterBinding
// / createRoleActorBinding / mintRoleCommandGrant, which reuse the SAME
// writeRegistryRecordReplace/publishNoClobber primitives, per those functions'
// own doc comments) would then ALSO create their new directories/files under
// that same restrictive mask -- unrelated to what any test actually intends to
// exercise. Set to a known-safe 0022 for this wrapper's own work; restored to
// whatever the caller's process actually had, immediately before spawning the
// real CLI child, so the real CLI's OWN writes see EXACTLY the umask a test
// deliberately set, unaffected by this wrapper's own unrelated setup work.
function withSafeUmask(fn) {
  const originalUmask = process.umask(0o022);
  try {
    return fn();
  } finally {
    process.umask(originalUmask);
  }
}

// A test passing --fixed-clock freezes runtime-consultation's command/grant
// clock, but host-registry bindings remain governed by runtime-role-lifecycle's
// real clock. Therefore grants are rewritten to the frozen instant, while
// bindings retain their real created_at and receive only an extended expiry.
// Rewriting a binding's created_at to a future fake clock would make the
// canonical host-registry validator reject it before the command under test.
const FIXED_CLOCK_DEFAULT_BASE_ISO = '2025-01-01T00:00:00.000Z';

function canonicalIsoUtc(ms) {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function resolveFrozenNowIso() {
  const baseIso = process.env.RUNTIME_CONSULTATION_FAKE_CLOCK || FIXED_CLOCK_DEFAULT_BASE_ISO;
  const baseMs = Date.parse(baseIso);
  const advanceRaw = process.env.RUNTIME_CONSULTATION_FAKE_CLOCK_ADVANCE_MS;
  const advanceMs = (typeof advanceRaw === 'string' && advanceRaw.length > 0) ? Number.parseInt(advanceRaw, 10) : 0;
  return canonicalIsoUtc(baseMs + (Number.isFinite(advanceMs) && advanceMs > 0 ? advanceMs : 0));
}

// M6+M7 requester-authority closure (Group B/D, 2026-08-10) fix: `ttlMsOverride`,
// when given, replaces the preserved-original-TTL default. Discovered via
// DET-ids (two SEPARATE processes, --fixed-ids --fixed-clock, expecting
// byte-identical publish-request output): createRequesterBinding's own
// idempotent lookup-or-reuse (runtime-role-lifecycle.cjs) validates candidate
// bindings against REAL wall-clock time (this wrapper process has no
// fixed-clock concept of its own -- only the SPAWNED real CLI subprocess
// does) -- so a binding whose created_at/expiry were rewritten to the frozen
// PAST (2025-01-01, always earlier than real "now") looks EXPIRED to a LATER,
// separate-process wrapper invocation's own real-clock reuse lookup, even
// though the real CLI itself (evaluating it against ITS OWN frozen clock)
// would accept it fine. That mints a FRESH binding with a DIFFERENT
// actor_instance_id on the second call -- and since Group C's landed fix
// writes requester_instance_id from grantContext.actorInstanceId into
// request.json, and --fixed-ids makes BOTH calls target the IDENTICAL
// request_id (hence the identical no-clobber path), the second call's
// request.json bytes genuinely differ from the first's already-published
// ones: publishNoClobber correctly treats that as a lost race
// (AUTHORITY_INVALID), not a false positive. The GRANT itself never needs
// cross-process reuse (mintRoleCommandGrant always mints fresh, confirmed by
// direct read -- no lookup-or-create loop exists for grants), and its own
// expiry is hard-capped at ROLE_COMMAND_GRANT_TTL_SECONDS (30s) by the real
// CLI's own consumption check, so this override is used for the REQUESTER
// BINDING rewrite ONLY, never the grant's. A far-future (effectively
// permanent within any single test run) expiry keeps the binding valid under
// BOTH clocks simultaneously: the frozen clock (any realistic frozen base is
// far earlier than this horizon) and the wrapper's own real wall-clock reuse
// lookup (also far earlier), without weakening created_at's own "pinned to
// the frozen instant" semantics the real CLI's not-created-in-future check
// still needs.
const REQUESTER_BINDING_FIXED_CLOCK_TTL_MS = 100 * 365 * 24 * 3600 * 1000; // ~100 years

function rewriteRecordTimestampsToFrozenClock(recordPath, ttlMsOverride) {
  const raw = JSON.parse(require('fs').readFileSync(recordPath, 'utf8'));
  const originalCreatedMs = Date.parse(raw.created_at);
  const originalExpiryMs = Date.parse(raw.expiry);
  const ttlMs = ttlMsOverride !== undefined ? ttlMsOverride : (originalExpiryMs - originalCreatedMs);
  const frozenNowIso = resolveFrozenNowIso();
  raw.created_at = frozenNowIso;
  raw.expiry = canonicalIsoUtc(Date.parse(frozenNowIso) + ttlMs);
  require('fs').writeFileSync(recordPath, JSON.stringify(raw));
}

function extendRegistryBindingExpiry(recordPath, ttlMs) {
  const raw = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
  raw.expiry = canonicalIsoUtc(Date.parse(raw.created_at) + ttlMs);
  fs.writeFileSync(recordPath, JSON.stringify(raw));
}

// RoleActorBinding is validated by the spawned CLI against its effective
// clock, while the wrapper itself creates/reuses registry records against the
// real host clock. Make the test-only binding valid under both clocks: its
// creation is no later than either clock, and its expiry is well after both.
function makeRoleActorBindingCompatibleWithFrozenClock(recordPath, ttlMs) {
  const raw = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
  const realCreatedMs = Date.parse(raw.created_at);
  const frozenNowMs = Date.parse(resolveFrozenNowIso());
  raw.created_at = canonicalIsoUtc(Math.min(realCreatedMs, frozenNowMs));
  raw.expiry = canonicalIsoUtc(Math.max(realCreatedMs, frozenNowMs) + ttlMs);
  fs.writeFileSync(recordPath, JSON.stringify(raw));
}

function main() {
  const argv = process.argv.slice(2);
  const subcommand = argv[0];
  const rest = argv.slice(1);
  const savedFaultEnv = shieldFaultInjectionEnv();

  // Bare `--flag value` lookup over this invocation's own `rest` argv --
  // mirrors the same inline `rest.indexOf(...)` idiom tryMintGrant already
  // uses for `--role`/`--request` below, generalized so
  // resolveRequesterGrantScope's own flags object can be built without
  // three duplicated indexOf/bounds-check blocks.
  function extractRestFlag(flagName) {
    const idx = rest.indexOf(flagName);
    return (idx !== -1 && idx + 1 < rest.length) ? rest[idx + 1] : undefined;
  }

  if (!REQUESTER_GATED.has(subcommand) && !TARGET_GATED.has(subcommand)) {
    // Pure, unmodified passthrough for every non-gated subcommand -- no
    // in-process minting work happens on this path at all, but the shield is
    // applied uniformly above for a single, simple invariant; restored here
    // exactly as for the gated path.
    const r = spawnSync('node', [REAL_CLI].concat(argv), { stdio: 'inherit', env: envWithRestored(savedFaultEnv) });
    process.exit(r.status === null ? 1 : r.status);
    return;
  }

  // Diagnostic-only (never fatal): explains on stderr WHY no grant was
  // injected, for a human debugging an unexpected downstream AUTHORITY_INVALID.
  function note(message) {
    process.stderr.write('[runtime-consultation-grant-wrapper] ' + message + '\n');
  }

  // Attempts to mint a real, correctly-scoped grant; returns {grantId,flagName}
  // on success or null on ANY failure (missing/unresolvable project scope, no
  // discoverable PLAN, or an internal mint/binding failure). Deliberately never
  // exits the process on failure -- see the caller's own doc comment for why:
  // a test whose OWN target is a pure argv-grammar check (unrecognized/
  // duplicate flag, positional operand -- all caught by the real CLI's own
  // parseFlags BEFORE grant validation ever runs, confirmed empirically) must
  // still reach that check even when this wrapper cannot determine a project
  // scope at all (e.g. a bare mkdtemp fixture with no git init, predating
  // M7/WP4's own new grant-scope prerequisite). A test whose target DOES need
  // a genuinely valid grant will, with no flag injected at all, reach the real
  // CLI's own honest "no grant provided" AUTHORITY_INVALID -- the same
  // correctly-labeled outcome as RCG-BYPASS-ROOTINIT-NOGRANT already proves
  // deliberately, never a mysterious wrapper-internal exit code.
  function tryMintGrant() {
    const projectRoot = process.env.RCC_GRANT_PROJECT_ROOT || deriveProjectRootFromCoordinationRoot(rest);
    if (!projectRoot) {
      note('no resolvable project scope for ' + subcommand + ' (no RCC_GRANT_PROJECT_ROOT, and --coordination-root did not resolve to a real git worktree) -- proceeding WITHOUT a grant');
      return null;
    }
    const sessionKey = process.env.RCC_GRANT_SESSION || 'rcc-grant-wrapper-session';
    const hasEnvRole = typeof process.env.RCC_GRANT_ROLE === 'string';
    const envRole = hasEnvRole ? (process.env.RCC_GRANT_ROLE.length > 0 ? process.env.RCC_GRANT_ROLE : null) : 'arch-testing';

    let worktreeId;
    let planResult;
    try {
      worktreeId = rll.computeWorktreeId(projectRoot);
      planResult = rll.discoverPlan(projectRoot);
    } catch (e) {
      note('unable to resolve project scope under ' + projectRoot + ': ' + (e && e.message) + ' -- proceeding WITHOUT a grant');
      return null;
    }
    if (!planResult.ok) {
      note('no discoverable PLAN under ' + projectRoot + ': ' + JSON.stringify(planResult) + ' -- proceeding WITHOUT a grant');
      return null;
    }

    const argvDigest = rc.sha256String(rc.canonicalJSONStringify(rest));
    // M6+M7 FULL CLOSURE (2026-08-11): defaults to codex-supervisor -- see
    // RCC_GRANT_PROVIDER's own doc comment above for why. Only the
    // REQUESTER_GATED mint below (createRequesterBinding) ever reads this
    // identity; the TARGET_GATED branch's createRoleActorBinding has no
    // provider field at all.
    const identity = { ok: true, provider: process.env.RCC_GRANT_PROVIDER || 'codex-supervisor', runtime_session_key: sessionKey };
    const usesFixedClock = rest.includes('--fixed-clock');

    if (REQUESTER_GATED.has(subcommand)) {
      // M6+M7 requester-authority closure (Group B): resolves the EXACT
      // current request_id/attempt_id/lease_epoch triple this subcommand's
      // grant must be scoped to -- mirrors context-provider-gate.js's own
      // tryInjectRequesterGrant call shape byte-for-byte (bare, non-dash
      // flag-name keys). null/null/null for the non-transaction admin
      // subcommands is what this resolver itself returns; never
      // hardcoded here anymore (see REQUESTER_GATED's own comment above).
      const scopeResult = rc.resolveRequesterGrantScope(subcommand, {
        'coordination-root': extractRestFlag('--coordination-root'),
        request: extractRestFlag('--request'),
        kind: extractRestFlag('--kind'),
      });
      // M6+M7 requester-authority closure (Group G fix, team-lead-relayed
      // 2026-08-11): when the caller's OWN --request is deliberately
      // malformed/inaccessible (wrong filename, out-of-root, non-canonical
      // namespace, broken graph, ...), resolveRequesterGrantScope correctly
      // cannot resolve a real triple here -- but bailing out (no
      // --requester-binding flag reaches the real CLI at all) makes the real
      // CLI reject on its OWN much-earlier, generic "missing
      // --requester-binding" check instead of ever reaching its own specific
      // accreditation error (SECURITY_INVALID/CORRELATION_INVALID/...,
      // propagated by validateAndConsumeRoleCommandGrantForCommand's own
      // independent re-derivation at consume time). Minting with a null
      // triple here (the same shape already used for the genuinely
      // pre-request admin subcommands) exists ONLY to get a
      // --requester-binding flag onto the real CLI's argv -- the CLI's own
      // consume-time re-derivation of resolveRequesterGrantScope
      // independently hits the SAME resolution failure and surfaces ITS OWN
      // specific reason; this null-triple grant is never treated as
      // authoritative by anything downstream. The OTHER failure path below
      // (project scope/PLAN entirely unresolvable) stays a hard bailout --
      // minting anything there would be meaningless, not merely imprecise.
      if (!scopeResult.ok) {
        note('resolveRequesterGrantScope failed for ' + subcommand + ': ' + JSON.stringify(scopeResult) + ' -- minting with a null request/attempt/epoch triple anyway, so the real CLI\'s own accreditation check is what actually fires');
      }
      const requestId = scopeResult.ok ? scopeResult.requestId : null;
      const attemptId = scopeResult.ok ? scopeResult.attemptId : null;
      const leaseEpoch = scopeResult.ok ? scopeResult.leaseEpoch : null;
      const agentId = resolveGrantAgentId();
      const bindingResult = rll.createRequesterBinding(projectRoot, identity, agentId, envRole, worktreeId, planResult.planDigest, 3600);
      if (!bindingResult.ok) { note('createRequesterBinding failed: ' + JSON.stringify(bindingResult) + ' -- proceeding WITHOUT a grant'); return null; }
      // Far-future override (never the preserved-original-TTL default) --
      // see REQUESTER_BINDING_FIXED_CLOCK_TTL_MS's own doc comment for why
      // the BINDING specifically (never the grant) needs this.
      if (usesFixedClock) extendRegistryBindingExpiry(rll.requesterBindingPathFor(projectRoot, bindingResult.binding.binding_id), REQUESTER_BINDING_FIXED_CLOCK_TTL_MS);
      const mintResult = rll.mintRoleCommandGrant(
        projectRoot, bindingResult.binding, 'requester', subcommand, argvDigest,
        requestId, attemptId, leaseEpoch
      );
      if (!mintResult.ok) { note('mintRoleCommandGrant (requester) failed: ' + JSON.stringify(mintResult) + ' -- proceeding WITHOUT a grant'); return null; }
      if (usesFixedClock) rewriteRecordTimestampsToFrozenClock(rll.roleCommandGrantPathFor(projectRoot, mintResult.grantId));
      return { grantId: mintResult.grantId, flagName: '--requester-binding' };
    }
    let role = envRole || 'arch-testing';
    const roleIdx = rest.indexOf('--role');
    if (roleIdx !== -1 && roleIdx + 1 < rest.length) role = rest[roleIdx + 1];
    const bindingResult = rll.createRoleActorBinding(projectRoot, role, worktreeId, planResult.planDigest, crypto.randomBytes(16).toString('hex'), 60);
    if (!bindingResult.ok) { note('createRoleActorBinding failed: ' + JSON.stringify(bindingResult) + ' -- proceeding WITHOUT a grant'); return null; }
    if (usesFixedClock) makeRoleActorBindingCompatibleWithFrozenClock(rll.roleActorBindingPathFor(projectRoot, bindingResult.binding.binding_id), REQUESTER_BINDING_FIXED_CLOCK_TTL_MS);
    let requestId = null;
    if (subcommand !== 'worker-stop-ack') {
      const reqIdx = rest.indexOf('--request');
      if (reqIdx !== -1 && reqIdx + 1 < rest.length) requestId = rest[reqIdx + 1];
    }
    const mintResult = rll.mintRoleCommandGrant(projectRoot, bindingResult.binding, 'target', subcommand, argvDigest, requestId, null, null);
    if (!mintResult.ok) { note('mintRoleCommandGrant (target) failed: ' + JSON.stringify(mintResult) + ' -- proceeding WITHOUT a grant'); return null; }
    if (usesFixedClock) rewriteRecordTimestampsToFrozenClock(rll.roleCommandGrantPathFor(projectRoot, mintResult.grantId));
    return { grantId: mintResult.grantId, flagName: '--target-binding' };
  }

  // Every in-process registry read/write this wrapper itself performs (scope
  // resolution + binding + grant mint) happens under a known-safe umask --
  // see withSafeUmask's own doc comment. The caller's real umask is restored
  // immediately after, before the real CLI is ever spawned.
  const minted = withSafeUmask(tryMintGrant);

  const fullArgv = minted ? [subcommand].concat(rest, [minted.flagName, minted.grantId]) : argv;
  const r = spawnSync('node', [REAL_CLI].concat(fullArgv), { stdio: 'inherit', env: envWithRestored(savedFaultEnv) });
  process.exit(r.status === null ? 1 : r.status);
}

module.exports = Object.freeze({ establishRetainedCodexSupportPlane });

if (require.main === module) main();
