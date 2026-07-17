#!/usr/bin/env node
'use strict';

// WP3 end-to-end CLI-handler coverage for runtime-role-lifecycle.cjs. The sibling
// unit-level files (runtime-role-lifecycle-registry.test.js,
// runtime-role-lifecycle-statemachine.test.js) prove the registry/session/binding/
// grant/state-machine/action infrastructure in isolation; this file proves that
// infrastructure is actually WIRED into the real `ensure`/`ready`/`wait-ready`/
// `notify`/`rotate`/`stop-owned`/`action-failed` CLI handlers -- spawning the real
// CLI as a subprocess (never calling handlers in-process) and minting
// bindings/grants the same way a real hook would (direct internal calls -- the
// frozen CLI argv has no surface to mint one, by design, PLAN.md ~L150).
//
// Covers the 9-point adversarial matrix the WP3 spec requires: replay, expiry,
// cross-session, ambiguous owner, identity drift, stale binding, wrong
// PLAN/worktree/profile/role, and capability absence -- plus the positive-path
// idempotency/reuse/WAITING/respawn/rehydration/restart-invalidation behaviors.

const assert = require('node:assert');
const { test } = require('node:test');
const { execFileSync, execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const IMPL = path.resolve(__dirname, '../lib/runtime-role-lifecycle.cjs');
const rll = require(IMPL);
const rc = require(path.resolve(__dirname, '../lib/runtime-consultation.cjs'));

const TEST_CAPABILITY = 'handlers-fixture-capability';
const EXECUTOR_CAPABILITY = 'handlers-fixture-executor-capability';

// Needed for DIRECT (non-subprocess) calls into `rll.fakeHostExecutorExecute`
// below -- this test file's OWN process env, distinct from `baseEnv()`
// (which only sets env for spawned CLI subprocesses).
process.env.NODE_ENV = 'test';
process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY = TEST_CAPABILITY;
process.env.RUNTIME_ROLE_LIFECYCLE_FAKE_EXECUTOR_CAPABILITY = EXECUTOR_CAPABILITY;

function makeGitProject(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), (prefix || 'rll-handlers-')));
  execFileSync('git', ['-C', dir, 'init', '-q']);
  execFileSync('git', ['-C', dir, 'config', 'user.email', 'rll-handlers-test@test.local']);
  execFileSync('git', ['-C', dir, 'config', 'user.name', 'RLL Handlers Test']);
  execFileSync('git', ['-C', dir, 'commit', '-q', '--allow-empty', '-m', 'init']);
  return dir;
}

function writePlanFixture(projectRoot, waveSlug) {
  const waveDir = path.join(projectRoot, '.planning', 'wave-' + waveSlug);
  fs.mkdirSync(waveDir, { recursive: true });
  // Content varies with waveSlug (not just the directory name) so a test that
  // deliberately swaps fixtures to simulate a PLAN change gets a genuinely
  // different plan_digest (== sha256 of the raw bytes), not a same-bytes trap.
  fs.writeFileSync(path.join(waveDir, 'PLAN.md'), '# fixture plan for runtime-role-lifecycle-handlers.test.js (' + waveSlug + ')\n');
}

function cleanup(dir) {
  fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
  fs.rmSync(dir, { recursive: true, force: true });
}

function baseEnv(extra) {
  return Object.assign({}, process.env, {
    NODE_ENV: 'test',
    RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY: TEST_CAPABILITY,
  }, extra || {});
}

function runCli(args, envExtra) {
  let stdout;
  let status = 0;
  try {
    stdout = execFileSync('node', [IMPL].concat(args), { encoding: 'utf8', env: baseEnv(envExtra) });
  } catch (err) {
    stdout = err.stdout;
    status = err.status;
  }
  const lines = stdout.trim().split('\n');
  const result = JSON.parse(lines[lines.length - 1]);
  return { status, result };
}

function runCliAsync(args, envExtra) {
  return new Promise((resolve) => {
    execFile('node', [IMPL].concat(args), { encoding: 'utf8', env: baseEnv(envExtra) }, (err, stdout) => {
      const lines = stdout.trim().split('\n');
      resolve({ status: err ? err.code : 0, result: JSON.parse(lines[lines.length - 1]) });
    });
  });
}

function identityFor(sessionKey) {
  return { ok: true, provider: 'claude-hook', runtime_session_key: sessionKey };
}

// PLAN.md ~L576: binding_kind/authority/profile co-vary with the subcommand
// being authorized -- `ready` is the ONLY role-actor+target case, every
// other admitted subcommand in this fixture file is main-orchestrator.
// `mintGrant` below still mints EVERY grant (including `ready`'s) through
// createMainOrchestratorBinding -- since RoleActorBinding/v1 now genuinely
// exists (R4 round 3, block 1a), a `ready` grant minted via `mintGrant` is a
// DELIBERATE wrong-binding-type fixture (its binding_id points at a
// MainOrchestratorBinding record, not a RoleActorBinding one), useful for
// proving that mismatch is correctly rejected. Tests that need GENUINE
// role-actor authority use `mintReadyGrant` below instead.
function grantContextFor(subcommand) {
  if (subcommand === 'ready') return { bindingKind: 'role-actor', authority: 'target', profile: 'target' };
  return { bindingKind: 'main-orchestrator', authority: 'orchestrator', profile: 'normal' };
}

// Mints a real MainOrchestratorBinding + one-use grant the same way a hook would
// (direct internal call -- no CLI surface exists to do this, by design).
function mintGrant(dir, sessionKey, role, subcommand, argvDigest, opts) {
  const identity = identityFor(sessionKey);
  const worktreeId = (opts && opts.worktreeId) || rll.computeWorktreeId(dir);
  const planDigest = (opts && opts.planDigest) || rll.discoverPlan(dir).planDigest;
  const bindingResult = rll.createMainOrchestratorBinding(dir, identity, worktreeId, planDigest, 120);
  assert.strictEqual(bindingResult.ok, true, 'test fixture setup: createMainOrchestratorBinding must succeed');
  const ctx = grantContextFor(subcommand);
  const bindingKind = (opts && opts.bindingKind) || ctx.bindingKind;
  const authority = (opts && opts.authority) || ctx.authority;
  const profile = (opts && opts.profile) || ctx.profile;
  const actionId = (opts && opts.actionId !== undefined) ? opts.actionId : null;
  const grantResult = rll.mintLifecycleCommandGrant(dir, bindingResult.binding, argvDigest, role, subcommand, bindingKind, authority, profile, actionId);
  assert.strictEqual(grantResult.ok, true, 'test fixture setup: mintLifecycleCommandGrant must succeed: ' + JSON.stringify(grantResult));
  return { binding: bindingResult.binding, grantId: grantResult.grantId };
}

// R4 round 3 (block 1a): mints a GENUINE RoleActorBinding/v1 + a role-actor
// grant referencing it -- the real infrastructure `ready` now resolves
// through. `sessionGenerationId` is explicit (never auto-derived) so a
// cross-session test can deliberately mint a binding scoped to a DIFFERENT
// generation than the action it targets.
function mintReadyGrant(dir, role, actionId, sessionGenerationId, opts) {
  const worktreeId = (opts && opts.worktreeId) || rll.computeWorktreeId(dir);
  const planDigest = (opts && opts.planDigest) || rll.discoverPlan(dir).planDigest;
  const bindingResult = rll.createRoleActorBinding(dir, role, worktreeId, planDigest, sessionGenerationId, (opts && opts.bindingTtlSeconds) || 120);
  assert.strictEqual(bindingResult.ok, true, 'test fixture setup: createRoleActorBinding must succeed: ' + JSON.stringify(bindingResult));
  const grantResult = rll.mintLifecycleCommandGrant(dir, bindingResult.binding, readyDigest(actionId), role, 'ready', 'role-actor', 'target', 'target', actionId);
  assert.strictEqual(grantResult.ok, true, 'test fixture setup: mintLifecycleCommandGrant must succeed: ' + JSON.stringify(grantResult));
  return { binding: bindingResult.binding, grantId: grantResult.grantId };
}

function ensureDigest(roles) {
  return rc.sha256String('ensure:' + roles.slice().sort().join(','));
}
function readyDigest(actionId) {
  return rc.sha256String('ready:' + actionId);
}
function notifyDigest(role, kind, artifactDigest) {
  return rc.sha256String('notify:' + role + ':' + kind + ':' + artifactDigest);
}
function rotateDigest(role) {
  return rc.sha256String('rotate:' + role);
}
function stopOwnedDigest(role, reason) {
  return rc.sha256String('stop-owned:' + role + ':' + reason);
}
function actionFailedDigest(actionId, reason) {
  return rc.sha256String('action-failed:' + actionId + ':' + reason);
}
function waitReadyDigest(actionId) {
  return rc.sha256String('wait-ready:' + actionId);
}
function probeDigest() {
  return rc.sha256String('probe');
}
function statusDigest(role) {
  return rc.sha256String('status:' + (role === undefined ? '' : role));
}

const LIVE_ROLE = 'arch-testing'; // routed claude-sendmessage first -- exercises the live role-spawn/mint path
const NOOP_CAPS = JSON.stringify([]);
const LIVE_CAPS = JSON.stringify(['claude-sendmessage']);
const CODEX_CAPS = JSON.stringify(['codex-app-server']);

// WP3 item C correction (point A.3): a first-time Claude-native `ensure` now
// ALSO mints a `team-ensure` action, ordered before the role-spawn action(s)
// (PLAN.md ~L167). Every existing fixture that captures "the" minted action
// off a fresh `ensure` call must select the role-spawn one explicitly rather
// than assuming `actions[0]`.
function findRoleSpawnAction(actions) {
  const found = actions.find((a) => a.kind === 'role-spawn');
  assert.ok(found, 'expected a role-spawn action among: ' + JSON.stringify(actions));
  return found;
}
function findTeamEnsureAction(actions) {
  const found = actions.find((a) => a.kind === 'team-ensure');
  assert.ok(found, 'expected a team-ensure action among: ' + JSON.stringify(actions));
  return found;
}

// WP3 item C correction pass (point C): minting team-ensure (PENDING) no
// longer itself unlocks role-spawn -- the host/executor must register
// SUCCESS first. `mainBindingId` is unused by the team-ensure branch of
// `fakeHostExecutorExecute` (only the supervisor-start/execution-claim
// branch needs it), so a placeholder string is fine here.
function succeedTeamEnsure(dir, teamAction) {
  const result = rll.fakeHostExecutorExecute(dir, teamAction.action_id, 'executed', 'unused-for-team-ensure');
  assert.strictEqual(result.ok, true, 'test fixture setup: team-ensure success registration must succeed: ' + JSON.stringify(result));
}

/**
 * Full "get me a role-spawn action for `role`" fixture flow: ensure (mints
 * team-ensure PENDING), register team-ensure SUCCESS, ensure again (now
 * mints the role-spawn). Returns the role-spawn action.
 */
function ensureLiveRoleSpawnAction(dir, sessionKey, role) {
  role = role || LIVE_ROLE;
  const g1 = mintGrant(dir, sessionKey, role, 'ensure', ensureDigest([role]));
  const r1 = runCli(['ensure', '--project-root', dir, '--role', role, '--lifecycle-binding', g1.grantId], { RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES: LIVE_CAPS });
  assert.strictEqual(r1.result.status, 'ACTION_REQUIRED', 'fixture: first ensure must mint team-ensure: ' + JSON.stringify(r1.result));
  const teamAction = findTeamEnsureAction(r1.result.actions);
  succeedTeamEnsure(dir, teamAction);
  const g2 = mintGrant(dir, sessionKey, role, 'ensure', ensureDigest([role]));
  const r2 = runCli(['ensure', '--project-root', dir, '--role', role, '--lifecycle-binding', g2.grantId], { RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES: LIVE_CAPS });
  assert.strictEqual(r2.result.status, 'ACTION_REQUIRED', 'fixture: second ensure must mint role-spawn: ' + JSON.stringify(r2.result));
  return findRoleSpawnAction(r2.result.actions);
}

// ══════════════════════════════════════════════════════════════════════════
// Positive path: ensure -> ACTION_REQUIRED -> ready -> READY -> idempotent
// re-ensure -> notify -> rotate -> ready(new action) -> stop-owned
// ══════════════════════════════════════════════════════════════════════════

test('ensure(live driver, valid grant): a SINGLE call mints team-ensure THEN role-spawn together, ordered (point 3.4); binding STARTING; a role-actor grant whose binding is actually a MainOrchestratorBinding (never a genuine RoleActorBinding) is correctly rejected AT MINT TIME as binding-kind-schema-mismatch (R4 round 3, round 4 correction -- role-actor authority is now genuinely evaluated, not universally unavailable; the dedicated positive path lives in its own test); re-ensure (including after team-ensure SUCCEEDS) is idempotent (no second mint); notify/rotate/stop-owned complete the lifecycle against a directly-seeded READY binding', () => {
  const dir = makeGitProject();
  try {
    writePlanFixture(dir, 'handlers-happy');
    const sessionKey = 'happy-path-session';

    const g1 = mintGrant(dir, sessionKey, LIVE_ROLE, 'ensure', ensureDigest([LIVE_ROLE]));
    const r1 = runCli(['ensure', '--project-root', dir, '--role', LIVE_ROLE, '--lifecycle-binding', g1.grantId], { RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES: LIVE_CAPS });
    assert.strictEqual(r1.status, 0, JSON.stringify(r1.result));
    assert.strictEqual(r1.result.status, 'ACTION_REQUIRED');
    // Point 3.4: ONE ensure() call returns BOTH, ordered team-ensure then
    // role-spawn -- no second ensure()/grant round-trip required merely to
    // "unlock" role-spawn after registering team-ensure SUCCEEDED.
    assert.strictEqual(r1.result.actions.length, 2, 'team-ensure AND role-spawn together, ordered, in the SAME call (point 3.4)');
    assert.strictEqual(r1.result.actions[0].kind, 'team-ensure', 'team-ensure must be ORDERED FIRST (PLAN.md ~L167)');
    assert.strictEqual(r1.result.actions[1].kind, 'role-spawn', 'role-spawn ordered AFTER its team-ensure predecessor');
    const teamAction = r1.result.actions[0];
    assert.strictEqual(teamAction.runtime, 'claude-native');
    assert.strictEqual(teamAction.role, null);
    const action = r1.result.actions[1];
    assert.strictEqual(action.runtime, 'claude-native');
    assert.strictEqual(action.role, LIVE_ROLE);
    assert.match(action.action_id, /^[0-9a-f]{32}$/);
    assert.strictEqual(action.payload.bootstrap_message.includes('ready --action'), true);

    // Idempotent team-ensure: a second first-time ensure for a DIFFERENT role
    // in the SAME session generation reuses the SAME team-ensure action_id
    // rather than minting a second one.
    const g1b = mintGrant(dir, sessionKey, 'toolkit-specialist', 'ensure', ensureDigest(['toolkit-specialist']));
    const r1b = runCli(['ensure', '--project-root', dir, '--role', 'toolkit-specialist', '--lifecycle-binding', g1b.grantId], { RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES: LIVE_CAPS });
    assert.strictEqual(r1b.result.status, 'ACTION_REQUIRED', JSON.stringify(r1b.result));
    const teamAction1b = findTeamEnsureAction(r1b.result.actions);
    assert.strictEqual(teamAction1b.action_id, teamAction.action_id, 'idempotent: the SAME pending team-ensure action_id is reused, never a second mint');

    // Host/executor registers team-ensure SUCCESS -- a LATER re-ensure for
    // LIVE_ROLE must still be idempotent: the SAME role-spawn action_id
    // already minted above, never a second one now that team-ensure has
    // ALSO independently reached SUCCEEDED.
    succeedTeamEnsure(dir, teamAction);
    const g1c = mintGrant(dir, sessionKey, LIVE_ROLE, 'ensure', ensureDigest([LIVE_ROLE]));
    const r1c = runCli(['ensure', '--project-root', dir, '--role', LIVE_ROLE, '--lifecycle-binding', g1c.grantId], { RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES: LIVE_CAPS });
    assert.strictEqual(r1c.result.status, 'ACTION_REQUIRED', JSON.stringify(r1c.result));
    const reReportedAction = findRoleSpawnAction(r1c.result.actions);
    assert.strictEqual(reReportedAction.action_id, action.action_id, 'idempotent: re-reports the SAME already-minted role-spawn action_id, never a second mint after team-ensure SUCCEEDS');

    // A never-consumed action is still WAITING from wait-ready's perspective.
    const gw1 = mintGrant(dir, sessionKey, LIVE_ROLE, 'wait-ready', waitReadyDigest(action.action_id), { actionId: action.action_id });
    const w1 = runCli(['wait-ready', '--action', action.action_id, '--timeout', '1', '--lifecycle-binding', gw1.grantId]);
    assert.strictEqual(w1.result.status, 'WAITING');
    assert.notStrictEqual(w1.result.status, 'READY');

    // R4 round 3 (round 4 correction, finding 1): mintLifecycleCommandGrant
    // is now schema-aware -- a role-actor grant whose binding is actually a
    // MainOrchestratorBinding (never a genuine RoleActorBinding) is
    // rejected AT MINT TIME, before any grant file is ever published (the
    // masquerade PLAN.md ~L574 forbids). There is therefore no --lifecycle-
    // binding value to even hand the CLI here; the dedicated positive path
    // (genuine RoleActorBinding, real READY) lives in its own test, not
    // entangled with this one's own ensure/notify/rotate focus.
    const mainBindingForReady = rll.createMainOrchestratorBinding(dir, identityFor(sessionKey), rll.computeWorktreeId(dir), rll.discoverPlan(dir).planDigest, 120).binding;
    const g2 = rll.mintLifecycleCommandGrant(dir, mainBindingForReady, readyDigest(action.action_id), LIVE_ROLE, 'ready', 'role-actor', 'target', 'target', action.action_id);
    assert.strictEqual(g2.ok, false, JSON.stringify(g2));
    assert.strictEqual(g2.reason, 'binding-kind-schema-mismatch');

    // The binding never advanced past STARTING as a result -- `ready`
    // failing closed must never leak a false transition.
    const worktreeId = rll.computeWorktreeId(dir);
    const planDigest = rll.discoverPlan(dir).planDigest;
    const generationId = rll.resolveSessionGeneration(dir, identityFor(sessionKey)).generationId;
    const profileDigest = rll.roleProfileDigestFor(LIVE_ROLE);
    const startingState = rll.readRoleBindingState(dir, worktreeId, planDigest, profileDigest, generationId, LIVE_ROLE);
    assert.strictEqual(startingState.state, 'STARTING');

    // Downstream notify/rotate/stop-owned behavior is independent of HOW a
    // binding reaches READY -- seeded directly via the SAME transition
    // primitive `ready`'s own (now-unavailable) handler would have used,
    // bypassing only the broken CLI grant path, never the state machine
    // itself.
    const seeded = rll.transitionRoleBinding(dir, worktreeId, planDigest, profileDigest, generationId, LIVE_ROLE, 'STARTING', 'READY', startingState.record, {});
    assert.strictEqual(seeded.ok, true, JSON.stringify(seeded));
    const bindingId = seeded.record.binding_id;

    // Idempotent re-ensure: SAME role, fresh grant, no second action minted.
    const g3 = mintGrant(dir, sessionKey, LIVE_ROLE, 'ensure', ensureDigest([LIVE_ROLE]));
    const r3 = runCli(['ensure', '--project-root', dir, '--role', LIVE_ROLE, '--lifecycle-binding', g3.grantId], { RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES: LIVE_CAPS });
    assert.strictEqual(r3.result.status, 'READY');
    assert.strictEqual(r3.result.actions.length, 0);
    assert.strictEqual(r3.result.bindings[0].binding_id, bindingId);

    // notify against the READY binding mints exactly one role-notify action.
    const artifact = path.join(dir, 'artifact.json');
    fs.writeFileSync(artifact, '{}');
    const artifactDigest = crypto.createHash('sha256').update(fs.readFileSync(artifact)).digest('hex');
    const g4 = mintGrant(dir, sessionKey, LIVE_ROLE, 'notify', notifyDigest(LIVE_ROLE, 'session-control', artifactDigest));
    const r4 = runCli(['notify', '--project-root', dir, '--role', LIVE_ROLE, '--artifact', artifact, '--kind', 'session-control', '--lifecycle-binding', g4.grantId]);
    assert.strictEqual(r4.result.status, 'ACTION_REQUIRED', JSON.stringify(r4.result));
    assert.strictEqual(r4.result.actions[0].kind, 'role-notify');
    assert.strictEqual(r4.result.actions[0].payload.artifact_ref, artifact);

    // rotate cycles the READY binding through ROTATING -> REHYDRATING and mints
    // a fresh role-spawn action with an incremented respawn_count.
    const g5 = mintGrant(dir, sessionKey, LIVE_ROLE, 'rotate', rotateDigest(LIVE_ROLE));
    const r5 = runCli(['rotate', '--project-root', dir, '--role', LIVE_ROLE, '--lifecycle-binding', g5.grantId], { RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES: LIVE_CAPS });
    assert.strictEqual(r5.result.status, 'ACTION_REQUIRED', JSON.stringify(r5.result));
    const rotateAction = r5.result.actions[0];
    assert.notStrictEqual(rotateAction.action_id, action.action_id);

    // Same mint-time schema-mismatch rejection as above (R4 round 3, round
    // 4 correction, finding 1); seed REHYDRATING->READY directly to
    // continue exercising stop-owned's OWN, otherwise-unrelated behavior
    // below.
    const mainBindingForReady2 = rll.createMainOrchestratorBinding(dir, identityFor(sessionKey), worktreeId, planDigest, 120).binding;
    const g6 = rll.mintLifecycleCommandGrant(dir, mainBindingForReady2, readyDigest(rotateAction.action_id), LIVE_ROLE, 'ready', 'role-actor', 'target', 'target', rotateAction.action_id);
    assert.strictEqual(g6.ok, false, JSON.stringify(g6));
    assert.strictEqual(g6.reason, 'binding-kind-schema-mismatch');
    const rehydratingState = rll.readRoleBindingState(dir, worktreeId, planDigest, profileDigest, generationId, LIVE_ROLE);
    assert.strictEqual(rehydratingState.state, 'REHYDRATING');
    const reseeded = rll.transitionRoleBinding(dir, worktreeId, planDigest, profileDigest, generationId, LIVE_ROLE, 'REHYDRATING', 'READY', rehydratingState.record, {});
    assert.strictEqual(reseeded.ok, true, JSON.stringify(reseeded));
    assert.strictEqual(reseeded.record.binding_id, bindingId, 'binding_id is stable across a rotate cycle');

    // stop-owned retires the binding: STOPPED status, one stop action minted.
    const g7 = mintGrant(dir, sessionKey, LIVE_ROLE, 'stop-owned', stopOwnedDigest(LIVE_ROLE, 'operator'));
    const r7 = runCli(['stop-owned', '--project-root', dir, '--role', LIVE_ROLE, '--reason', 'operator', '--lifecycle-binding', g7.grantId]);
    assert.strictEqual(r7.result.status, 'STOPPED', JSON.stringify(r7.result));
    assert.strictEqual(r7.result.actions[0].kind, 'role-stop-owned');

    // A subsequent ensure sees the binding as terminal (STOPPED), never reused.
    const g8 = mintGrant(dir, sessionKey, LIVE_ROLE, 'ensure', ensureDigest([LIVE_ROLE]));
    const r8 = runCli(['ensure', '--project-root', dir, '--role', LIVE_ROLE, '--lifecycle-binding', g8.grantId], { RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES: LIVE_CAPS });
    assert.strictEqual(r8.result.status, 'UNAVAILABLE', JSON.stringify(r8.result));
  } finally {
    cleanup(dir);
  }
});

test('ensure(noop-only role, valid grant, NO registered disk consumer): CAPABILITY_UNAVAILABLE, never a false READY (point 3.3)', () => {
  const dir = makeGitProject();
  try {
    writePlanFixture(dir, 'handlers-noop-no-consumer');
    const g1 = mintGrant(dir, 'noop-session-no-consumer', LIVE_ROLE, 'ensure', ensureDigest([LIVE_ROLE]));
    const r1 = runCli(['ensure', '--project-root', dir, '--role', LIVE_ROLE, '--lifecycle-binding', g1.grantId], { RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES: NOOP_CAPS });
    assert.strictEqual(r1.result.status, 'UNAVAILABLE', JSON.stringify(r1.result));
    assert.strictEqual(r1.result.detail_code, 'CAPABILITY_UNAVAILABLE');
    assert.strictEqual(r1.result.actions.length, 0);
    assert.strictEqual(r1.result.bindings.length, 0, 'noop must never declare a binding READY without a registered, validated consumer');
  } finally {
    cleanup(dir);
  }
});

test('ensure(noop-only role, valid grant, a registered+validated disk consumer): instant READY with zero minted actions (point 3.3, Agent-Teams-disabled one-shot availability is the NO-grant path, not this one)', () => {
  const dir = makeGitProject();
  try {
    writePlanFixture(dir, 'handlers-noop');
    const g1 = mintGrant(dir, 'noop-session', LIVE_ROLE, 'ensure', ensureDigest([LIVE_ROLE]));
    const r1 = runCli(['ensure', '--project-root', dir, '--role', LIVE_ROLE, '--lifecycle-binding', g1.grantId], { RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES: NOOP_CAPS, RUNTIME_ROLE_LIFECYCLE_TEST_DISK_CONSUMERS: JSON.stringify([LIVE_ROLE]) });
    assert.strictEqual(r1.result.status, 'READY', JSON.stringify(r1.result));
    assert.strictEqual(r1.result.actions.length, 0);
    assert.strictEqual(r1.result.bindings[0].driver, 'noop');
  } finally {
    cleanup(dir);
  }
});

test('ensure(multi-role, codex-app-server): mints EXACTLY ONE batched supervisor-start action for the whole sorted role set, never one-per-role (PLAN.md ~L167, WP3 item C correction A.1/A.2)', () => {
  const dir = makeGitProject();
  try {
    writePlanFixture(dir, 'handlers-codex-batch');
    const sessionKey = 'codex-batch-session';
    const roles = ['quality-gater', 'verifier']; // both route codex-app-server FIRST; intentionally unsorted argv order
    const roleKey = roles.slice().sort(); // PLAN.md ~L576: multi-role ensure's grant role is a sorted-unique ARRAY, never a joined string
    const g1 = mintGrant(dir, sessionKey, roleKey, 'ensure', ensureDigest(roles));
    const r1 = runCli(['ensure', '--project-root', dir, '--role', roles[0], '--role', roles[1], '--lifecycle-binding', g1.grantId], { RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES: CODEX_CAPS });
    assert.strictEqual(r1.status, 0, JSON.stringify(r1.result));
    assert.strictEqual(r1.result.status, 'ACTION_REQUIRED');
    assert.strictEqual(r1.result.actions.length, 1, 'exactly ONE action for the whole batch, never one per role');
    const batched = r1.result.actions[0];
    assert.strictEqual(batched.kind, 'supervisor-start');
    assert.strictEqual(batched.runtime, 'host-process');
    assert.strictEqual(batched.role, null, 'common role is null -- the payload carries the complete role set');
    assert.deepStrictEqual(
      batched.payload.bridge_argv.filter((_, i, arr) => arr[i - 1] === '--role'),
      ['quality-gater', 'verifier'],
      'bridge_argv carries the FULL role set, sorted, as repeated --role flags',
    );
    assert.strictEqual(batched.payload.bridge_argv[2], 'session-run');
    assert.strictEqual(batched.payload.bridge_command, require(path.resolve(__dirname, '../lib/runtime-role-lifecycle.cjs')).renderPosixDirect(batched.payload.bridge_argv));

    // Both bindings reference the SAME pending_action_id -- one supervisor,
    // two roles, never a second supervisor-start.
    const profileDigestQG = rll.roleProfileDigestFor('quality-gater');
    const profileDigestV = rll.roleProfileDigestFor('verifier');
    const worktreeId = rll.computeWorktreeId(dir);
    const planDigest = rll.discoverPlan(dir).planDigest;
    const generationId = rll.resolveSessionGeneration(dir, identityFor(sessionKey)).generationId;
    const stateQG = rll.readRoleBindingState(dir, worktreeId, planDigest, profileDigestQG, generationId, 'quality-gater');
    const stateV = rll.readRoleBindingState(dir, worktreeId, planDigest, profileDigestV, generationId, 'verifier');
    assert.strictEqual(stateQG.state, 'STARTING');
    assert.strictEqual(stateV.state, 'STARTING');
    assert.strictEqual(stateQG.record.pending_action_id, batched.action_id);
    assert.strictEqual(stateV.record.pending_action_id, batched.action_id, 'both bindings share the SAME batched action_id');

    // Idempotent re-ensure while both are still STARTING: re-reports the SAME
    // one action, never mints a second/add-role supervisor-start.
    const g2 = mintGrant(dir, sessionKey, roleKey, 'ensure', ensureDigest(roles));
    const r2 = runCli(['ensure', '--project-root', dir, '--role', roles[0], '--role', roles[1], '--lifecycle-binding', g2.grantId], { RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES: CODEX_CAPS });
    assert.strictEqual(r2.result.status, 'ACTION_REQUIRED', JSON.stringify(r2.result));
    assert.strictEqual(r2.result.actions.length, 1, 'deduplicated: one action per action_id, never a copy per affected binding (point A correction)');
    assert.strictEqual(r2.result.actions[0].action_id, batched.action_id, 'no second/add-role supervisor-start is ever minted');
  } finally {
    cleanup(dir);
  }
});

// WP3 item C correction pass (point A) minimum test 1: ensure(A) followed by
// ensure(A+B) must NEVER mint a second supervisor-start nor an implicit
// add-role -- C1 has no real rebind path yet, so B is reported UNAVAILABLE
// until the existing supervisor for A resolves.
test('ensure(A) then ensure(A+B): zero second supervisor-start, B is UNAVAILABLE while A already owns the retained supervisor (point A singleton)', () => {
  const dir = makeGitProject();
  try {
    writePlanFixture(dir, 'handlers-singleton-ab');
    const sessionKey = 'singleton-session';
    const roleA = 'verifier';
    const roleB = 'quality-gater';

    const gA = mintGrant(dir, sessionKey, roleA, 'ensure', ensureDigest([roleA]));
    const rA = runCli(['ensure', '--project-root', dir, '--role', roleA, '--lifecycle-binding', gA.grantId], { RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES: CODEX_CAPS });
    assert.strictEqual(rA.result.status, 'ACTION_REQUIRED', JSON.stringify(rA.result));
    assert.strictEqual(rA.result.actions.length, 1);
    const firstActionId = rA.result.actions[0].action_id;

    const gAB = mintGrant(dir, sessionKey, [roleA, roleB].slice().sort(), 'ensure', ensureDigest([roleA, roleB]));
    const rAB = runCli(['ensure', '--project-root', dir, '--role', roleA, '--role', roleB, '--lifecycle-binding', gAB.grantId], { RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES: CODEX_CAPS });
    // A re-reports its existing pending action; B is UNAVAILABLE (no second
    // supervisor, no implicit add-role) -- overall status reflects the mix:
    // ACTION_REQUIRED wins over UNAVAILABLE per the existing precedence.
    assert.strictEqual(rAB.result.status, 'ACTION_REQUIRED', JSON.stringify(rAB.result));
    assert.strictEqual(rAB.result.actions.length, 1, 'only A\'s existing action is reported, never a second supervisor-start for B');
    assert.strictEqual(rAB.result.actions[0].action_id, firstActionId);
    assert.ok(
      !rAB.result.actions[0].payload.bridge_argv.includes(roleB),
      'the existing action was never silently mutated into an add-role batch including B',
    );

    // B's own binding never advanced past ABSENT (never falsely claimed READY/STARTING).
    const profileDigestB = rll.roleProfileDigestFor(roleB);
    const worktreeId = rll.computeWorktreeId(dir);
    const planDigest = rll.discoverPlan(dir).planDigest;
    const generationId = rll.resolveSessionGeneration(dir, identityFor(sessionKey)).generationId;
    const stateB = rll.readRoleBindingState(dir, worktreeId, planDigest, profileDigestB, generationId, roleB);
    assert.strictEqual(stateB.state, 'ABSENT');
  } finally {
    cleanup(dir);
  }
});

// WP3 item C correction pass (point B) minimum test 4: action-failed on a
// supervisor-start with role:null correlates the EXACT role set from its own
// bridge_argv and atomically terminalizes every affected STARTING binding.
test('supervisor-start action-failed: every affected role-binding leaves STARTING (point B)', () => {
  const dir = makeGitProject();
  try {
    writePlanFixture(dir, 'handlers-supstart-failed');
    const sessionKey = 'supstart-failed-session';
    const roles = ['quality-gater', 'verifier'];
    const roleKey = roles.slice().sort();
    const g1 = mintGrant(dir, sessionKey, roleKey, 'ensure', ensureDigest(roles));
    const r1 = runCli(['ensure', '--project-root', dir, '--role', roles[0], '--role', roles[1], '--lifecycle-binding', g1.grantId], { RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES: CODEX_CAPS });
    assert.strictEqual(r1.result.status, 'ACTION_REQUIRED', JSON.stringify(r1.result));
    const actionId = r1.result.actions[0].action_id;

    const gFail1 = mintGrant(dir, sessionKey, null, 'action-failed', actionFailedDigest(actionId, 'capability-unavailable'), { actionId });
    const r2 = runCli(['action-failed', '--action', actionId, '--reason', 'capability-unavailable', '--lifecycle-binding', gFail1.grantId]);
    assert.strictEqual(r2.result.status, 'UNAVAILABLE', JSON.stringify(r2.result));
    assert.strictEqual(r2.result.detail_code, 'CAPABILITY_UNAVAILABLE');

    const worktreeId = rll.computeWorktreeId(dir);
    const planDigest = rll.discoverPlan(dir).planDigest;
    const generationId = rll.resolveSessionGeneration(dir, identityFor(sessionKey)).generationId;
    for (const role of roles) {
      const profileDigest = rll.roleProfileDigestFor(role);
      const state = rll.readRoleBindingState(dir, worktreeId, planDigest, profileDigest, generationId, role);
      assert.strictEqual(state.state, 'UNAVAILABLE', role + ' must have left STARTING, never hang referencing a dead action');
    }

    // A second action-failed on the SAME action is a replay -- nothing left to terminalize.
    const gFail2 = mintGrant(dir, sessionKey, null, 'action-failed', actionFailedDigest(actionId, 'capability-unavailable'), { actionId });
    const r3 = runCli(['action-failed', '--action', actionId, '--reason', 'capability-unavailable', '--lifecycle-binding', gFail2.grantId]);
    assert.strictEqual(r3.result.detail_code, 'ACTION_REPLAY');

    // Point B.4: action-failed must ALSO terminalize the coordination-root
    // owner/intent record, making the role(s) eligible for the next
    // permitted driver -- never leaving the coordination root itself
    // permanently occupied by a batch that has already definitively
    // failed. (Per-generation role-bindings are terminal-by-design once
    // UNAVAILABLE -- PLAN's own restart-invalidation recovery path is a
    // FRESH session_generation_id, never a same-generation retry -- so
    // this is proven via a new generation, exactly as production recovery
    // would.)
    const coordinationRootId = rll.computeCoordinationRootId(dir);
    const ownerPath = rll.supervisorLifecycleOwnerPathFor(dir, coordinationRootId);
    const owner = JSON.parse(fs.readFileSync(ownerPath, 'utf8'));
    assert.strictEqual(owner.state, 'TERMINATED', 'action-failed must settle the owner, never leave it ACTIVE forever');
    assert.strictEqual(owner.action_id, actionId);
    assert.strictEqual(owner.failure_reason, 'capability-unavailable');

    const nextSessionKey = 'supstart-failed-session-next-generation';
    const g2 = mintGrant(dir, nextSessionKey, roleKey, 'ensure', ensureDigest(roles));
    const r4 = runCli(['ensure', '--project-root', dir, '--role', roles[0], '--role', roles[1], '--lifecycle-binding', g2.grantId], { RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES: CODEX_CAPS });
    assert.strictEqual(r4.result.status, 'ACTION_REQUIRED', 'a fresh batch for the SAME coordination root must now be mintable -- the failed batch is no longer blocking it: ' + JSON.stringify(r4.result));
    assert.notStrictEqual(r4.result.actions[0].action_id, actionId);

    const ownerAfterRetry = JSON.parse(fs.readFileSync(ownerPath, 'utf8'));
    assert.strictEqual(ownerAfterRetry.state, 'ACTIVE');
    assert.strictEqual(ownerAfterRetry.action_id, r4.result.actions[0].action_id);
  } finally {
    cleanup(dir);
  }
});

// WP3 item C correction pass (point C) minimum test 6: a FAILED team-ensure
// must invalidate every dependent role-spawn binding; no dependent spawn can
// execute or reappear afterward. Point 3.4 (R4) makes this scenario reachable
// for the FIRST time with a genuinely LIVE dependent: the role-spawn below is
// eagerly minted ALONGSIDE the still-PENDING team-ensure (same ensure() call,
// point 3.4), so by the time action-failed runs, the role-binding is already
// a real STARTING dependent -- this is what proves the host's own
// contractual obligation ("never execute role-spawn if TeamCreate failed",
// PLAN.md ~L165's "may not... continue to a dependent action") is backed by
// a genuine core-side invalidation, not merely trusted interpreter
// discipline. Before point 3.4, this path (`findRoleBindingsDependentOnTeamEnsure`)
// had no reachable dependent at all under the OLD two-call design.
test('team-ensure FAILED: invalidates the ALREADY-eagerly-minted dependent role-spawn (point 3.4 safety net), no dependent spawn can execute or reappear afterward, and with NO other capable driver in routing the role falls through to noop -- never UNAVAILABLE forever (point C + point 5, corrected)', () => {
  const dir = makeGitProject();
  try {
    writePlanFixture(dir, 'handlers-team-failed');
    const sessionKey = 'team-failed-session';
    const g1 = mintGrant(dir, sessionKey, LIVE_ROLE, 'ensure', ensureDigest([LIVE_ROLE]));
    const r1 = runCli(['ensure', '--project-root', dir, '--role', LIVE_ROLE, '--lifecycle-binding', g1.grantId], { RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES: LIVE_CAPS });
    assert.strictEqual(r1.result.status, 'ACTION_REQUIRED', JSON.stringify(r1.result));
    // Point 3.4: role-spawn was minted EAGERLY, in this SAME call, alongside
    // the still-PENDING team-ensure -- a genuinely live dependent, not a
    // scenario reached via a second ensure() after registering SUCCESS.
    assert.strictEqual(r1.result.actions.length, 2, JSON.stringify(r1.result));
    const teamAction = findTeamEnsureAction(r1.result.actions);
    const eagerSpawnAction = findRoleSpawnAction(r1.result.actions);
    assert.strictEqual(eagerSpawnAction.role, LIVE_ROLE);

    const worktreeId = rll.computeWorktreeId(dir);
    const planDigest = rll.discoverPlan(dir).planDigest;
    const generationId = rll.resolveSessionGeneration(dir, identityFor(sessionKey)).generationId;
    const profileDigest = rll.roleProfileDigestFor(LIVE_ROLE);
    const beforeState = rll.readRoleBindingState(dir, worktreeId, planDigest, profileDigest, generationId, LIVE_ROLE);
    assert.strictEqual(beforeState.state, 'STARTING', 'the dependent must genuinely be live/STARTING BEFORE team-ensure fails');
    assert.strictEqual(beforeState.record.pending_action_id, eagerSpawnAction.action_id);
    assert.strictEqual(beforeState.record.team_ensure_action_id, teamAction.action_id);

    const gFail = mintGrant(dir, sessionKey, null, 'action-failed', actionFailedDigest(teamAction.action_id, 'native-tool-error'), { actionId: teamAction.action_id });
    const r2 = runCli(['action-failed', '--action', teamAction.action_id, '--reason', 'native-tool-error', '--lifecycle-binding', gFail.grantId]);
    assert.strictEqual(r2.result.status, 'UNAVAILABLE', JSON.stringify(r2.result));

    // The safety net actually fired: the eagerly-minted dependent is now
    // invalidated, never left STARTING referencing a team-ensure that will
    // never succeed.
    const afterState = rll.readRoleBindingState(dir, worktreeId, planDigest, profileDigest, generationId, LIVE_ROLE);
    assert.strictEqual(afterState.state, 'UNAVAILABLE');
    assert.strictEqual(afterState.record.failure_reason, 'team-ensure-failed');
    assert.strictEqual(afterState.record.driver, 'claude-sendmessage');

    // A fresh ensure for the SAME role, SAME generation, re-selects a
    // driver -- point 5 correction: FAILED must never pin the role
    // UNAVAILABLE forever. claude-sendmessage is excluded by name (its own
    // team-ensure already failed for this exact scope) and the routing list
    // for LIVE_ROLE has no OTHER live-capable entry in this fixture's
    // manifest, so selection legitimately falls all the way through to
    // `noop` (itself a routing-permitted entry, unconditionally
    // selectable) -- READY via the disk-consumer path, not a resurrected
    // claude-native role-spawn and not a second team-ensure mint. Point
    // 3.3: noop itself now also requires a registered+validated disk
    // consumer to declare READY -- registered here so this test keeps
    // proving the FALLBACK reaches noop, not noop's own separate gate.
    const g2 = mintGrant(dir, sessionKey, LIVE_ROLE, 'ensure', ensureDigest([LIVE_ROLE]));
    const r3 = runCli(['ensure', '--project-root', dir, '--role', LIVE_ROLE, '--lifecycle-binding', g2.grantId], { RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES: LIVE_CAPS, RUNTIME_ROLE_LIFECYCLE_TEST_DISK_CONSUMERS: JSON.stringify([LIVE_ROLE]) });
    assert.strictEqual(r3.result.status, 'READY', JSON.stringify(r3.result));
    assert.strictEqual(r3.result.bindings[0].driver, 'noop');

    // Attempting to register SUCCESS on the now-FAILED marker is rejected.
    const registerResult = rll.registerTeamEnsureSuccess({ repoId: teamAction.repo_id }, teamAction.session_generation_id, teamAction.worktree_id, teamAction.plan_digest, teamAction.action_id);
    assert.strictEqual(registerResult.ok, false);
  } finally {
    cleanup(dir);
  }
});

test('team-ensure FAILED: with codex-app-server ALSO permitted by routing and capable, the role falls through to it -- the illustrative "advance to the next driver" case (point 5)', () => {
  const dir = makeGitProject();
  try {
    writePlanFixture(dir, 'handlers-team-failed-fallback');
    const sessionKey = 'team-failed-fallback-session';
    const bothCaps = JSON.stringify(['claude-sendmessage', 'codex-app-server']);
    const g1 = mintGrant(dir, sessionKey, LIVE_ROLE, 'ensure', ensureDigest([LIVE_ROLE]));
    const r1 = runCli(['ensure', '--project-root', dir, '--role', LIVE_ROLE, '--lifecycle-binding', g1.grantId], { RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES: bothCaps });
    assert.strictEqual(r1.result.status, 'ACTION_REQUIRED', JSON.stringify(r1.result));
    const teamAction = findTeamEnsureAction(r1.result.actions);
    assert.strictEqual(teamAction.kind, 'team-ensure');

    const gFail = mintGrant(dir, sessionKey, null, 'action-failed', actionFailedDigest(teamAction.action_id, 'native-tool-error'), { actionId: teamAction.action_id });
    const r2 = runCli(['action-failed', '--action', teamAction.action_id, '--reason', 'native-tool-error', '--lifecycle-binding', gFail.grantId]);
    assert.strictEqual(r2.result.status, 'UNAVAILABLE', JSON.stringify(r2.result));

    // A fresh ensure for the SAME role/generation now advances PAST the
    // failed claude-sendmessage to the next routing-permitted, CAPABLE
    // driver -- codex-app-server -- and mints a real supervisor-start
    // action, never staying UNAVAILABLE forever and never re-attempting
    // claude-sendmessage's own already-FAILED team-ensure.
    const g2 = mintGrant(dir, sessionKey, LIVE_ROLE, 'ensure', ensureDigest([LIVE_ROLE]));
    const r3 = runCli(['ensure', '--project-root', dir, '--role', LIVE_ROLE, '--lifecycle-binding', g2.grantId], { RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES: bothCaps });
    assert.strictEqual(r3.result.status, 'ACTION_REQUIRED', JSON.stringify(r3.result));
    assert.strictEqual(r3.result.actions.length, 1);
    assert.strictEqual(r3.result.actions[0].kind, 'supervisor-start');
    assert.notStrictEqual(r3.result.actions[0].action_id, teamAction.action_id, 'a genuinely new action, never the dead team-ensure action_id');

    const worktreeId = rll.computeWorktreeId(dir);
    const planDigest = rll.discoverPlan(dir).planDigest;
    const profileDigest = rll.roleProfileDigestFor(LIVE_ROLE);
    const generationId = rll.resolveSessionGeneration(dir, identityFor(sessionKey)).generationId;
    const state = rll.readRoleBindingState(dir, worktreeId, planDigest, profileDigest, generationId, LIVE_ROLE);
    assert.strictEqual(state.state, 'STARTING');
    assert.strictEqual(state.record.driver, 'codex-app-server');
    assert.strictEqual(state.record.pending_action_id, r3.result.actions[0].action_id);
  } finally {
    cleanup(dir);
  }
});

test('ensure without --lifecycle-binding: rejected as an authority failure regardless of policy mode or any live capability (R4 round 2, point 1: no grantless success)', () => {
  const toolkitPolicy = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../lib/runtime-collaboration-policy.json'), 'utf8'));
  for (const mode of ['auto', 'ephemeral', 'persistent', 'disk-only']) {
    const dir = makeGitProject();
    try {
      writePlanFixture(dir, 'handlers-nograt-' + mode);
      fs.mkdirSync(path.join(dir, 'scripts', 'lib'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'scripts', 'lib', 'runtime-collaboration-policy.json'), JSON.stringify(Object.assign({}, toolkitPolicy, { mode })));
      fs.copyFileSync(path.resolve(__dirname, '../lib/runtime-routing.json'), path.join(dir, 'scripts', 'lib', 'runtime-routing.json'));
      const r = runCli(['ensure', '--project-root', dir, '--role', LIVE_ROLE], { RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES: LIVE_CAPS });
      assert.strictEqual(r.result.status, 'INVALID', mode + ': ' + JSON.stringify(r.result));
      assert.strictEqual(r.result.detail_code, 'IDENTITY_MISMATCH', mode + ': a missing grant is an authority failure, never a degraded-but-OK ephemeral/unavailable success');
      assert.deepStrictEqual(r.result.actions, []);
      assert.deepStrictEqual(r.result.bindings, []);
    } finally {
      cleanup(dir);
    }
  }
});

// ══════════════════════════════════════════════════════════════════════════
// Respawn / rehydration / respawn-budget exhaustion (DEAD -> REHYDRATING)
// ══════════════════════════════════════════════════════════════════════════

test('DEAD role-binding respawns once (max_respawns_per_role=1), then a SECOND death quarantines instead of respawning again', () => {
  const dir = makeGitProject();
  try {
    writePlanFixture(dir, 'handlers-respawn');
    const sessionKey = 'respawn-session';
    const identity = identityFor(sessionKey);
    const worktreeId = rll.computeWorktreeId(dir);
    const planDigest = rll.discoverPlan(dir).planDigest;
    const genResult = rll.resolveSessionGeneration(dir, identity);
    const profileDigest = rll.roleProfileDigestFor(LIVE_ROLE);

    // Fabricate a DEAD binding directly (host-private registry -- safe to
    // mutate for this fixture, mirrors the registry test file's own
    // pattern). respawn_count:0 -- point 1.5 (R4)'s closed per-state shape
    // now requires it on every persisted record, matching what a REAL
    // ensure()-driven spawn always sets explicitly (never genuinely absent
    // in production; the fixture must mirror that, not a looser shape).
    // pending_action_id is REQUIRED (bidirectional, R4 round 2 point 4) for
    // the STARTING hop -- matching what a real role-spawn mint always sets.
    const t1 = rll.transitionRoleBinding(dir, worktreeId, planDigest, profileDigest, genResult.generationId, LIVE_ROLE, 'ABSENT', 'STARTING', null, { driver: 'claude-sendmessage', respawn_count: 0, pending_action_id: 'b'.repeat(32) });
    const t2 = rll.transitionRoleBinding(dir, worktreeId, planDigest, profileDigest, genResult.generationId, LIVE_ROLE, 'STARTING', 'READY', t1.record, {});
    const t3 = rll.transitionRoleBinding(dir, worktreeId, planDigest, profileDigest, genResult.generationId, LIVE_ROLE, 'READY', 'DEAD', t2.record, {});
    assert.strictEqual(t3.ok, true, JSON.stringify(t3));
    assert.strictEqual(t3.record.respawn_count, 0);

    // Team-ensure must SUCCEED before `ensure` will act on any Claude-native
    // role at all (point C) -- register it via a bootstrap call for a
    // DIFFERENT role first, so the DEAD-binding respawn below is not itself
    // gated behind a fresh team-ensure mint.
    const gBoot = mintGrant(dir, sessionKey, 'toolkit-specialist', 'ensure', ensureDigest(['toolkit-specialist']));
    const rBoot = runCli(['ensure', '--project-root', dir, '--role', 'toolkit-specialist', '--lifecycle-binding', gBoot.grantId], { RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES: LIVE_CAPS });
    assert.strictEqual(rBoot.result.status, 'ACTION_REQUIRED', JSON.stringify(rBoot.result));
    succeedTeamEnsure(dir, findTeamEnsureAction(rBoot.result.actions));

    const g1 = mintGrant(dir, sessionKey, LIVE_ROLE, 'ensure', ensureDigest([LIVE_ROLE]));
    const r1 = runCli(['ensure', '--project-root', dir, '--role', LIVE_ROLE, '--lifecycle-binding', g1.grantId], { RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES: LIVE_CAPS });
    assert.strictEqual(r1.result.status, 'ACTION_REQUIRED', JSON.stringify(r1.result));
    const state1 = rll.readRoleBindingState(dir, worktreeId, planDigest, profileDigest, genResult.generationId, LIVE_ROLE);
    assert.strictEqual(state1.state, 'REHYDRATING');
    assert.strictEqual(state1.record.respawn_count, 1);

    // Kill it again -- respawn_count is now AT the max_respawns_per_role=1 budget.
    const t4 = rll.transitionRoleBinding(dir, worktreeId, planDigest, profileDigest, genResult.generationId, LIVE_ROLE, 'REHYDRATING', 'READY', state1.record, {});
    const t5 = rll.transitionRoleBinding(dir, worktreeId, planDigest, profileDigest, genResult.generationId, LIVE_ROLE, 'READY', 'DEAD', t4.record, {});
    assert.strictEqual(t5.ok, true);

    const g2 = mintGrant(dir, sessionKey, LIVE_ROLE, 'ensure', ensureDigest([LIVE_ROLE]));
    const r2 = runCli(['ensure', '--project-root', dir, '--role', LIVE_ROLE, '--lifecycle-binding', g2.grantId], { RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES: LIVE_CAPS });
    assert.strictEqual(r2.result.status, 'UNAVAILABLE', JSON.stringify(r2.result));
    const state2 = rll.readRoleBindingState(dir, worktreeId, planDigest, profileDigest, genResult.generationId, LIVE_ROLE);
    assert.strictEqual(state2.state, 'QUARANTINED');
  } finally {
    cleanup(dir);
  }
});

test('restart invalidation: a DIFFERENT runtime_session_key (session restart) gets a DIFFERENT session_generation_id and sees ABSENT, even though the OLD generation still has a READY binding on disk untouched', () => {
  const dir = makeGitProject();
  try {
    writePlanFixture(dir, 'handlers-restart');
    // Point 3.3: noop now also requires a registered+validated disk
    // consumer -- registered here so this test keeps proving restart
    // invalidation, unrelated to noop's own separate gate.
    const noopEnv = { RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES: NOOP_CAPS, RUNTIME_ROLE_LIFECYCLE_TEST_DISK_CONSUMERS: JSON.stringify([LIVE_ROLE]) };
    const g1 = mintGrant(dir, 'pre-restart-session', LIVE_ROLE, 'ensure', ensureDigest([LIVE_ROLE]));
    const r1 = runCli(['ensure', '--project-root', dir, '--role', LIVE_ROLE, '--lifecycle-binding', g1.grantId], noopEnv);
    assert.strictEqual(r1.result.status, 'READY');
    const oldBindingId = r1.result.bindings[0].binding_id;
    // PLAN.md ~L574: the binding never carries session_generation_id -- re-derive
    // fresh from its own (runtime, runtime_session_key) tuple.
    const oldGenerationId = rll.resolveSessionGeneration(dir, { provider: g1.binding.runtime, runtime_session_key: g1.binding.runtime_session_key }).generationId;

    const g2 = mintGrant(dir, 'post-restart-session', LIVE_ROLE, 'ensure', ensureDigest([LIVE_ROLE]));
    const newGenerationId = rll.resolveSessionGeneration(dir, { provider: g2.binding.runtime, runtime_session_key: g2.binding.runtime_session_key }).generationId;
    assert.notStrictEqual(newGenerationId, oldGenerationId, 'a different runtime_session_key must mint a different session_generation_id');
    const r2 = runCli(['ensure', '--project-root', dir, '--role', LIVE_ROLE, '--lifecycle-binding', g2.grantId], noopEnv);
    assert.strictEqual(r2.result.status, 'READY');
    assert.notStrictEqual(r2.result.bindings[0].binding_id, oldBindingId, 'the new generation must mint a FRESH binding, never reuse the old binding_id');

    // The OLD generation's record is untouched (structural restart invalidation
    // -- a disjoint registry path, never a scan-and-invalidate pass).
    const profileDigest = rll.roleProfileDigestFor(LIVE_ROLE);
    const oldState = rll.readRoleBindingState(dir, rll.computeWorktreeId(dir), rll.discoverPlan(dir).planDigest, profileDigest, oldGenerationId, LIVE_ROLE);
    assert.strictEqual(oldState.state, 'READY');
    assert.strictEqual(oldState.record.binding_id, oldBindingId);
  } finally {
    cleanup(dir);
  }
});

// ══════════════════════════════════════════════════════════════════════════
// Adversarial matrix: replay, expiry, cross-session, ambiguous owner,
// identity drift, stale binding, wrong PLAN/worktree/profile/role,
// capability absence
// ══════════════════════════════════════════════════════════════════════════

test('ADV-replay-1: a consumed grant cannot be reused for a second ensure call', () => {
  const dir = makeGitProject();
  try {
    writePlanFixture(dir, 'adv-replay-1');
    const noopEnv = { RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES: NOOP_CAPS, RUNTIME_ROLE_LIFECYCLE_TEST_DISK_CONSUMERS: JSON.stringify([LIVE_ROLE]) };
    const g = mintGrant(dir, 'replay-session', LIVE_ROLE, 'ensure', ensureDigest([LIVE_ROLE]));
    const first = runCli(['ensure', '--project-root', dir, '--role', LIVE_ROLE, '--lifecycle-binding', g.grantId], noopEnv);
    assert.strictEqual(first.result.status, 'READY');
    const replay = runCli(['ensure', '--project-root', dir, '--role', LIVE_ROLE, '--lifecycle-binding', g.grantId], noopEnv);
    assert.strictEqual(replay.status, 3);
    assert.strictEqual(replay.result.status, 'INVALID');
    assert.strictEqual(replay.result.detail_code, 'IDENTITY_MISMATCH');
  } finally {
    cleanup(dir);
  }
});

// Point 1.3 (R4): ready's OWN replay-detection (a second call against an
// ALREADY-READY binding) is unreachable now -- role-actor authority is
// UNIVERSALLY unavailable and rejected before that state is ever checked,
// so no call can reach READY in the first place. What remains genuinely
// provable -- and still valuable -- is that the rejection is UNCONDITIONAL:
// repeating the call changes nothing, and the binding never transitions.
// R4 round 3 (block 1a): now that RoleActorBinding/v1 genuinely exists,
// this proves real replay protection against `ready`'s ACTUAL logic --
// the FIRST genuinely-authorized call reaches READY; a SECOND call against
// the SAME action_id, even with an entirely FRESH, independently valid
// grant+actor-binding, is rejected as ACTION_REPLAY (the binding is no
// longer STARTING/REHYDRATING with a matching pending_action_id), never
// re-authorized and never knocked back down from READY.
test('ADV-replay-2: a SECOND ready call against an ALREADY-consumed pending action is rejected as ACTION_REPLAY even with a fresh, independently valid grant -- the binding stays exactly at READY, never re-transitioned', () => {
  const dir = makeGitProject();
  try {
    writePlanFixture(dir, 'adv-replay-2');
    const sessionKey = 'ready-replay-session';
    const spawnAction = ensureLiveRoleSpawnAction(dir, sessionKey);
    const actionId = spawnAction.action_id;

    const g2 = mintReadyGrant(dir, LIVE_ROLE, actionId, spawnAction.session_generation_id);
    const r2 = runCli(['ready', '--action', actionId, '--lifecycle-binding', g2.grantId]);
    assert.strictEqual(r2.result.status, 'READY', JSON.stringify(r2.result));
    const bindingId = r2.result.bindings[0].binding_id;

    const g3 = mintReadyGrant(dir, LIVE_ROLE, actionId, spawnAction.session_generation_id);
    const r3 = runCli(['ready', '--action', actionId, '--lifecycle-binding', g3.grantId]);
    assert.strictEqual(r3.result.status, 'INVALID', JSON.stringify(r3.result));
    assert.strictEqual(r3.result.detail_code, 'ACTION_REPLAY');

    const profileDigest = rll.roleProfileDigestFor(LIVE_ROLE);
    const state = rll.readRoleBindingState(dir, rll.computeWorktreeId(dir), rll.discoverPlan(dir).planDigest, profileDigest, spawnAction.session_generation_id, LIVE_ROLE);
    assert.strictEqual(state.state, 'READY', 'the replayed call never re-transitions the binding');
    assert.strictEqual(state.record.binding_id, bindingId, 'the SAME binding, untouched by the replay attempt');
  } finally {
    cleanup(dir);
  }
});

test('ADV-expiry-1: an expired grant is rejected (IDENTITY_MISMATCH), never silently honored', () => {
  const dir = makeGitProject();
  try {
    writePlanFixture(dir, 'adv-expiry-1');
    const g = mintGrant(dir, 'expiry-session', LIVE_ROLE, 'ensure', ensureDigest([LIVE_ROLE]));
    const grantPath = rll.grantPathFor(dir, g.grantId);
    const rec = JSON.parse(fs.readFileSync(grantPath, 'utf8'));
    // Both created_at AND expiry moved into the far past (still a valid
    // <=30s-apart pair) so this exercises the GENUINE now>=expiry rejection,
    // never the separate created_at<=expiry / TTL-exceeds-30s checks.
    rec.created_at = '2000-01-01T00:00:00Z';
    rec.expiry = '2000-01-01T00:00:29Z';
    fs.chmodSync(grantPath, 0o600);
    fs.writeFileSync(grantPath, JSON.stringify(rec), { mode: 0o600 });

    const r = runCli(['ensure', '--project-root', dir, '--role', LIVE_ROLE, '--lifecycle-binding', g.grantId], { RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES: NOOP_CAPS });
    assert.strictEqual(r.status, 3);
    assert.strictEqual(r.result.detail_code, 'IDENTITY_MISMATCH');
  } finally {
    cleanup(dir);
  }
});

// R4 round 3 (block 1a): now that RoleActorBinding/v1 genuinely exists,
// this proves `ready`'s OWN expiry-detection against its ACTUAL logic --
// a genuinely-authorized call against an action whose OWN expires_at has
// already passed is rejected as ACTION_EXPIRED, and (per `handleReady`'s
// own expire-on-detection behavior) the binding is DELIBERATELY
// transitioned STARTING->UNAVAILABLE as a side effect -- never left
// silently STARTING forever, and never a false READY.
test('ADV-expiry-2: ready against an action whose OWN expiry has already passed is rejected as ACTION_EXPIRED (never READY), and the binding is deliberately transitioned to UNAVAILABLE as a side effect', () => {
  const dir = makeGitProject();
  try {
    writePlanFixture(dir, 'adv-expiry-2');
    const sessionKey = 'action-expiry-session';
    const spawnAction = ensureLiveRoleSpawnAction(dir, sessionKey);
    const actionId = spawnAction.action_id;

    const actionPath = rll.actionPathFor(dir, actionId);
    const rec = JSON.parse(fs.readFileSync(actionPath, 'utf8'));
    rec.expires_at = '2000-01-01T00:00:00Z';
    fs.chmodSync(actionPath, 0o600);
    fs.writeFileSync(actionPath, JSON.stringify(rec), { mode: 0o600 });

    const g2 = mintReadyGrant(dir, LIVE_ROLE, actionId, spawnAction.session_generation_id);
    const r2 = runCli(['ready', '--action', actionId, '--lifecycle-binding', g2.grantId]);
    assert.strictEqual(r2.result.status, 'INVALID', JSON.stringify(r2.result));
    assert.strictEqual(r2.result.detail_code, 'ACTION_EXPIRED');
    assert.notStrictEqual(r2.result.status, 'READY');

    const profileDigest = rll.roleProfileDigestFor(LIVE_ROLE);
    const state = rll.readRoleBindingState(dir, rll.computeWorktreeId(dir), rll.discoverPlan(dir).planDigest, profileDigest, spawnAction.session_generation_id, LIVE_ROLE);
    assert.strictEqual(state.state, 'UNAVAILABLE', 'ready deliberately expires a STARTING binding whose pending action has itself expired');
  } finally {
    cleanup(dir);
  }
});

// R4 round 3 (block 1a): now that RoleActorBinding/v1 genuinely stores
// session_generation_id directly (never re-derived, unlike
// MainOrchestratorBinding -- see the RoleActorBinding/v1 section header),
// this proves `ready`'s OWN cross-session/generation correlation check
// against its ACTUAL logic: a role-actor binding minted under a DIFFERENT
// session generation than the action itself is rejected as
// IDENTITY_MISMATCH, never READY.
test('ADV-cross-session-1: a ready grant backed by a RoleActorBinding minted under a DIFFERENT session generation than the action itself is rejected as IDENTITY_MISMATCH, never READY -- and this is genuinely the session cross-check firing, not a blanket role-actor rejection (proven directly, in-process, against validateAndConsumeLifecycleCommandGrant itself)', () => {
  const dir = makeGitProject();
  try {
    writePlanFixture(dir, 'adv-cross-session');
    const actionId = ensureLiveRoleSpawnAction(dir, 'session-A').action_id;
    const sessionBGenerationId = rll.resolveSessionGeneration(dir, identityFor('session-B')).generationId;

    // Direct, in-process proof that the underlying role-actor binding
    // resolves GENUINELY (not blanket-rejected) even under session-B's
    // generation -- isolates that the eventual CLI-level rejection below is
    // specifically the session cross-check in `handleReady` (comparing
    // binding.session_generation_id against the action's own), not merely
    // "role-actor authority is universally unavailable" collapsing to the
    // SAME externally-visible IDENTITY_MISMATCH code coincidentally.
    const gDirect = mintReadyGrant(dir, LIVE_ROLE, actionId, sessionBGenerationId);
    const directResult = rll.validateAndConsumeLifecycleCommandGrant({ repoId: rll.computeRepoId(dir) }, gDirect.grantId, rc.sha256String('ready:' + actionId), LIVE_ROLE, 'ready', actionId);
    assert.strictEqual(directResult.ok, true, 'the binding itself must resolve genuinely: ' + JSON.stringify(directResult));
    assert.strictEqual(directResult.bindingKind, 'role-actor');
    assert.strictEqual(directResult.binding.session_generation_id, sessionBGenerationId, 'resolved to the session-B generation it was ACTUALLY minted under, not silently coerced');

    // A grant minted under a DIFFERENT (session-B) generation than the
    // action itself is rejected as IDENTITY_MISMATCH, never READY.
    const gCrossSession = mintReadyGrant(dir, LIVE_ROLE, actionId, sessionBGenerationId);
    const r2 = runCli(['ready', '--action', actionId, '--lifecycle-binding', gCrossSession.grantId]);
    assert.strictEqual(r2.result.status, 'INVALID', JSON.stringify(r2.result));
    assert.strictEqual(r2.result.detail_code, 'IDENTITY_MISMATCH');
    assert.notStrictEqual(r2.result.status, 'READY');
  } finally {
    cleanup(dir);
  }
});

// R4 round 3 (block 1a): now that RoleActorBinding/v1 genuinely exists,
// this proves `ready`'s OWN ambiguous-owner racing logic against its
// ACTUAL, real-process CAS behavior: two concurrent callers, each with an
// independently valid, genuinely-authorized grant, race the SAME pending
// action -- exactly ONE wins (transitions STARTING->READY), the other
// loses via AMBIGUOUS_OWNER, never both winning and never both losing.
test('ADV-ambiguous-owner-1: two concurrent ready calls, each genuinely authorized, racing the SAME pending action -- exactly ONE wins (READY), the other loses as AMBIGUOUS_OWNER, never both', async () => {
  const dir = makeGitProject();
  try {
    writePlanFixture(dir, 'adv-ambiguous-owner');
    const sessionKey = 'race-session';
    const spawnAction = ensureLiveRoleSpawnAction(dir, sessionKey);
    const actionId = spawnAction.action_id;

    const gA = mintReadyGrant(dir, LIVE_ROLE, actionId, spawnAction.session_generation_id);
    const gB = mintReadyGrant(dir, LIVE_ROLE, actionId, spawnAction.session_generation_id);
    const [ra, rb] = await Promise.all([
      runCliAsync(['ready', '--action', actionId, '--lifecycle-binding', gA.grantId]),
      runCliAsync(['ready', '--action', actionId, '--lifecycle-binding', gB.grantId]),
    ]);
    const results = [ra, rb];
    const winners = results.filter((r) => r.result.status === 'READY');
    const losers = results.filter((r) => r.result.status === 'INVALID' && r.result.detail_code === 'AMBIGUOUS_OWNER');
    assert.strictEqual(winners.length, 1, 'exactly one racing call wins: ' + JSON.stringify(results.map((r) => r.result)));
    assert.strictEqual(losers.length, 1, 'exactly one racing call loses as AMBIGUOUS_OWNER: ' + JSON.stringify(results.map((r) => r.result)));

    const profileDigest = rll.roleProfileDigestFor(LIVE_ROLE);
    const finalState = rll.readRoleBindingState(dir, rll.computeWorktreeId(dir), rll.discoverPlan(dir).planDigest, profileDigest, spawnAction.session_generation_id, LIVE_ROLE);
    assert.strictEqual(finalState.state, 'READY', 'the winning transition genuinely lands');
    assert.strictEqual(finalState.record.binding_id, winners[0].result.bindings[0].binding_id);
  } finally {
    cleanup(dir);
  }
});

// R4 round 3 (block 1b): the explicit full positive path the correction
// demands -- ensure -> actor binding (test-minted) -> target grant
// (test-minted) -> ready reaches READY -> wait-ready ALSO reaches READY.
// Production stays genuinely issuer-less (nothing mints a RoleActorBinding
// or a role-actor grant outside a test) until WP4's real target-gate hook;
// this proves the WP3-scoped registry infrastructure this correction adds
// is genuinely wired end to end, not merely present as dead code.
test('R4 round 3 block 1b -- full positive path: ensure -> RoleActorBinding (test-minted) -> role-actor target grant (test-minted) -> ready reaches READY -> wait-ready ALSO reaches READY', () => {
  const dir = makeGitProject();
  try {
    writePlanFixture(dir, 'r3-block1b-full-positive');
    const sessionKey = 'r3-block1b-session';
    const spawnAction = ensureLiveRoleSpawnAction(dir, sessionKey);
    const actionId = spawnAction.action_id;

    // Actor binding + target grant, both genuinely test-minted (no CLI
    // surface exists to do this, by design -- identical in spirit to every
    // other binding/grant fixture in this file).
    const gReady = mintReadyGrant(dir, LIVE_ROLE, actionId, spawnAction.session_generation_id);
    const rReady = runCli(['ready', '--action', actionId, '--lifecycle-binding', gReady.grantId]);
    assert.strictEqual(rReady.result.status, 'READY', 'ready must genuinely reach READY: ' + JSON.stringify(rReady.result));
    assert.strictEqual(rReady.result.detail_code, 'NONE');
    const bindingId = rReady.result.bindings[0].binding_id;

    const profileDigest = rll.roleProfileDigestFor(LIVE_ROLE);
    const state = rll.readRoleBindingState(dir, rll.computeWorktreeId(dir), rll.discoverPlan(dir).planDigest, profileDigest, spawnAction.session_generation_id, LIVE_ROLE);
    assert.strictEqual(state.state, 'READY');
    assert.strictEqual(state.record.binding_id, bindingId);

    // wait-ready is main-orchestrator authority (never role-actor) -- a
    // FRESH, ordinary grant, called against the NOW-READY action.
    const gWait = mintGrant(dir, sessionKey, LIVE_ROLE, 'wait-ready', waitReadyDigest(actionId), { actionId });
    const rWait = runCli(['wait-ready', '--action', actionId, '--timeout', '1', '--lifecycle-binding', gWait.grantId]);
    assert.strictEqual(rWait.result.status, 'READY', 'wait-ready must ALSO genuinely reach READY: ' + JSON.stringify(rWait.result));
    assert.strictEqual(rWait.result.bindings[0].binding_id, bindingId);
  } finally {
    cleanup(dir);
  }
});

test('ADV-identity-drift-1: a grant minted against a DIFFERENT worktree is rejected (IDENTITY_MISMATCH), never proceeds against the mismatched scope', () => {
  const dirA = makeGitProject('rll-drift-a-');
  const dirB = makeGitProject('rll-drift-b-');
  try {
    writePlanFixture(dirA, 'adv-drift-a');
    writePlanFixture(dirB, 'adv-drift-b');
    // Grant minted against dirB's own worktree/plan, then presented to a CLI
    // call whose --project-root is dirA.
    const gWrongWorktree = mintGrant(dirB, 'drift-session', LIVE_ROLE, 'ensure', ensureDigest([LIVE_ROLE]));
    const r = runCli(['ensure', '--project-root', dirA, '--role', LIVE_ROLE, '--lifecycle-binding', gWrongWorktree.grantId], { RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES: NOOP_CAPS });
    assert.strictEqual(r.status, 3);
    assert.strictEqual(r.result.detail_code, 'IDENTITY_MISMATCH');
  } finally {
    cleanup(dirA);
    cleanup(dirB);
  }
});

test('ADV-stale-binding-1: a grant minted against the OLD plan_digest is rejected after the PLAN changes underneath it (draft->final style drift)', () => {
  const dir = makeGitProject();
  try {
    writePlanFixture(dir, 'adv-stale-v1');
    const gStale = mintGrant(dir, 'stale-session', LIVE_ROLE, 'ensure', ensureDigest([LIVE_ROLE]));

    // The PLAN.md content changes (a new wave dir replaces the old one),
    // changing discoverPlan's own digest -- simulates a draft->final rebind
    // boundary without a live second plan file (single-match discovery is
    // otherwise ambiguous, per discoverPlan's own zero/multiple-match rule).
    fs.rmSync(path.join(dir, '.planning'), { recursive: true, force: true });
    writePlanFixture(dir, 'adv-stale-v2-different-content-' + crypto.randomBytes(4).toString('hex'));

    const r = runCli(['ensure', '--project-root', dir, '--role', LIVE_ROLE, '--lifecycle-binding', gStale.grantId], { RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES: NOOP_CAPS });
    assert.strictEqual(r.status, 3);
    assert.strictEqual(r.result.detail_code, 'IDENTITY_MISMATCH');
  } finally {
    cleanup(dir);
  }
});

test('ADV-wrong-role-1: a grant minted for role X cannot authorize ensure for role Y', () => {
  const dir = makeGitProject();
  try {
    writePlanFixture(dir, 'adv-wrong-role');
    const g = mintGrant(dir, 'wrong-role-session', LIVE_ROLE, 'ensure', ensureDigest([LIVE_ROLE]));
    const r = runCli(['ensure', '--project-root', dir, '--role', 'context-provider', '--lifecycle-binding', g.grantId], { RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES: NOOP_CAPS });
    assert.strictEqual(r.status, 3);
    assert.strictEqual(r.result.detail_code, 'IDENTITY_MISMATCH');
  } finally {
    cleanup(dir);
  }
});

test('ADV-wrong-subcommand-1: a `ready` grant cannot authorize `notify`, and vice versa', () => {
  const dir = makeGitProject();
  try {
    writePlanFixture(dir, 'adv-wrong-subcommand');
    const sessionKey = 'wrong-subcommand-session';
    const actionId = ensureLiveRoleSpawnAction(dir, sessionKey).action_id;

    // Mint a grant with subcommand='notify' but present it to `ready`.
    const gWrongKind = mintGrant(dir, sessionKey, LIVE_ROLE, 'notify', readyDigest(actionId));
    const r2 = runCli(['ready', '--action', actionId, '--lifecycle-binding', gWrongKind.grantId]);
    assert.strictEqual(r2.status, 3);
    assert.strictEqual(r2.result.detail_code, 'IDENTITY_MISMATCH');
  } finally {
    cleanup(dir);
  }
});

test('ADV-capability-absence-1: a role with NO routing.json entry at all (planner) is UNAVAILABLE regardless of any fake capability', () => {
  const dir = makeGitProject();
  try {
    writePlanFixture(dir, 'adv-capability-absence');
    const g = mintGrant(dir, 'capability-absence-session', 'planner', 'ensure', ensureDigest(['planner']));
    const r = runCli(['ensure', '--project-root', dir, '--role', 'planner', '--lifecycle-binding', g.grantId], { RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES: JSON.stringify(['claude-sendmessage', 'claude-agent', 'codex-app-server', 'codex-mcp', 'runtime-spawn']) });
    assert.strictEqual(r.status, 4);
    assert.strictEqual(r.result.status, 'UNAVAILABLE');
    assert.strictEqual(r.result.detail_code, 'CAPABILITY_UNAVAILABLE');
  } finally {
    cleanup(dir);
  }
});

test('ADV-no-pid-or-text-authorizes-ready-1: action-failed on a live pending action quarantines/unavailables it -- no amount of "it looked like it started" text reaches this CLI at all, so a plain STARTING binding never self-transitions to READY without a grant-bound ready call', () => {
  const dir = makeGitProject();
  try {
    writePlanFixture(dir, 'adv-no-pid-text');
    const sessionKey = 'no-pid-session';
    const spawnAction = ensureLiveRoleSpawnAction(dir, sessionKey);
    const actionId = spawnAction.action_id;

    // Re-`ensure` (fresh grant) WITHOUT ever calling `ready`: the binding must
    // still be reported as pending (ACTION_REQUIRED, the SAME action), never
    // READY -- nothing about re-observing the request transitions state.
    const g2 = mintGrant(dir, sessionKey, LIVE_ROLE, 'ensure', ensureDigest([LIVE_ROLE]));
    const r2 = runCli(['ensure', '--project-root', dir, '--role', LIVE_ROLE, '--lifecycle-binding', g2.grantId], { RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES: LIVE_CAPS });
    assert.strictEqual(r2.result.status, 'ACTION_REQUIRED');
    assert.strictEqual(r2.result.actions[0].action_id, actionId, 're-ensure must re-report the SAME pending action, never fabricate READY');

    // Point 1.1 (R4): action-failed requires a grant, correlated to the
    // action's own embedded role (PLAN.md ~L150).
    const gFail = mintGrant(dir, sessionKey, LIVE_ROLE, 'action-failed', actionFailedDigest(actionId, 'native-tool-error'), { actionId });
    const r3 = runCli(['action-failed', '--action', actionId, '--reason', 'native-tool-error', '--lifecycle-binding', gFail.grantId]);
    assert.strictEqual(r3.result.status, 'UNAVAILABLE');
    assert.strictEqual(r3.result.detail_code, 'NATIVE_TOOL_ERROR');

    const profileDigest = rll.roleProfileDigestFor(LIVE_ROLE);
    const state = rll.readRoleBindingState(dir, rll.computeWorktreeId(dir), rll.discoverPlan(dir).planDigest, profileDigest, spawnAction.session_generation_id, LIVE_ROLE);
    assert.strictEqual(state.state, 'UNAVAILABLE');
  } finally {
    cleanup(dir);
  }
});

// Section 5 (R4) named RED reproducer: "late action-failed sobre READY" --
// a stale action_id, minted for a role-binding that has SINCE reached
// READY through some other path, must never be able to retroactively knock
// it back down. action-failed's role-scoped branch only ever acts on a
// binding still STARTING/REHYDRATING with a MATCHING pending_action_id;
// once READY, that same action_id is no longer the current live one.
test('late action-failed over an ALREADY-READY binding: a stale action_id from before the binding reached READY is rejected as ACTION_REPLAY, never knocks the binding back down (Section 5 named RED reproducer)', () => {
  const dir = makeGitProject();
  try {
    writePlanFixture(dir, 'handlers-late-action-failed-over-ready');
    const sessionKey = 'late-action-failed-over-ready-session';
    const spawnAction = ensureLiveRoleSpawnAction(dir, sessionKey);
    const staleActionId = spawnAction.action_id;

    const worktreeId = rll.computeWorktreeId(dir);
    const planDigest = rll.discoverPlan(dir).planDigest;
    const generationId = rll.resolveSessionGeneration(dir, identityFor(sessionKey)).generationId;
    const profileDigest = rll.roleProfileDigestFor(LIVE_ROLE);

    // Reach READY via the SAME direct-seed technique the happy-path test
    // uses (point 1.3: the CLI `ready` path is universally unavailable --
    // this bypasses only that broken CLI surface, never the state machine
    // itself).
    const startingState = rll.readRoleBindingState(dir, worktreeId, planDigest, profileDigest, generationId, LIVE_ROLE);
    assert.strictEqual(startingState.state, 'STARTING');
    const seeded = rll.transitionRoleBinding(dir, worktreeId, planDigest, profileDigest, generationId, LIVE_ROLE, 'STARTING', 'READY', startingState.record, {});
    assert.strictEqual(seeded.ok, true, JSON.stringify(seeded));
    const readyBindingId = seeded.record.binding_id;

    // The STALE action_id -- minted for the STARTING attempt that has
    // SINCE resolved to READY -- arrives late.
    const gFail = mintGrant(dir, sessionKey, LIVE_ROLE, 'action-failed', actionFailedDigest(staleActionId, 'native-tool-error'), { actionId: staleActionId });
    const rFail = runCli(['action-failed', '--action', staleActionId, '--reason', 'native-tool-error', '--lifecycle-binding', gFail.grantId]);
    assert.strictEqual(rFail.result.status, 'INVALID', JSON.stringify(rFail.result));
    assert.strictEqual(rFail.result.detail_code, 'ACTION_REPLAY', 'a stale action_id from before READY must be rejected as a replay, never accepted');

    // The binding is COMPLETELY untouched -- still READY, same binding_id,
    // never knocked down to UNAVAILABLE/QUARANTINED by a late-arriving
    // action-failed for a superseded attempt.
    const afterState = rll.readRoleBindingState(dir, worktreeId, planDigest, profileDigest, generationId, LIVE_ROLE);
    assert.strictEqual(afterState.state, 'READY', 'late action-failed over an ALREADY-READY binding must never knock it back down');
    assert.strictEqual(afterState.record.binding_id, readyBindingId);
  } finally {
    cleanup(dir);
  }
});

// R4 NO-GO round 2 (point 1): wait-ready must report a missing/invalid grant
// as a genuine AUTHORITY failure (INVALID/IDENTITY_MISMATCH), never
// disguised as an ordinary WAIT_TIMEOUT/READY_TIMEOUT that a caller could
// mistake for "the action is genuinely still starting."
test('wait-ready: a missing OR invalid (expired/replayed/wrong-action) grant is rejected as INVALID/IDENTITY_MISMATCH, never masqueraded as WAIT_TIMEOUT/READY_TIMEOUT', () => {
  const dir = makeGitProject();
  try {
    writePlanFixture(dir, 'handlers-wait-ready-authority');
    const sessionKey = 'wait-ready-authority-session';
    const spawnAction = ensureLiveRoleSpawnAction(dir, sessionKey);
    const actionId = spawnAction.action_id;

    // No grant at all.
    const rNoGrant = runCli(['wait-ready', '--action', actionId, '--timeout', '1']);
    assert.strictEqual(rNoGrant.result.status, 'INVALID', 'no grant: ' + JSON.stringify(rNoGrant.result));
    assert.strictEqual(rNoGrant.result.detail_code, 'IDENTITY_MISMATCH');
    assert.notStrictEqual(rNoGrant.result.status, 'WAITING', 'a missing grant must never masquerade as an ordinary wait');

    // A grant minted for a DIFFERENT action_id (wrong-binding correlation).
    const otherActionId = 'a'.repeat(32);
    const gWrongAction = mintGrant(dir, sessionKey, LIVE_ROLE, 'wait-ready', waitReadyDigest(otherActionId), { actionId: otherActionId });
    const rWrongAction = runCli(['wait-ready', '--action', actionId, '--timeout', '1', '--lifecycle-binding', gWrongAction.grantId]);
    assert.strictEqual(rWrongAction.result.status, 'INVALID', 'wrong-action grant: ' + JSON.stringify(rWrongAction.result));
    assert.strictEqual(rWrongAction.result.detail_code, 'IDENTITY_MISMATCH');

    // A genuinely consumed (replayed) grant.
    const gReplay = mintGrant(dir, sessionKey, LIVE_ROLE, 'wait-ready', waitReadyDigest(actionId), { actionId });
    const rFirst = runCli(['wait-ready', '--action', actionId, '--timeout', '1', '--lifecycle-binding', gReplay.grantId]);
    assert.strictEqual(rFirst.result.status, 'WAITING', 'first (valid) use: ' + JSON.stringify(rFirst.result));
    const rReplay = runCli(['wait-ready', '--action', actionId, '--timeout', '1', '--lifecycle-binding', gReplay.grantId]);
    assert.strictEqual(rReplay.result.status, 'INVALID', 'replayed grant: ' + JSON.stringify(rReplay.result));
    assert.strictEqual(rReplay.result.detail_code, 'IDENTITY_MISMATCH');
  } finally {
    cleanup(dir);
  }
});

// R4 round 3 (block 1c, corrected round 4 per empirical auditor feedback):
// a NONEXISTENT action_id is never an "authorized wait" AT ALL, regardless
// of whether a --lifecycle-binding value is supplied and regardless of
// whether it happens to reference a grant that is otherwise perfectly
// well-formed. A real `ensure` call always mints the action BEFORE ever
// handing a caller a grant reference to it, so a grant whose action_id
// points at nothing is itself evidence of a phantom/stale/adversarial
// reference -- accepting AND CONSUMING it (even to return a benign-looking
// WAIT_TIMEOUT) would burn a one-use token against nothing real. The prior
// design's cross-repo grant scan (self-referentially echoing the grant's
// OWN role back as the "expected" one) was WRONG: it let a genuinely
// well-formed grant for a phantom action_id be consumed and answered with
// WAIT_TIMEOUT. That entire mechanism is removed -- the grants/ registry
// is never even consulted when the action is absent.
test('wait-ready on a NONEXISTENT action_id is UNCONDITIONALLY rejected as IDENTITY_MISMATCH, and the grants/ registry is never even consulted -- true regardless of whether --lifecycle-binding is omitted, references a grant scoped to a DIFFERENT action, or references a grant PERFECTLY scoped to this exact (still nonexistent) action_id (R4 round 3, block 1c, corrected round 4)', () => {
  const dir = makeGitProject();
  try {
    writePlanFixture(dir, 'handlers-r3-wait-ready-absent-action');
    const sessionKey = 'r3-wait-ready-absent-action-session';
    // Never minted as a real action anywhere -- purely a well-shaped hex id.
    const phantomActionId = '9'.repeat(32);

    // No grant at all.
    const rNoGrant = runCli(['wait-ready', '--action', phantomActionId, '--timeout', '1']);
    assert.strictEqual(rNoGrant.result.status, 'INVALID', 'phantom action, no grant: ' + JSON.stringify(rNoGrant.result));
    assert.strictEqual(rNoGrant.result.detail_code, 'IDENTITY_MISMATCH');
    assert.notStrictEqual(rNoGrant.result.status, 'WAITING', 'a missing grant must never masquerade as an ordinary wait, even for a nonexistent action');

    // A well-formed, unexpired, unreplayed grant that exists but was minted
    // for a DIFFERENT action_id.
    const otherPhantomActionId = '8'.repeat(32);
    const gWrongAction = mintGrant(dir, sessionKey, null, 'wait-ready', waitReadyDigest(otherPhantomActionId), { actionId: otherPhantomActionId });
    const rWrongAction = runCli(['wait-ready', '--action', phantomActionId, '--timeout', '1', '--lifecycle-binding', gWrongAction.grantId]);
    assert.strictEqual(rWrongAction.result.status, 'INVALID', 'grant scoped to a different phantom action: ' + JSON.stringify(rWrongAction.result));
    assert.strictEqual(rWrongAction.result.detail_code, 'IDENTITY_MISMATCH');

    // Round 4 correction: even a grant PERFECTLY, genuinely scoped to THIS
    // exact phantom action_id (subcommand/argv-digest/action_id/role all
    // correlate correctly) is STILL rejected -- the action itself simply
    // does not exist, and that alone is disqualifying, independent of the
    // grant's own validity. This is the auditor-identified correction: the
    // OLD design accepted and consumed this exact grant, answering
    // WAIT_TIMEOUT.
    const gCorrect = mintGrant(dir, sessionKey, null, 'wait-ready', waitReadyDigest(phantomActionId), { actionId: phantomActionId });
    const rCorrect = runCli(['wait-ready', '--action', phantomActionId, '--timeout', '1', '--lifecycle-binding', gCorrect.grantId]);
    assert.strictEqual(rCorrect.result.status, 'INVALID', 'even a PERFECTLY scoped grant must never be honored for a nonexistent action: ' + JSON.stringify(rCorrect.result));
    assert.strictEqual(rCorrect.result.detail_code, 'IDENTITY_MISMATCH');
    assert.notStrictEqual(rCorrect.result.status, 'WAITING', 'never a masqueraded wait, even with an otherwise-valid grant');

    // The perfectly-scoped grant was NEVER consumed -- the grants/ registry
    // is never even touched when the action is absent, so no .consumed
    // marker exists for it (it remains available, unburned, exactly as if
    // this call had never happened).
    const consumedMarkerPath = rll.grantConsumedMarkerPathFor(dir, gCorrect.grantId);
    assert.strictEqual(fs.existsSync(consumedMarkerPath), false, 'a nonexistent-action wait-ready must never consume ANY grant, even a perfectly-scoped one');
  } finally {
    cleanup(dir);
  }
});

// R4 NO-GO round 2 (point 3): rotate must reuse ensure's SAME
// lifecycle-eligible driver selection -- claude-agent/codex-mcp/
// runtime-spawn have no ensure()-mintable (or rotate-mintable) persistent
// action at all and must never be converted into a dishonestly-labeled
// role-spawn/claude-native action, exactly like ensure's own point-C.1/3.2
// fix already prevents for the FIRST spawn.
test('rotate: routing/capability landing on claude-agent (capability-proven, routing-permitted, but lifecycle-ineligible) is UNAVAILABLE, never mints a role-spawn action carrying a dishonest claude-native driver literal (R4 round 2, point 3)', () => {
  const dir = makeGitProject();
  try {
    writePlanFixture(dir, 'handlers-r2p3-rotate-ineligible');
    const sessionKey = 'r2p3-rotate-ineligible-session';
    ensureLiveRoleSpawnAction(dir, sessionKey);
    const worktreeId = rll.computeWorktreeId(dir);
    const planDigest = rll.discoverPlan(dir).planDigest;
    const generationId = rll.resolveSessionGeneration(dir, identityFor(sessionKey)).generationId;
    const profileDigest = rll.roleProfileDigestFor(LIVE_ROLE);
    const startingState = rll.readRoleBindingState(dir, worktreeId, planDigest, profileDigest, generationId, LIVE_ROLE);
    const seeded = rll.transitionRoleBinding(dir, worktreeId, planDigest, profileDigest, generationId, LIVE_ROLE, 'STARTING', 'READY', startingState.record, {});
    assert.strictEqual(seeded.ok, true, JSON.stringify(seeded));

    // arch-testing routes claude-sendmessage, claude-agent, codex-app-server,
    // ... ; NEITHER claude-sendmessage NOR codex-app-server is proven here,
    // only claude-agent -- capability-proven, routing-permitted, but
    // lifecycle-ineligible.
    const gRotate = mintGrant(dir, sessionKey, LIVE_ROLE, 'rotate', rotateDigest(LIVE_ROLE));
    const rRotate = runCli(['rotate', '--project-root', dir, '--role', LIVE_ROLE, '--lifecycle-binding', gRotate.grantId], { RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES: JSON.stringify(['claude-agent']) });
    assert.strictEqual(rRotate.result.status, 'UNAVAILABLE', JSON.stringify(rRotate.result));
    assert.deepStrictEqual(rRotate.result.actions, [], 'must mint NOTHING, never a fabricated role-spawn');

    // No stray action file of ANY kind was minted for this rotate attempt
    // beyond the ones ensureLiveRoleSpawnAction's OWN fixture setup already
    // created (team-ensure + the original role-spawn) -- exactly 2, never 3.
    const repoId = rll.computeRepoId(dir);
    const actionsDir = path.join(rll.registryRepoDir({ repoId }), 'actions');
    const actionFiles = fs.readdirSync(actionsDir).filter((f) => f.endsWith('.json'));
    assert.strictEqual(actionFiles.length, 2, 'rotate must mint zero NEW action files: ' + JSON.stringify(actionFiles));
  } finally {
    cleanup(dir);
  }
});

test('rotate: noop, NO registered disk consumer, is UNAVAILABLE and quarantines rather than a false READY (R4 round 2, point 3)', () => {
  const dir = makeGitProject();
  try {
    writePlanFixture(dir, 'handlers-r2p3-rotate-noop-no-consumer');
    const sessionKey = 'r2p3-rotate-noop-no-consumer-session';
    ensureLiveRoleSpawnAction(dir, sessionKey);
    const worktreeId = rll.computeWorktreeId(dir);
    const planDigest = rll.discoverPlan(dir).planDigest;
    const generationId = rll.resolveSessionGeneration(dir, identityFor(sessionKey)).generationId;
    const profileDigest = rll.roleProfileDigestFor(LIVE_ROLE);
    const startingState = rll.readRoleBindingState(dir, worktreeId, planDigest, profileDigest, generationId, LIVE_ROLE);
    const seeded = rll.transitionRoleBinding(dir, worktreeId, planDigest, profileDigest, generationId, LIVE_ROLE, 'STARTING', 'READY', startingState.record, {});
    assert.strictEqual(seeded.ok, true, JSON.stringify(seeded));

    // Nothing capability-proven at all -- selection can only ever reach
    // noop (last in every role's routing list), and no consumer is
    // registered for this role.
    const gRotate = mintGrant(dir, sessionKey, LIVE_ROLE, 'rotate', rotateDigest(LIVE_ROLE));
    const rRotate = runCli(['rotate', '--project-root', dir, '--role', LIVE_ROLE, '--lifecycle-binding', gRotate.grantId], { RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES: NOOP_CAPS });
    assert.strictEqual(rRotate.result.status, 'UNAVAILABLE', JSON.stringify(rRotate.result));
    assert.deepStrictEqual(rRotate.result.bindings, [], 'noop must never declare a binding READY without a registered, validated consumer');
  } finally {
    cleanup(dir);
  }
});

test('rotate: noop, WITH a registered+validated disk consumer, genuinely reaches READY (R4 round 2, point 3)', () => {
  const dir = makeGitProject();
  try {
    writePlanFixture(dir, 'handlers-r2p3-rotate-noop-consumer');
    const sessionKey = 'r2p3-rotate-noop-consumer-session';
    ensureLiveRoleSpawnAction(dir, sessionKey);
    const worktreeId = rll.computeWorktreeId(dir);
    const planDigest = rll.discoverPlan(dir).planDigest;
    const generationId = rll.resolveSessionGeneration(dir, identityFor(sessionKey)).generationId;
    const profileDigest = rll.roleProfileDigestFor(LIVE_ROLE);
    const startingState = rll.readRoleBindingState(dir, worktreeId, planDigest, profileDigest, generationId, LIVE_ROLE);
    const seeded = rll.transitionRoleBinding(dir, worktreeId, planDigest, profileDigest, generationId, LIVE_ROLE, 'STARTING', 'READY', startingState.record, {});
    assert.strictEqual(seeded.ok, true, JSON.stringify(seeded));

    const gRotate = mintGrant(dir, sessionKey, LIVE_ROLE, 'rotate', rotateDigest(LIVE_ROLE));
    const rRotate = runCli(['rotate', '--project-root', dir, '--role', LIVE_ROLE, '--lifecycle-binding', gRotate.grantId], { RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES: NOOP_CAPS, RUNTIME_ROLE_LIFECYCLE_TEST_DISK_CONSUMERS: JSON.stringify([LIVE_ROLE]) });
    assert.strictEqual(rRotate.result.status, 'READY', JSON.stringify(rRotate.result));
    assert.strictEqual(rRotate.result.bindings[0].driver, 'noop');
  } finally {
    cleanup(dir);
  }
});

// WP3 item C correction pass R2 (point 1): SupervisorLifecycleTransaction --
// a GENUINE deterministic multi-process race, not a sequential simulation.
// Two REAL, separately-spawned OS processes call `ensure` for DISJOINT
// roles against the exact same scope, both racing
// mintSupervisorBatchUnderTransaction's single lock. A test-only
// RUNTIME_ROLE_LIFECYCLE_TEST_TX_DELAY_MS widens the critical section so the
// second process's real busy-spin (withRegistryLock, 2000 attempts, no
// backoff) has ample time to observe the lock genuinely held rather than
// racing past it by luck.
test('SupervisorLifecycleTransaction: two concurrent REAL processes ensure()-ing DISJOINT roles for the SAME scope produce EXACTLY ONE action total, and the loser leaves zero orphaned action files (point 1, deterministic multi-process race)', async () => {
  const dir = makeGitProject();
  try {
    writePlanFixture(dir, 'handlers-tx-race');
    const sessionKey = 'tx-race-session';
    const gQG = mintGrant(dir, sessionKey, 'quality-gater', 'ensure', ensureDigest(['quality-gater']));
    const gV = mintGrant(dir, sessionKey, 'verifier', 'ensure', ensureDigest(['verifier']));

    const raceEnv = { RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES: CODEX_CAPS, RUNTIME_ROLE_LIFECYCLE_TEST_TX_DELAY_MS: '150' };
    const [rQG, rV] = await Promise.all([
      runCliAsync(['ensure', '--project-root', dir, '--role', 'quality-gater', '--lifecycle-binding', gQG.grantId], raceEnv),
      runCliAsync(['ensure', '--project-root', dir, '--role', 'verifier', '--lifecycle-binding', gV.grantId], raceEnv),
    ]);

    const results = [rQG, rV];
    const winners = results.filter((r) => r.result.status === 'ACTION_REQUIRED');
    const losers = results.filter((r) => r.result.status === 'UNAVAILABLE');
    assert.strictEqual(winners.length, 1, 'exactly ONE of the two concurrent processes mints -- never both, never neither: ' + JSON.stringify(results.map((r) => r.result)));
    assert.strictEqual(losers.length, 1, 'the other is cleanly UNAVAILABLE, never a second competing action');
    assert.strictEqual(winners[0].result.actions.length, 1);
    const winningActionId = winners[0].result.actions[0].action_id;

    // No orphaned action files: exactly one supervisor-start action exists
    // on disk for this scope, and it IS the winner's reported action.
    const repoId = rll.computeRepoId(dir);
    const actionsDir = path.join(rll.registryRepoDir({ repoId }), 'actions');
    const actionFiles = fs.readdirSync(actionsDir).filter((f) => f.endsWith('.json'));
    const supervisorStartActions = actionFiles
      .map((f) => JSON.parse(fs.readFileSync(path.join(actionsDir, f), 'utf8')))
      .filter((a) => a.kind === 'supervisor-start');
    assert.strictEqual(supervisorStartActions.length, 1, 'no orphaned action file from the loser -- exactly one supervisor-start action exists: ' + JSON.stringify(supervisorStartActions.map((a) => a.action_id)));
    assert.strictEqual(supervisorStartActions[0].action_id, winningActionId);

    // The durable SupervisorLifecycleOwner marker agrees with the winner.
    const worktreeId = rll.computeWorktreeId(dir);
    const planDigest = rll.discoverPlan(dir).planDigest;
    const generationId = rll.resolveSessionGeneration(dir, identityFor(sessionKey)).generationId;
    const coordinationRootId = rll.computeCoordinationRootId(dir);
    const ownerPath = rll.supervisorLifecycleOwnerPathFor(dir, coordinationRootId);
    const owner = JSON.parse(fs.readFileSync(ownerPath, 'utf8'));
    assert.strictEqual(owner.schema, rll.SUPERVISOR_LIFECYCLE_OWNER_SCHEMA);
    assert.strictEqual(owner.action_id, winningActionId);
    assert.strictEqual(owner.state, 'ACTIVE');
    assert.strictEqual(owner.coordination_root_id, coordinationRootId);

    // The LOSING role's own binding never advanced past ABSENT (never
    // falsely claimed STARTING/READY by the process that lost the race).
    const loserRole = losers[0] === rQG ? 'quality-gater' : 'verifier';
    const loserProfileDigest = rll.roleProfileDigestFor(loserRole);
    const loserState = rll.readRoleBindingState(dir, worktreeId, planDigest, loserProfileDigest, generationId, loserRole);
    assert.strictEqual(loserState.state, 'ABSENT');
  } finally {
    cleanup(dir);
  }
});

// WP3 item C correction pass R2 (point 5): TWO REAL git worktrees of the
// SAME repository (git's own --git-common-dir, so computeRepoId is
// IDENTICAL -- both worktrees share the SAME registry directory) sharing
// the SAME committed PLAN.md (same plan_digest) and the SAME identity tuple
// (same session_generation_id, itself repo-scoped) -- everything overlaps
// EXCEPT computeWorktreeId (git's own --show-toplevel, necessarily distinct
// per worktree). Proves worktree_id alone is sufficient isolation: each
// worktree independently mints its OWN singleton supervisor for the SAME
// role, with zero cross-worktree collision anywhere in the shared registry.
test('worktree isolation: two REAL git worktrees of the SAME repo, SAME committed PLAN, SAME session identity mint INDEPENDENT supervisor-start batches for the SAME role with zero collision (point 5)', () => {
  const dir = makeGitProject('rll-handlers-wt-main-');
  const worktreeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rll-handlers-wt-second-'));
  fs.rmdirSync(worktreeDir); // git worktree add requires the target not yet exist
  try {
    // Committed (not merely written) so the SAME bytes are checked out
    // identically into the second worktree -- git worktrees share history,
    // never uncommitted working-tree state from the original checkout.
    writePlanFixture(dir, 'handlers-worktree-iso');
    execFileSync('git', ['-C', dir, 'add', '.planning']);
    execFileSync('git', ['-C', dir, 'commit', '-q', '-m', 'add PLAN fixture']);
    execFileSync('git', ['-C', dir, 'worktree', 'add', '-q', worktreeDir, '-b', 'wt-second-branch']);

    const repoIdMain = rll.computeRepoId(dir);
    const repoIdSecond = rll.computeRepoId(worktreeDir);
    assert.strictEqual(repoIdSecond, repoIdMain, 'both worktrees of the same repo share the SAME repoId (git --git-common-dir)');
    const worktreeIdMain = rll.computeWorktreeId(dir);
    const worktreeIdSecond = rll.computeWorktreeId(worktreeDir);
    assert.notStrictEqual(worktreeIdSecond, worktreeIdMain, 'each worktree gets its OWN distinct worktreeId (git --show-toplevel)');
    const planMain = rll.discoverPlan(dir);
    const planSecond = rll.discoverPlan(worktreeDir);
    assert.strictEqual(planSecond.planDigest, planMain.planDigest, 'the SAME committed PLAN.md bytes in both worktrees');

    const sessionKey = 'worktree-iso-session';
    const identity = identityFor(sessionKey);
    const genMain = rll.resolveSessionGeneration(dir, identity);
    const genSecond = rll.resolveSessionGeneration(worktreeDir, identity);
    assert.strictEqual(genSecond.generationId, genMain.generationId, 'the SAME identity tuple resolves to the SAME session_generation_id (repo-scoped, not worktree-scoped)');

    // Independently ensure() the SAME role from EACH worktree -- both must
    // succeed with their OWN action, never colliding on the shared registry.
    const gMain = mintGrant(dir, sessionKey, 'verifier', 'ensure', ensureDigest(['verifier']));
    const rMain = runCli(['ensure', '--project-root', dir, '--role', 'verifier', '--lifecycle-binding', gMain.grantId], { RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES: CODEX_CAPS });
    assert.strictEqual(rMain.result.status, 'ACTION_REQUIRED', JSON.stringify(rMain.result));

    const gSecond = mintGrant(worktreeDir, sessionKey, 'verifier', 'ensure', ensureDigest(['verifier']));
    const rSecond = runCli(['ensure', '--project-root', worktreeDir, '--role', 'verifier', '--lifecycle-binding', gSecond.grantId], { RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES: CODEX_CAPS });
    assert.strictEqual(rSecond.result.status, 'ACTION_REQUIRED', JSON.stringify(rSecond.result));

    assert.notStrictEqual(rSecond.result.actions[0].action_id, rMain.result.actions[0].action_id, 'two genuinely DIFFERENT actions, never the second worktree colliding with (or reusing) the first');
    assert.strictEqual(rMain.result.actions[0].worktree_id, worktreeIdMain);
    assert.strictEqual(rSecond.result.actions[0].worktree_id, worktreeIdSecond);

    // Each worktree's OWN singleton owner marker exists, distinct, and each
    // still reports its OWN action when re-ensured -- neither worktree's
    // supervisor pre-check (mintSupervisorBatchUnderTransaction) ever
    // observed the OTHER'S owner record.
    const profileDigest = rll.roleProfileDigestFor('verifier');
    const stateMain = rll.readRoleBindingState(dir, worktreeIdMain, planMain.planDigest, profileDigest, genMain.generationId, 'verifier');
    const stateSecond = rll.readRoleBindingState(worktreeDir, worktreeIdSecond, planSecond.planDigest, profileDigest, genSecond.generationId, 'verifier');
    assert.strictEqual(stateMain.state, 'STARTING');
    assert.strictEqual(stateSecond.state, 'STARTING');
    assert.strictEqual(stateMain.record.pending_action_id, rMain.result.actions[0].action_id);
    assert.strictEqual(stateSecond.record.pending_action_id, rSecond.result.actions[0].action_id);

    const coordinationRootIdMain = rll.computeCoordinationRootId(dir);
    const coordinationRootIdSecond = rll.computeCoordinationRootId(worktreeDir);
    assert.notStrictEqual(coordinationRootIdSecond, coordinationRootIdMain, 'each worktree gets its OWN distinct coordination_root_id (a deterministic function of its own realpath, point B.1)');
    const ownerMainPath = rll.supervisorLifecycleOwnerPathFor(dir, coordinationRootIdMain);
    const ownerSecondPath = rll.supervisorLifecycleOwnerPathFor(worktreeDir, coordinationRootIdSecond);
    assert.notStrictEqual(ownerMainPath, ownerSecondPath, 'the two owner marker paths are structurally disjoint (coordination_root_id is a path segment)');
    assert.ok(fs.existsSync(ownerMainPath));
    assert.ok(fs.existsSync(ownerSecondPath));
  } finally {
    try { execFileSync('git', ['-C', dir, 'worktree', 'remove', '--force', worktreeDir]); } catch (err) { fs.rmSync(worktreeDir, { recursive: true, force: true }); }
    cleanup(dir);
  }
});

// WP3 item C correction pass R3 (points B.1/B.2): the SAME genuine
// multi-process race as SupervisorLifecycleTransaction above, but this time
// the two REAL processes use TWO DIFFERENT session identities -- hence two
// DIFFERENT session_generation_ids -- for DISJOINT roles at the SAME
// coordination root. Before point B.1, the owner marker's scope INCLUDED
// session_generation_id, so this exact combination raced past the
// singleton entirely (each generation saw its own independent ABSENT owner
// slot) and could mint TWO competing supervisor-start batches at once. Now
// the owner marker is anchored to coordination_root_id alone: exactly one
// of the two still wins, regardless of generation.
test('SupervisorLifecycleTransaction: two concurrent REAL processes under TWO DIFFERENT session generations, ensure()-ing DISJOINT roles for the SAME coordination root, still produce EXACTLY ONE action total (point B.1/B.2 cross-generation singleton)', async () => {
  const dir = makeGitProject();
  try {
    writePlanFixture(dir, 'handlers-tx-race-crossgen');
    const sessionKeyA = 'crossgen-session-A';
    const sessionKeyB = 'crossgen-session-B';
    const gQG = mintGrant(dir, sessionKeyA, 'quality-gater', 'ensure', ensureDigest(['quality-gater']));
    const gV = mintGrant(dir, sessionKeyB, 'verifier', 'ensure', ensureDigest(['verifier']));

    // Test fixture sanity: the two identities must resolve to DIFFERENT
    // session_generation_ids, or this test silently degenerates into a
    // same-generation repeat of the race test above and proves nothing new.
    const genA = rll.resolveSessionGeneration(dir, identityFor(sessionKeyA)).generationId;
    const genB = rll.resolveSessionGeneration(dir, identityFor(sessionKeyB)).generationId;
    assert.notStrictEqual(genA, genB);

    const raceEnv = { RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES: CODEX_CAPS, RUNTIME_ROLE_LIFECYCLE_TEST_TX_DELAY_MS: '150' };
    const [rQG, rV] = await Promise.all([
      runCliAsync(['ensure', '--project-root', dir, '--role', 'quality-gater', '--lifecycle-binding', gQG.grantId], raceEnv),
      runCliAsync(['ensure', '--project-root', dir, '--role', 'verifier', '--lifecycle-binding', gV.grantId], raceEnv),
    ]);

    const results = [rQG, rV];
    const winners = results.filter((r) => r.result.status === 'ACTION_REQUIRED');
    const losers = results.filter((r) => r.result.status === 'UNAVAILABLE');
    assert.strictEqual(winners.length, 1, 'exactly ONE of the two concurrent processes mints, even across two DIFFERENT session generations: ' + JSON.stringify(results.map((r) => r.result)));
    assert.strictEqual(losers.length, 1, 'the other is cleanly UNAVAILABLE, never a second competing action');
    assert.strictEqual(winners[0].result.actions.length, 1);
    const winningActionId = winners[0].result.actions[0].action_id;

    const repoId = rll.computeRepoId(dir);
    const actionsDir = path.join(rll.registryRepoDir({ repoId }), 'actions');
    const supervisorStartActions = fs.readdirSync(actionsDir).filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(fs.readFileSync(path.join(actionsDir, f), 'utf8')))
      .filter((a) => a.kind === 'supervisor-start');
    assert.strictEqual(supervisorStartActions.length, 1, 'no orphaned action file from the loser, even across generations: ' + JSON.stringify(supervisorStartActions.map((a) => a.action_id)));
    assert.strictEqual(supervisorStartActions[0].action_id, winningActionId);

    const coordinationRootId = rll.computeCoordinationRootId(dir);
    const ownerPath = rll.supervisorLifecycleOwnerPathFor(dir, coordinationRootId);
    const owner = JSON.parse(fs.readFileSync(ownerPath, 'utf8'));
    assert.strictEqual(owner.schema, rll.SUPERVISOR_LIFECYCLE_OWNER_SCHEMA);
    assert.strictEqual(owner.action_id, winningActionId);
    assert.strictEqual(owner.state, 'ACTIVE');
    assert.strictEqual(owner.coordination_root_id, coordinationRootId);

    // The loser's own role-binding, under ITS OWN generation, never
    // advanced past ABSENT (never falsely claimed STARTING/READY by the
    // process that lost the race).
    const loserRole = losers[0] === rQG ? 'quality-gater' : 'verifier';
    const loserGenerationId = loserRole === 'quality-gater' ? genA : genB;
    const loserProfileDigest = rll.roleProfileDigestFor(loserRole);
    const worktreeId = rll.computeWorktreeId(dir);
    const planDigest = rll.discoverPlan(dir).planDigest;
    const loserState = rll.readRoleBindingState(dir, worktreeId, planDigest, loserProfileDigest, loserGenerationId, loserRole);
    assert.strictEqual(loserState.state, 'ABSENT');
  } finally {
    cleanup(dir);
  }
});

// WP3 item C correction pass R3 (point B.3): a crash that kills the
// process BEFORE it ever calls action-failed must not leave the
// coordination root permanently, silently blocked. A LATER mint attempt
// independently re-checks whether the STILL-ACTIVE owner's OWN referenced
// action has since expired -- self-healing without any external signal or
// operator intervention, bounded by that action's own TTL rather than an
// unbounded wait.
test('SupervisorLifecycleTransaction: an ACTIVE owner whose referenced action has expired self-heals on the NEXT mint attempt -- crash-without-action-failed is still recoverable (point B.3)', async () => {
  const dir = makeGitProject();
  try {
    writePlanFixture(dir, 'handlers-tx-stale-heal');
    // A 1-second ready_timeout_seconds policy so the FIRST batch's own
    // action genuinely expires within this test's real wall-clock budget --
    // this file's registry clock has no fixed-clock test seam (by design,
    // matching every other TTL proof in this suite).
    fs.mkdirSync(path.join(dir, 'scripts', 'lib'), { recursive: true });
    const toolkitPolicy = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../lib/runtime-collaboration-policy.json'), 'utf8'));
    fs.writeFileSync(path.join(dir, 'scripts', 'lib', 'runtime-collaboration-policy.json'), JSON.stringify(Object.assign({}, toolkitPolicy, { ready_timeout_seconds: 1 })));
    fs.copyFileSync(path.resolve(__dirname, '../lib/runtime-routing.json'), path.join(dir, 'scripts', 'lib', 'runtime-routing.json'));

    const sessionKey = 'stale-heal-session';
    const g1 = mintGrant(dir, sessionKey, 'verifier', 'ensure', ensureDigest(['verifier']));
    const r1 = runCli(['ensure', '--project-root', dir, '--role', 'verifier', '--lifecycle-binding', g1.grantId], { RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES: CODEX_CAPS });
    assert.strictEqual(r1.result.status, 'ACTION_REQUIRED', JSON.stringify(r1.result));
    const firstActionId = r1.result.actions[0].action_id;

    const coordinationRootId = rll.computeCoordinationRootId(dir);
    const ownerPath = rll.supervisorLifecycleOwnerPathFor(dir, coordinationRootId);
    const ownerBefore = JSON.parse(fs.readFileSync(ownerPath, 'utf8'));
    assert.strictEqual(ownerBefore.state, 'ACTIVE');
    assert.strictEqual(ownerBefore.action_id, firstActionId);

    // Simulate a crash: NO action-failed is ever called for firstActionId.
    // Wait out its real 1-second TTL -- no fixed-clock seam exists in this
    // file to fast-forward instead.
    await new Promise((resolve) => setTimeout(resolve, 1300));

    // A SECOND, INDEPENDENT role (quality-gater) under a NEW session
    // generation now attempts to ensure() against the SAME coordination
    // root. Before point B.3, this would report UNAVAILABLE forever -- the
    // stale owner's mere ACTIVE presence blocked it with no recovery path
    // short of manual registry surgery.
    const g2 = mintGrant(dir, 'stale-heal-session-2', 'quality-gater', 'ensure', ensureDigest(['quality-gater']));
    const r2 = runCli(['ensure', '--project-root', dir, '--role', 'quality-gater', '--lifecycle-binding', g2.grantId], { RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES: CODEX_CAPS });
    assert.strictEqual(r2.result.status, 'ACTION_REQUIRED', 'the coordination root must self-heal and admit a fresh batch once the stale owner\'s action has expired: ' + JSON.stringify(r2.result));
    const secondActionId = r2.result.actions[0].action_id;
    assert.notStrictEqual(secondActionId, firstActionId);

    const ownerAfter = JSON.parse(fs.readFileSync(ownerPath, 'utf8'));
    assert.strictEqual(ownerAfter.state, 'ACTIVE', 'the owner record now backs the FRESH batch');
    assert.strictEqual(ownerAfter.action_id, secondActionId);
    assert.strictEqual(ownerAfter.coordination_root_id, coordinationRootId);
  } finally {
    cleanup(dir);
  }
});

// WP3 item C correction pass R3 (point C.1), REVISED by point 3.2 (R4):
// claude-agent/codex-mcp/runtime-spawn have NO ensure()-mintable persistent
// role-lifecycle-action (PLAN.md's closed action kind/runtime union,
// ~L154-163, has no member for any of the three) -- resolving to one of
// them must never mint a role-spawn action carrying a dishonest
// `claude-native` driver literal (what a prior catch-all `claudeGroup`
// bucket did). Point 3.2 REVERSES how persistent ensure() reacts to that,
// though: it must ITERATE PAST them to the next routing-permitted,
// capability-proven driver, never stop/report UNAVAILABLE the instant
// selection lands on one. This test's OWN outcome is still UNAVAILABLE --
// but only because, in THIS fixture, nothing else (including noop, absent
// a registered consumer) is available EITHER; it is no longer proof that
// ensure() stopped AT the ineligible driver. The next test proves genuine
// continuation past one to a real, different, mintable driver.
test('ensure: a role whose ONLY capability-proven, routing-permitted driver is codex-mcp, claude-agent, or runtime-spawn (and noop lacks a registered consumer) reports UNAVAILABLE and mints NOTHING', () => {
  for (const onlyDriver of ['codex-mcp', 'claude-agent', 'runtime-spawn']) {
    const dir = makeGitProject();
    try {
      writePlanFixture(dir, 'handlers-c1-driver-split-' + onlyDriver);
      const sessionKey = 'c1-driver-split-session-' + onlyDriver;
      const g1 = mintGrant(dir, sessionKey, 'verifier', 'ensure', ensureDigest(['verifier']));
      const r1 = runCli(['ensure', '--project-root', dir, '--role', 'verifier', '--lifecycle-binding', g1.grantId], { RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES: JSON.stringify([onlyDriver]) });
      assert.strictEqual(r1.result.status, 'UNAVAILABLE', onlyDriver + ': ' + JSON.stringify(r1.result));
      assert.strictEqual(r1.result.detail_code, 'CAPABILITY_UNAVAILABLE');
      assert.deepStrictEqual(r1.result.actions, [], onlyDriver + ': must mint NOTHING, never a fabricated role-spawn');

      // The role-binding itself never advanced past ABSENT -- no phantom
      // STARTING left referencing a nonexistent (or dishonestly-labeled)
      // action.
      const worktreeId = rll.computeWorktreeId(dir);
      const planDigest = rll.discoverPlan(dir).planDigest;
      const generationId = rll.resolveSessionGeneration(dir, identityFor(sessionKey)).generationId;
      const profileDigest = rll.roleProfileDigestFor('verifier');
      const state = rll.readRoleBindingState(dir, worktreeId, planDigest, profileDigest, generationId, 'verifier');
      assert.strictEqual(state.state, 'ABSENT', onlyDriver + ': no phantom binding left behind');

      // No stray action file of ANY kind was minted for this repo.
      const repoId = rll.computeRepoId(dir);
      const actionsDir = path.join(rll.registryRepoDir({ repoId }), 'actions');
      const actionFiles = fs.existsSync(actionsDir) ? fs.readdirSync(actionsDir).filter((f) => f.endsWith('.json')) : [];
      assert.strictEqual(actionFiles.length, 0, onlyDriver + ': zero action files minted anywhere for this repo');
    } finally {
      cleanup(dir);
    }
  }
});

test('ensure: routing/capability landing on claude-agent (capability-proven, routing-permitted, but lifecycle-ineligible) genuinely ITERATES PAST it to the next routing-permitted, capability-proven, lifecycle-eligible driver -- never stops there (point 3.2)', () => {
  const dir = makeGitProject();
  try {
    writePlanFixture(dir, 'handlers-32-iterate-past-ineligible');
    const sessionKey = 'handlers-32-session';
    // arch-testing routes claude-sendmessage, claude-agent, codex-app-server,
    // codex-mcp, runtime-spawn, noop (in that order). claude-sendmessage is
    // NOT capability-proven here, so selection reaches claude-agent first --
    // capability-proven but lifecycle-ineligible -- and must skip past it to
    // codex-app-server, which IS both capability-proven and lifecycle-eligible.
    const caps = JSON.stringify(['claude-agent', 'codex-app-server']);
    const g1 = mintGrant(dir, sessionKey, LIVE_ROLE, 'ensure', ensureDigest([LIVE_ROLE]));
    const r1 = runCli(['ensure', '--project-root', dir, '--role', LIVE_ROLE, '--lifecycle-binding', g1.grantId], { RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES: caps });
    assert.strictEqual(r1.result.status, 'ACTION_REQUIRED', JSON.stringify(r1.result));
    assert.strictEqual(r1.result.actions.length, 1);
    assert.strictEqual(r1.result.actions[0].kind, 'supervisor-start', 'must have genuinely resolved to codex-app-server, never claude-agent (no ensure()-mintable action exists for claude-agent at all)');
    const bridgeArgv = r1.result.actions[0].payload.bridge_argv;
    assert.strictEqual(bridgeArgv[bridgeArgv.indexOf('--role') + 1], LIVE_ROLE);
  } finally {
    cleanup(dir);
  }
});

// WP3 item C correction pass R3 (point C.3): fallback after a role-spawn
// (claude-sendmessage) failure. A FRESH generation for the SAME role must
// genuinely select the NEXT routing-permitted, capability-proven driver,
// never blindly re-select claude-sendmessage if it is no longer proven
// available. (Point 3.1, R4, additionally makes UNAVAILABLE retryable
// WITHIN the SAME generation too -- see the dedicated point-3.1 test right
// after this one; restart-invalidation is no longer the ONLY recovery
// path for this specific terminal state.)
test('fallback after role-spawn action-failed: a fresh session generation for the SAME role genuinely falls through to the next routing-permitted driver (point C.3)', () => {
  const dir = makeGitProject();
  try {
    writePlanFixture(dir, 'handlers-c3-fallback-rolespawn');
    const sessionKey = 'c3-fallback-rolespawn-session';
    const spawnAction = ensureLiveRoleSpawnAction(dir, sessionKey, LIVE_ROLE);
    assert.strictEqual(spawnAction.runtime, 'claude-native');

    const gFail = mintGrant(dir, sessionKey, LIVE_ROLE, 'action-failed', actionFailedDigest(spawnAction.action_id, 'native-tool-error'), { actionId: spawnAction.action_id });
    const failResult = runCli(['action-failed', '--action', spawnAction.action_id, '--reason', 'native-tool-error', '--lifecycle-binding', gFail.grantId]);
    assert.strictEqual(failResult.result.status, 'UNAVAILABLE', JSON.stringify(failResult.result));

    const worktreeId = rll.computeWorktreeId(dir);
    const planDigest = rll.discoverPlan(dir).planDigest;
    const oldGenerationId = rll.resolveSessionGeneration(dir, identityFor(sessionKey)).generationId;
    const profileDigest = rll.roleProfileDigestFor(LIVE_ROLE);
    const oldState = rll.readRoleBindingState(dir, worktreeId, planDigest, profileDigest, oldGenerationId, LIVE_ROLE);
    assert.strictEqual(oldState.state, 'UNAVAILABLE', 'the failed role-spawn leaves this exact generation terminal, never a phantom STARTING');

    // A FRESH generation (new identity tuple), with claude-sendmessage no
    // longer capability-proven but codex-app-server now proven, must select
    // codex-app-server -- genuine cross-driver fallback, not a retry of the
    // dead driver.
    const nextSessionKey = 'c3-fallback-rolespawn-session-next-gen';
    const g2 = mintGrant(dir, nextSessionKey, LIVE_ROLE, 'ensure', ensureDigest([LIVE_ROLE]));
    const r2 = runCli(['ensure', '--project-root', dir, '--role', LIVE_ROLE, '--lifecycle-binding', g2.grantId], { RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES: CODEX_CAPS });
    assert.strictEqual(r2.result.status, 'ACTION_REQUIRED', JSON.stringify(r2.result));
    assert.strictEqual(r2.result.actions[0].kind, 'supervisor-start', 'fell through to the next routing-permitted, capability-proven driver');
    assert.strictEqual(r2.result.actions[0].runtime, 'host-process');

    const newGenerationId = rll.resolveSessionGeneration(dir, identityFor(nextSessionKey)).generationId;
    assert.notStrictEqual(newGenerationId, oldGenerationId);
    const newState = rll.readRoleBindingState(dir, worktreeId, planDigest, profileDigest, newGenerationId, LIVE_ROLE);
    assert.strictEqual(newState.state, 'STARTING');
    assert.strictEqual(newState.record.driver, 'codex-app-server');
  } finally {
    cleanup(dir);
  }
});

// Point 3.1 (R4): action-failed must permit the NEXT driver within the SAME
// session generation -- UNAVAILABLE is retryable, not restart-only, for
// exactly this one cause (a prior driver-selection/action failure). Proven
// decisively by keeping the FAILED driver (claude-sendmessage) reported as
// STILL capability-available on the retry: if exclusion-by-history were not
// wired in, selection would blindly re-pick it (it is first in
// LIVE_ROLE's routing order) instead of genuinely falling through to
// codex-app-server.
test('action-failed same-generation fallback: a SECOND ensure call, SAME session generation, excludes exactly the driver that just failed and falls through to the next one -- even though that failed driver is STILL reported capability-available (point 3.1)', () => {
  const dir = makeGitProject();
  try {
    writePlanFixture(dir, 'handlers-31-same-gen-fallback');
    const sessionKey = '31-same-gen-fallback-session';
    const spawnAction = ensureLiveRoleSpawnAction(dir, sessionKey, LIVE_ROLE);
    assert.strictEqual(spawnAction.runtime, 'claude-native');

    const worktreeId = rll.computeWorktreeId(dir);
    const planDigest = rll.discoverPlan(dir).planDigest;
    const generationId = rll.resolveSessionGeneration(dir, identityFor(sessionKey)).generationId;
    const profileDigest = rll.roleProfileDigestFor(LIVE_ROLE);

    const gFail = mintGrant(dir, sessionKey, LIVE_ROLE, 'action-failed', actionFailedDigest(spawnAction.action_id, 'native-tool-error'), { actionId: spawnAction.action_id });
    const failResult = runCli(['action-failed', '--action', spawnAction.action_id, '--reason', 'native-tool-error', '--lifecycle-binding', gFail.grantId]);
    assert.strictEqual(failResult.result.status, 'UNAVAILABLE', JSON.stringify(failResult.result));
    const unavailableState = rll.readRoleBindingState(dir, worktreeId, planDigest, profileDigest, generationId, LIVE_ROLE);
    assert.strictEqual(unavailableState.state, 'UNAVAILABLE');
    assert.strictEqual(unavailableState.record.driver, 'claude-sendmessage');

    // SAME session_key -> SAME session_generation_id. claude-sendmessage is
    // STILL reported available (deliberately, to prove genuine exclusion-
    // by-history rather than mere unavailability); codex-app-server is now
    // ALSO available.
    const bothCaps = JSON.stringify(['claude-sendmessage', 'codex-app-server']);
    const g2 = mintGrant(dir, sessionKey, LIVE_ROLE, 'ensure', ensureDigest([LIVE_ROLE]));
    const r2 = runCli(['ensure', '--project-root', dir, '--role', LIVE_ROLE, '--lifecycle-binding', g2.grantId], { RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES: bothCaps });
    assert.strictEqual(r2.result.status, 'ACTION_REQUIRED', 'the SAME generation must be retryable after UNAVAILABLE (point 3.1): ' + JSON.stringify(r2.result));
    assert.strictEqual(r2.result.actions[0].kind, 'supervisor-start', 'must have excluded the just-failed claude-sendmessage and fallen through to codex-app-server, never re-selected the dead driver');

    const newGenerationId = rll.resolveSessionGeneration(dir, identityFor(sessionKey)).generationId;
    assert.strictEqual(newGenerationId, generationId, 'fixture sanity: this genuinely is the SAME generation, not a fresh one');
    const retriedState = rll.readRoleBindingState(dir, worktreeId, planDigest, profileDigest, generationId, LIVE_ROLE);
    assert.strictEqual(retriedState.state, 'STARTING');
    assert.strictEqual(retriedState.record.driver, 'codex-app-server');
    assert.strictEqual(Object.prototype.hasOwnProperty.call(retriedState.record, 'failure_reason'), false, 'the stale failure_reason from the UNAVAILABLE record must not survive onto the fresh STARTING record');
  } finally {
    cleanup(dir);
  }
});

// WP3 item C correction pass R3 (point C.3): fallback after a supervisor-
// start (codex-app-server) failure, mirroring the role-spawn case above --
// a fresh generation genuinely falls through to claude-sendmessage once
// codex-app-server is no longer capability-proven, rather than being
// blocked by the earlier failure or blindly re-selecting a dead driver.
test('fallback after supervisor-start action-failed: a fresh session generation for the SAME role genuinely falls through to the next routing-permitted driver (point C.3)', () => {
  const dir = makeGitProject();
  try {
    writePlanFixture(dir, 'handlers-c3-fallback-supstart');
    const sessionKey = 'c3-fallback-supstart-session';
    const g1 = mintGrant(dir, sessionKey, LIVE_ROLE, 'ensure', ensureDigest([LIVE_ROLE]));
    const r1 = runCli(['ensure', '--project-root', dir, '--role', LIVE_ROLE, '--lifecycle-binding', g1.grantId], { RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES: CODEX_CAPS });
    assert.strictEqual(r1.result.status, 'ACTION_REQUIRED', JSON.stringify(r1.result));
    assert.strictEqual(r1.result.actions[0].kind, 'supervisor-start');
    const firstActionId = r1.result.actions[0].action_id;

    const gFail = mintGrant(dir, sessionKey, null, 'action-failed', actionFailedDigest(firstActionId, 'deadline'), { actionId: firstActionId });
    const failResult = runCli(['action-failed', '--action', firstActionId, '--reason', 'deadline', '--lifecycle-binding', gFail.grantId]);
    assert.strictEqual(failResult.result.status, 'UNAVAILABLE', JSON.stringify(failResult.result));

    const worktreeId = rll.computeWorktreeId(dir);
    const planDigest = rll.discoverPlan(dir).planDigest;
    const oldGenerationId = rll.resolveSessionGeneration(dir, identityFor(sessionKey)).generationId;
    const profileDigest = rll.roleProfileDigestFor(LIVE_ROLE);
    const oldState = rll.readRoleBindingState(dir, worktreeId, planDigest, profileDigest, oldGenerationId, LIVE_ROLE);
    assert.strictEqual(oldState.state, 'UNAVAILABLE');

    const coordinationRootId = rll.computeCoordinationRootId(dir);
    const ownerPath = rll.supervisorLifecycleOwnerPathFor(dir, coordinationRootId);
    const owner = JSON.parse(fs.readFileSync(ownerPath, 'utf8'));
    assert.strictEqual(owner.state, 'TERMINATED', 'point B.4: the owner must be settled, never left blocking the coordination root');

    // A FRESH generation, with codex-app-server no longer capability-proven
    // but claude-sendmessage now proven, must select claude-sendmessage --
    // genuine cross-driver fallback via team-ensure.
    const nextSessionKey = 'c3-fallback-supstart-session-next-gen';
    const g2 = mintGrant(dir, nextSessionKey, LIVE_ROLE, 'ensure', ensureDigest([LIVE_ROLE]));
    const r2 = runCli(['ensure', '--project-root', dir, '--role', LIVE_ROLE, '--lifecycle-binding', g2.grantId], { RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES: LIVE_CAPS });
    assert.strictEqual(r2.result.status, 'ACTION_REQUIRED', JSON.stringify(r2.result));
    assert.strictEqual(r2.result.actions[0].kind, 'team-ensure', 'fell through to the next routing-permitted, capability-proven driver');
    assert.strictEqual(r2.result.actions[0].runtime, 'claude-native');
  } finally {
    cleanup(dir);
  }
});

// Point 2.2 (R4): the SAME coordination_root_id derivation across all
// three sites that independently compute it -- mint (the owner record's
// own field), the bridge (sha256 of a realpath'd --coordination-root argv
// value, mirroring runtime-bridge-codex.cjs's own computeCoordinationRootId
// exactly), and action-failed (terminalizeSupervisorStartAction's own
// extraction from the SAME bridge_argv). All three must agree byte-for-byte.
test('coordination_root_id derivation agrees across mint (owner record), the bridge formula, and action-failed extraction (point 2.2)', () => {
  const dir = makeGitProject();
  try {
    writePlanFixture(dir, 'handlers-c22-derivation');
    const sessionKey = 'c22-derivation-session';
    const g1 = mintGrant(dir, sessionKey, 'verifier', 'ensure', ensureDigest(['verifier']));
    const r1 = runCli(['ensure', '--project-root', dir, '--role', 'verifier', '--lifecycle-binding', g1.grantId], { RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES: CODEX_CAPS });
    assert.strictEqual(r1.result.status, 'ACTION_REQUIRED', JSON.stringify(r1.result));
    const action = r1.result.actions[0];

    // (a) mint-time: the owner record's own coordination_root_id.
    const mintTimeId = rll.computeCoordinationRootId(dir);
    const ownerPath = rll.supervisorLifecycleOwnerPathFor(dir, mintTimeId);
    const owner = JSON.parse(fs.readFileSync(ownerPath, 'utf8'));
    assert.strictEqual(owner.coordination_root_id, mintTimeId);

    // (b) the bridge's OWN formula (sha256 of a realpath'd argv value),
    // applied to the EXACT --coordination-root value baked into bridge_argv.
    // The bridge only ever runs AFTER root-init has created this directory
    // (BRIDGE-ROOT-03) -- simulate that here so the SAME hard realpath the
    // bridge itself performs can actually resolve.
    const argvCoordRoot = action.payload.bridge_argv[action.payload.bridge_argv.indexOf('--coordination-root') + 1];
    fs.mkdirSync(argvCoordRoot, { recursive: true, mode: 0o700 });
    fs.chmodSync(argvCoordRoot, 0o700);
    const bridgeFormulaId = crypto.createHash('sha256').update(Buffer.from(fs.realpathSync(argvCoordRoot), 'utf8')).digest('hex');
    assert.strictEqual(bridgeFormulaId, mintTimeId, 'the bridge\'s own sha256(realpath(argv value)) formula must agree with mint time');

    // (c) action-failed's own extraction (computeCoordinationRootIdFromPath
    // applied to the SAME raw argv string) -- proven by exercising the real
    // action-failed path and confirming it correctly finds/terminalizes
    // THIS exact owner record (which it could only do if its OWN
    // independently-derived id matches).
    const gFail = mintGrant(dir, sessionKey, null, 'action-failed', actionFailedDigest(action.action_id, 'native-tool-error'), { actionId: action.action_id });
    const rFail = runCli(['action-failed', '--action', action.action_id, '--reason', 'native-tool-error', '--lifecycle-binding', gFail.grantId]);
    assert.strictEqual(rFail.result.status, 'UNAVAILABLE', JSON.stringify(rFail.result));
    const ownerAfter = JSON.parse(fs.readFileSync(ownerPath, 'utf8'));
    assert.strictEqual(ownerAfter.state, 'TERMINATED', 'action-failed must have found and terminalized THIS exact owner record via its own independent coordination_root_id derivation');
  } finally {
    cleanup(dir);
  }
});

test('action-failed (supervisor-start): when the role-binding phase terminalizes nothing (anyTerminalized: false), the owner-termination step is never even ATTEMPTED -- ACTION_REPLAY implies zero mutation (point 2.3)', () => {
  const dir = makeGitProject();
  try {
    writePlanFixture(dir, 'handlers-c23-replay');
    const sessionKey = 'c23-replay-session';
    const g1 = mintGrant(dir, sessionKey, 'verifier', 'ensure', ensureDigest(['verifier']));
    const r1 = runCli(['ensure', '--project-root', dir, '--role', 'verifier', '--lifecycle-binding', g1.grantId], { RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES: CODEX_CAPS });
    assert.strictEqual(r1.result.status, 'ACTION_REQUIRED', JSON.stringify(r1.result));
    const action = r1.result.actions[0];

    const argvCoordRoot = action.payload.bridge_argv[action.payload.bridge_argv.indexOf('--coordination-root') + 1];
    fs.mkdirSync(argvCoordRoot, { recursive: true, mode: 0o700 });
    fs.chmodSync(argvCoordRoot, 0o700);
    const coordId = rll.computeCoordinationRootId(dir);
    const ownerPath = rll.supervisorLifecycleOwnerPathFor(dir, coordId);
    const ownerBytesBefore = fs.readFileSync(ownerPath, 'utf8');
    assert.strictEqual(JSON.parse(ownerBytesBefore).state, 'ACTIVE');

    // Simulate the role's binding having already been resolved via some
    // OTHER path (e.g. a racing successful `ready`) strictly BEFORE this
    // action-failed call ever runs -- pending_action_id no longer matches
    // (a fresh transition mints a new binding_id/state with no
    // pending_action_id at all), so the role-binding phase below
    // terminalizes NOTHING for this action_id: anyTerminalized stays
    // false, exactly like a pure replay.
    const profileDigest = rll.roleProfileDigestFor('verifier');
    const repoDescriptor = { repoId: action.repo_id };
    const startingState = rll.readRoleBindingState(repoDescriptor, action.worktree_id, action.plan_digest, profileDigest, action.session_generation_id, 'verifier');
    assert.strictEqual(startingState.state, 'STARTING', JSON.stringify(startingState));
    const seeded = rll.transitionRoleBinding(repoDescriptor, action.worktree_id, action.plan_digest, profileDigest, action.session_generation_id, 'verifier', 'STARTING', 'READY', startingState.record, {});
    assert.strictEqual(seeded.ok, true, JSON.stringify(seeded));

    // This IS the first (and only) action-failed call for this action_id --
    // but from the role-binding phase's perspective it finds nothing left
    // pending, exactly like a replay would.
    const gFail = mintGrant(dir, sessionKey, null, 'action-failed', actionFailedDigest(action.action_id, 'native-tool-error'), { actionId: action.action_id });
    const rFail = runCli(['action-failed', '--action', action.action_id, '--reason', 'native-tool-error', '--lifecycle-binding', gFail.grantId]);
    assert.strictEqual(rFail.result.status, 'INVALID', JSON.stringify(rFail.result));
    assert.strictEqual(rFail.result.detail_code, 'ACTION_REPLAY', JSON.stringify(rFail.result));

    const ownerBytesAfter = fs.readFileSync(ownerPath, 'utf8');
    assert.strictEqual(ownerBytesAfter, ownerBytesBefore, 'point 2.3: when anyTerminalized is false, the owner-termination step must never be attempted -- the owner record must remain byte-identical');
    assert.strictEqual(JSON.parse(ownerBytesAfter).state, 'ACTIVE', 'the owner must still be ACTIVE -- proving the unconditional-attempt code path that WOULD have terminalized it here (it is still ACTIVE with a matching action_id) never ran');
  } finally {
    cleanup(dir);
  }
});

test('action-failed (supervisor-start): a genuine owner-record read failure PROPAGATES as INTERNAL_ERROR rather than being silently swallowed, without rolling back the already-committed role-binding transition (point 2.4)', () => {
  const dir = makeGitProject();
  try {
    writePlanFixture(dir, 'handlers-c24-propagate');
    const sessionKey = 'c24-propagate-session';
    const g1 = mintGrant(dir, sessionKey, 'verifier', 'ensure', ensureDigest(['verifier']));
    const r1 = runCli(['ensure', '--project-root', dir, '--role', 'verifier', '--lifecycle-binding', g1.grantId], { RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES: CODEX_CAPS });
    assert.strictEqual(r1.result.status, 'ACTION_REQUIRED', JSON.stringify(r1.result));
    const action = r1.result.actions[0];

    const argvCoordRoot = action.payload.bridge_argv[action.payload.bridge_argv.indexOf('--coordination-root') + 1];
    fs.mkdirSync(argvCoordRoot, { recursive: true, mode: 0o700 });
    fs.chmodSync(argvCoordRoot, 0o700);
    const coordId = rll.computeCoordinationRootId(dir);
    const ownerPath = rll.supervisorLifecycleOwnerPathFor(dir, coordId);

    // Corrupt the owner record BEFORE calling action-failed -- a realistic
    // on-disk malformation (e.g. a partial/corrupted write from a crash),
    // never fabricated through the library's own API. This makes the
    // OWNER-SIDE step's own readSupervisorLifecycleOwnerState genuinely
    // fail, while leaving the role-binding side completely untouched.
    const ownerBefore = JSON.parse(fs.readFileSync(ownerPath, 'utf8'));
    assert.strictEqual(ownerBefore.state, 'ACTIVE');
    delete ownerBefore.session_generation_id;
    fs.writeFileSync(ownerPath, JSON.stringify(ownerBefore));

    const gFail = mintGrant(dir, sessionKey, null, 'action-failed', actionFailedDigest(action.action_id, 'native-tool-error'), { actionId: action.action_id });
    const rFail = runCli(['action-failed', '--action', action.action_id, '--reason', 'native-tool-error', '--lifecycle-binding', gFail.grantId]);
    assert.strictEqual(rFail.result.status, 'INVALID', JSON.stringify(rFail.result));
    assert.strictEqual(rFail.result.detail_code, 'INTERNAL_ERROR', 'point 2.4: a genuine owner-transition failure must PROPAGATE, never be silently swallowed as a benign UNAVAILABLE success');

    // The role-binding side already committed durably, inside the SAME
    // call, BEFORE the owner step ran -- it must NOT be rolled back merely
    // because the later, separate owner step failed.
    const profileDigest = rll.roleProfileDigestFor('verifier');
    const bindingState = rll.readRoleBindingState({ repoId: action.repo_id }, action.worktree_id, action.plan_digest, profileDigest, action.session_generation_id, 'verifier');
    assert.strictEqual(bindingState.ok, true, JSON.stringify(bindingState));
    assert.strictEqual(bindingState.state, 'UNAVAILABLE', 'the role-binding transition must have committed despite the later owner-side failure');
  } finally {
    cleanup(dir);
  }
});
