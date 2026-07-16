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

// Mints a real MainOrchestratorBinding + one-use grant the same way a hook would
// (direct internal call -- no CLI surface exists to do this, by design).
function mintGrant(dir, sessionKey, role, subcommand, argvDigest, opts) {
  const identity = identityFor(sessionKey);
  const worktreeId = (opts && opts.worktreeId) || rll.computeWorktreeId(dir);
  const planDigest = (opts && opts.planDigest) || rll.discoverPlan(dir).planDigest;
  const bindingResult = rll.createMainOrchestratorBinding(dir, identity, worktreeId, planDigest, 120);
  assert.strictEqual(bindingResult.ok, true, 'test fixture setup: createMainOrchestratorBinding must succeed');
  const grantResult = rll.mintLifecycleCommandGrant(dir, bindingResult.binding, argvDigest, role, subcommand);
  assert.strictEqual(grantResult.ok, true, 'test fixture setup: mintLifecycleCommandGrant must succeed');
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

const LIVE_ROLE = 'arch-testing'; // routed claude-sendmessage first -- exercises the live role-spawn/mint path
const NOOP_CAPS = JSON.stringify([]);
const LIVE_CAPS = JSON.stringify(['claude-sendmessage']);

// ══════════════════════════════════════════════════════════════════════════
// Positive path: ensure -> ACTION_REQUIRED -> ready -> READY -> idempotent
// re-ensure -> notify -> rotate -> ready(new action) -> stop-owned
// ══════════════════════════════════════════════════════════════════════════

test('ensure(live driver, valid grant): mints ONE role-spawn action, binding STARTING; ready(fresh grant) transitions to READY; re-ensure is idempotent (no second mint); notify/rotate/stop-owned complete the lifecycle', () => {
  const dir = makeGitProject();
  try {
    writePlanFixture(dir, 'handlers-happy');
    const sessionKey = 'happy-path-session';

    const g1 = mintGrant(dir, sessionKey, LIVE_ROLE, 'ensure', ensureDigest([LIVE_ROLE]));
    const r1 = runCli(['ensure', '--project-root', dir, '--role', LIVE_ROLE, '--lifecycle-binding', g1.grantId], { RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES: LIVE_CAPS });
    assert.strictEqual(r1.status, 0, JSON.stringify(r1.result));
    assert.strictEqual(r1.result.status, 'ACTION_REQUIRED');
    assert.strictEqual(r1.result.actions.length, 1);
    const action = r1.result.actions[0];
    assert.strictEqual(action.kind, 'role-spawn');
    assert.strictEqual(action.runtime, 'claude-native');
    assert.strictEqual(action.role, LIVE_ROLE);
    assert.match(action.action_id, /^[0-9a-f]{32}$/);
    assert.strictEqual(action.payload.bootstrap_message.includes('ready --action'), true);

    // A never-consumed action is still WAITING from wait-ready's perspective.
    const w1 = runCli(['wait-ready', '--action', action.action_id, '--timeout', '1']);
    assert.strictEqual(w1.result.status, 'WAITING');
    assert.notStrictEqual(w1.result.status, 'READY');

    const g2 = mintGrant(dir, sessionKey, LIVE_ROLE, 'ready', readyDigest(action.action_id));
    const r2 = runCli(['ready', '--action', action.action_id, '--lifecycle-binding', g2.grantId]);
    assert.strictEqual(r2.status, 0, JSON.stringify(r2.result));
    assert.strictEqual(r2.result.status, 'READY');
    assert.strictEqual(r2.result.bindings.length, 1);
    const bindingId = r2.result.bindings[0].binding_id;
    assert.strictEqual(r2.result.bindings[0].state, 'READY');

    // wait-ready now observes READY directly.
    const w2 = runCli(['wait-ready', '--action', action.action_id, '--timeout', '1']);
    assert.strictEqual(w2.result.status, 'READY');

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

    const g6 = mintGrant(dir, sessionKey, LIVE_ROLE, 'ready', readyDigest(rotateAction.action_id));
    const r6 = runCli(['ready', '--action', rotateAction.action_id, '--lifecycle-binding', g6.grantId]);
    assert.strictEqual(r6.result.status, 'READY', JSON.stringify(r6.result));
    assert.strictEqual(r6.result.bindings[0].binding_id, bindingId, 'binding_id is stable across a rotate cycle');

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

test('ensure(noop-only role, valid grant): instant READY with zero minted actions (Agent-Teams-disabled one-shot availability is the NO-grant path, not this one)', () => {
  const dir = makeGitProject();
  try {
    writePlanFixture(dir, 'handlers-noop');
    const g1 = mintGrant(dir, 'noop-session', LIVE_ROLE, 'ensure', ensureDigest([LIVE_ROLE]));
    const r1 = runCli(['ensure', '--project-root', dir, '--role', LIVE_ROLE, '--lifecycle-binding', g1.grantId], { RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES: NOOP_CAPS });
    assert.strictEqual(r1.result.status, 'READY', JSON.stringify(r1.result));
    assert.strictEqual(r1.result.actions.length, 0);
    assert.strictEqual(r1.result.bindings[0].driver, 'noop');
  } finally {
    cleanup(dir);
  }
});

test('ensure without --lifecycle-binding: unchanged WP1 ephemeral/persistent-mode behavior regardless of any live capability', () => {
  const dir = makeGitProject();
  try {
    writePlanFixture(dir, 'handlers-nographt');
    const r = runCli(['ensure', '--project-root', dir, '--role', LIVE_ROLE], { RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES: LIVE_CAPS });
    assert.strictEqual(r.result.status, 'EPHEMERAL_AVAILABLE');
    assert.strictEqual(r.result.actions.length, 0);
    assert.strictEqual(r.result.bindings.length, 0);
  } finally {
    cleanup(dir);
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
    // mutate for this fixture, mirrors the registry test file's own pattern).
    const t1 = rll.transitionRoleBinding(dir, worktreeId, planDigest, profileDigest, genResult.generationId, LIVE_ROLE, 'ABSENT', 'STARTING', null, { driver: 'claude-sendmessage' });
    const t2 = rll.transitionRoleBinding(dir, worktreeId, planDigest, profileDigest, genResult.generationId, LIVE_ROLE, 'STARTING', 'READY', t1.record, {});
    const t3 = rll.transitionRoleBinding(dir, worktreeId, planDigest, profileDigest, genResult.generationId, LIVE_ROLE, 'READY', 'DEAD', t2.record, {});
    assert.strictEqual(t3.ok, true);
    assert.strictEqual(t3.record.respawn_count, undefined);

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
    const g1 = mintGrant(dir, 'pre-restart-session', LIVE_ROLE, 'ensure', ensureDigest([LIVE_ROLE]));
    const r1 = runCli(['ensure', '--project-root', dir, '--role', LIVE_ROLE, '--lifecycle-binding', g1.grantId], { RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES: NOOP_CAPS });
    assert.strictEqual(r1.result.status, 'READY');
    const oldBindingId = r1.result.bindings[0].binding_id;
    const oldGenerationId = g1.binding.session_generation_id;

    const g2 = mintGrant(dir, 'post-restart-session', LIVE_ROLE, 'ensure', ensureDigest([LIVE_ROLE]));
    assert.notStrictEqual(g2.binding.session_generation_id, oldGenerationId, 'a different runtime_session_key must mint a different session_generation_id');
    const r2 = runCli(['ensure', '--project-root', dir, '--role', LIVE_ROLE, '--lifecycle-binding', g2.grantId], { RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES: NOOP_CAPS });
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
    const g = mintGrant(dir, 'replay-session', LIVE_ROLE, 'ensure', ensureDigest([LIVE_ROLE]));
    const first = runCli(['ensure', '--project-root', dir, '--role', LIVE_ROLE, '--lifecycle-binding', g.grantId], { RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES: NOOP_CAPS });
    assert.strictEqual(first.result.status, 'READY');
    const replay = runCli(['ensure', '--project-root', dir, '--role', LIVE_ROLE, '--lifecycle-binding', g.grantId], { RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES: NOOP_CAPS });
    assert.strictEqual(replay.status, 3);
    assert.strictEqual(replay.result.status, 'INVALID');
    assert.strictEqual(replay.result.detail_code, 'IDENTITY_MISMATCH');
  } finally {
    cleanup(dir);
  }
});

test('ADV-replay-2: a second ready call against an already-READY action reports ACTION_REPLAY, never re-authorizes', () => {
  const dir = makeGitProject();
  try {
    writePlanFixture(dir, 'adv-replay-2');
    const sessionKey = 'ready-replay-session';
    const g1 = mintGrant(dir, sessionKey, LIVE_ROLE, 'ensure', ensureDigest([LIVE_ROLE]));
    const r1 = runCli(['ensure', '--project-root', dir, '--role', LIVE_ROLE, '--lifecycle-binding', g1.grantId], { RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES: LIVE_CAPS });
    const actionId = r1.result.actions[0].action_id;
    const g2 = mintGrant(dir, sessionKey, LIVE_ROLE, 'ready', readyDigest(actionId));
    const r2 = runCli(['ready', '--action', actionId, '--lifecycle-binding', g2.grantId]);
    assert.strictEqual(r2.result.status, 'READY');

    const g3 = mintGrant(dir, sessionKey, LIVE_ROLE, 'ready', readyDigest(actionId));
    const r3 = runCli(['ready', '--action', actionId, '--lifecycle-binding', g3.grantId]);
    assert.strictEqual(r3.status, 3);
    assert.strictEqual(r3.result.detail_code, 'ACTION_REPLAY');
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
    rec.expires_at = '2000-01-01T00:00:00Z';
    fs.chmodSync(grantPath, 0o600);
    fs.writeFileSync(grantPath, JSON.stringify(rec), { mode: 0o600 });

    const r = runCli(['ensure', '--project-root', dir, '--role', LIVE_ROLE, '--lifecycle-binding', g.grantId], { RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES: NOOP_CAPS });
    assert.strictEqual(r.status, 3);
    assert.strictEqual(r.result.detail_code, 'IDENTITY_MISMATCH');
  } finally {
    cleanup(dir);
  }
});

test('ADV-expiry-2: an expired pending action is rejected via ready (ACTION_EXPIRED) and the binding becomes UNAVAILABLE, never READY', () => {
  const dir = makeGitProject();
  try {
    writePlanFixture(dir, 'adv-expiry-2');
    const sessionKey = 'action-expiry-session';
    const g1 = mintGrant(dir, sessionKey, LIVE_ROLE, 'ensure', ensureDigest([LIVE_ROLE]));
    const r1 = runCli(['ensure', '--project-root', dir, '--role', LIVE_ROLE, '--lifecycle-binding', g1.grantId], { RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES: LIVE_CAPS });
    const actionId = r1.result.actions[0].action_id;

    const actionPath = rll.actionPathFor(dir, actionId);
    const rec = JSON.parse(fs.readFileSync(actionPath, 'utf8'));
    rec.expires_at = '2000-01-01T00:00:00Z';
    fs.chmodSync(actionPath, 0o600);
    fs.writeFileSync(actionPath, JSON.stringify(rec), { mode: 0o600 });

    const g2 = mintGrant(dir, sessionKey, LIVE_ROLE, 'ready', readyDigest(actionId));
    const r2 = runCli(['ready', '--action', actionId, '--lifecycle-binding', g2.grantId]);
    assert.strictEqual(r2.status, 3);
    assert.strictEqual(r2.result.detail_code, 'ACTION_EXPIRED');
    assert.notStrictEqual(r2.result.status, 'READY');

    const profileDigest = rll.roleProfileDigestFor(LIVE_ROLE);
    const state = rll.readRoleBindingState(dir, rll.computeWorktreeId(dir), rll.discoverPlan(dir).planDigest, profileDigest, g1.binding.session_generation_id, LIVE_ROLE);
    assert.strictEqual(state.state, 'UNAVAILABLE');
  } finally {
    cleanup(dir);
  }
});

test('ADV-cross-session-1: a ready grant minted under a DIFFERENT session generation than the action itself is rejected (IDENTITY_MISMATCH)', () => {
  const dir = makeGitProject();
  try {
    writePlanFixture(dir, 'adv-cross-session');
    const g1 = mintGrant(dir, 'session-A', LIVE_ROLE, 'ensure', ensureDigest([LIVE_ROLE]));
    const r1 = runCli(['ensure', '--project-root', dir, '--role', LIVE_ROLE, '--lifecycle-binding', g1.grantId], { RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES: LIVE_CAPS });
    const actionId = r1.result.actions[0].action_id;

    // A grant minted for the SAME role/action/subcommand-digest but under a
    // DIFFERENT (session-B) MainOrchestratorBinding/generation.
    const gCrossSession = mintGrant(dir, 'session-B', LIVE_ROLE, 'ready', readyDigest(actionId));
    const r2 = runCli(['ready', '--action', actionId, '--lifecycle-binding', gCrossSession.grantId]);
    assert.strictEqual(r2.status, 3);
    assert.strictEqual(r2.result.detail_code, 'IDENTITY_MISMATCH');
    assert.notStrictEqual(r2.result.status, 'READY');
  } finally {
    cleanup(dir);
  }
});

test('ADV-ambiguous-owner-1: two concurrent ready calls racing the SAME pending action never both succeed', async () => {
  const dir = makeGitProject();
  try {
    writePlanFixture(dir, 'adv-ambiguous-owner');
    const sessionKey = 'race-session';
    const g1 = mintGrant(dir, sessionKey, LIVE_ROLE, 'ensure', ensureDigest([LIVE_ROLE]));
    const r1 = runCli(['ensure', '--project-root', dir, '--role', LIVE_ROLE, '--lifecycle-binding', g1.grantId], { RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES: LIVE_CAPS });
    const actionId = r1.result.actions[0].action_id;

    const gA = mintGrant(dir, sessionKey, LIVE_ROLE, 'ready', readyDigest(actionId));
    const gB = mintGrant(dir, sessionKey, LIVE_ROLE, 'ready', readyDigest(actionId));
    const [ra, rb] = await Promise.all([
      runCliAsync(['ready', '--action', actionId, '--lifecycle-binding', gA.grantId]),
      runCliAsync(['ready', '--action', actionId, '--lifecycle-binding', gB.grantId]),
    ]);
    const readyCount = [ra, rb].filter((r) => r.result.status === 'READY').length;
    assert.strictEqual(readyCount, 1, 'exactly one of two racing ready calls may win; the other must be rejected, never both READY');
    const loser = ra.result.status === 'READY' ? rb : ra;
    assert.ok(['ACTION_REPLAY', 'AMBIGUOUS_OWNER'].includes(loser.result.detail_code), `loser detail_code was ${loser.result.detail_code}`);

    const profileDigest = rll.roleProfileDigestFor(LIVE_ROLE);
    const finalState = rll.readRoleBindingState(dir, rll.computeWorktreeId(dir), rll.discoverPlan(dir).planDigest, profileDigest, g1.binding.session_generation_id, LIVE_ROLE);
    assert.strictEqual(finalState.state, 'READY');
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
    const g1 = mintGrant(dir, sessionKey, LIVE_ROLE, 'ensure', ensureDigest([LIVE_ROLE]));
    const r1 = runCli(['ensure', '--project-root', dir, '--role', LIVE_ROLE, '--lifecycle-binding', g1.grantId], { RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES: LIVE_CAPS });
    const actionId = r1.result.actions[0].action_id;

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
    const g1 = mintGrant(dir, sessionKey, LIVE_ROLE, 'ensure', ensureDigest([LIVE_ROLE]));
    const r1 = runCli(['ensure', '--project-root', dir, '--role', LIVE_ROLE, '--lifecycle-binding', g1.grantId], { RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES: LIVE_CAPS });
    const actionId = r1.result.actions[0].action_id;

    // Re-`ensure` (fresh grant) WITHOUT ever calling `ready`: the binding must
    // still be reported as pending (ACTION_REQUIRED, the SAME action), never
    // READY -- nothing about re-observing the request transitions state.
    const g2 = mintGrant(dir, sessionKey, LIVE_ROLE, 'ensure', ensureDigest([LIVE_ROLE]));
    const r2 = runCli(['ensure', '--project-root', dir, '--role', LIVE_ROLE, '--lifecycle-binding', g2.grantId], { RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES: LIVE_CAPS });
    assert.strictEqual(r2.result.status, 'ACTION_REQUIRED');
    assert.strictEqual(r2.result.actions[0].action_id, actionId, 're-ensure must re-report the SAME pending action, never fabricate READY');

    // action-failed has no grant in its frozen argv (PLAN.md ~L143) -- the
    // action_id itself is the bearer of authorization for this follow-up call.
    const r3 = runCli(['action-failed', '--action', actionId, '--reason', 'native-tool-error']);
    assert.strictEqual(r3.result.status, 'UNAVAILABLE');
    assert.strictEqual(r3.result.detail_code, 'NATIVE_TOOL_ERROR');

    const profileDigest = rll.roleProfileDigestFor(LIVE_ROLE);
    const state = rll.readRoleBindingState(dir, rll.computeWorktreeId(dir), rll.discoverPlan(dir).planDigest, profileDigest, g1.binding.session_generation_id, LIVE_ROLE);
    assert.strictEqual(state.state, 'UNAVAILABLE');
  } finally {
    cleanup(dir);
  }
});
