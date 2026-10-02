'use strict';

require('./lib/private-registry-tmpdir-preload.cjs');

// The same injectable clock the full-wave acceptance test uses: this process and its children age together.
const RealDate = Date;
const clock = { offsetMs: 0 };
class OffsetDate extends RealDate {
  constructor(...args) { if (args.length === 0) super(RealDate.now() + clock.offsetMs); else super(...args); }
  static now() { return RealDate.now() + clock.offsetMs; }
}
global.Date = OffsetDate;
const CLOCK_PRELOAD = require('node:path').resolve(__dirname, 'fixtures', 'clock-offset-preload.cjs');

const assert = require('node:assert');
const { execFileSync, spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const TEST_CAPABILITY = 'ensure-generation-rotation-black-box';
const FAKE_CAPABILITIES = JSON.stringify(['claude-sendmessage']);
process.env.NODE_ENV = 'test';
process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY = TEST_CAPABILITY;

const RLL_IMPL = path.resolve(__dirname, '../lib/runtime-role-lifecycle.cjs');
const rll = require(RLL_IMPL);
const rc = require('../lib/runtime-consultation.cjs');

const ROLES = [
  'arch-integration', 'arch-platform', 'arch-testing', 'context-provider', 'doc-updater',
];

function sha(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function makeProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-ensure-rotation-'));
  execFileSync('git', ['-C', root, 'init', '-q']);
  execFileSync('git', ['-C', root, 'config', 'user.email', 'active-probe@test.local']);
  execFileSync('git', ['-C', root, 'config', 'user.name', 'Active Probe Test']);
  execFileSync('git', ['-C', root, 'commit', '-q', '--allow-empty', '-m', 'init']);

  const libDir = path.join(root, 'scripts', 'lib');
  fs.mkdirSync(libDir, { recursive: true });
  const policy = JSON.parse(fs.readFileSync(
    path.resolve(__dirname, '../lib/runtime-collaboration-policy.json'), 'utf8',
  ));
  policy.schema = 'runtime-collaboration-policy/v1';
  policy.version = 1;
  delete policy.selection;
  delete policy.claude_native_startup_timeout_seconds;
  fs.writeFileSync(
    path.join(libDir, 'runtime-collaboration-policy.json'),
    JSON.stringify(policy, null, 2) + '\n',
  );
  fs.copyFileSync(
    path.resolve(__dirname, '../lib/runtime-routing.json'),
    path.join(libDir, 'runtime-routing.json'),
  );
  const waveDir = path.join(root, '.planning', 'wave-ensure-rotation');
  fs.mkdirSync(waveDir, { recursive: true });
  fs.writeFileSync(path.join(waveDir, 'PLAN.md'), '# active liveness probe fixture\n');
  return root;
}

function cleanup(root) {
  fs.rmSync(rll.registryRepoDir(root), { recursive: true, force: true });
  fs.rmSync(root, { recursive: true, force: true });
}

function identityFor(sessionId) {
  return { ok: true, provider: 'claude-hook', runtime_session_key: sessionId };
}

function childEnv() {
  const shifted = clock.offsetMs === 0 ? {} : {
    ACD_TEST_CLOCK_OFFSET_MS: String(clock.offsetMs),
    NODE_OPTIONS: [process.env.NODE_OPTIONS, '--require', CLOCK_PRELOAD].filter(Boolean).join(' '),
  };
  return Object.assign({}, process.env, shifted, {
    NODE_ENV: 'test',
    RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY: TEST_CAPABILITY,
    RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES: FAKE_CAPABILITIES,
  });
}

function runEnsure(root, sessionId) {
  const invocation = mintEnsureInvocation(root, sessionId);
  const child = spawnSync(process.execPath, invocation.args, {
    encoding: 'utf8', env: childEnv(),
  });
  return parseEnsureResult(child.status, child.stdout, child.stderr);
}

function mintEnsureInvocation(root, sessionId) {
  const plan = rll.discoverPlan(root);
  assert.strictEqual(plan.ok, true, JSON.stringify(plan));
  const main = rll.createMainOrchestratorBinding(
    root, identityFor(sessionId), rll.computeWorktreeId(root), plan.planDigest, 120,
  );
  assert.strictEqual(main.ok, true, JSON.stringify(main));
  const argvDigest = rc.sha256String('ensure:' + ROLES.slice().sort().join(','));
  const grant = rll.mintLifecycleCommandGrant(
    root, main.binding, argvDigest, ROLES, 'ensure',
    'main-orchestrator', 'orchestrator', 'normal', null,
  );
  assert.strictEqual(grant.ok, true, JSON.stringify(grant));
  const args = [RLL_IMPL, 'ensure', '--project-root', root];
  for (const role of ROLES) args.push('--role', role);
  args.push('--lifecycle-binding', grant.grantId);
  return { args };
}

function parseEnsureResult(exitCode, stdout, stderr) {
  const lines = String(stdout || '').trim().split('\n');
  const envelope = JSON.parse(lines[lines.length - 1]);
  return { exitCode, envelope, stderr: stderr || '' };
}

function writeStartupObservation(root, sessionId, action, actorBinding, agentId) {
  rll.recordClaudeId01SubagentStartObservation(root, {
    sessionId, agentId, agentType: action.role, actionId: action.action_id,
  });
  const now = new Date();
  const startup = {
    schema: 'runtime/claude-startup-actor/v1',
    session_digest: sha(sessionId),
    agent_digest: sha(agentId),
    role: action.role,
    action_id: action.action_id,
    action_digest: sha(rc.canonicalJSONStringify(action)),
    claim_digest: '4'.repeat(64),
    actor_binding_id: actorBinding.binding.binding_id,
    worktree_id: action.worktree_id,
    plan_digest: action.plan_digest,
    session_generation_digest: sha(action.session_generation_id),
    host_contract_digest: '5'.repeat(64),
    created_at: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    expiry: new Date(now.getTime() + 300000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
  };
  const startupKey = sha(
    'claude-startup-v2:' + action.session_generation_id + ':' + sha(agentId),
  );
  const startupPath = path.join(
    rll.registryRepoDir(root), 'claude-id01-traces', 'startup-v2-' + startupKey + '.json',
  );
  assert.strictEqual(rll.writeRegistryRecordReplace(
    startupPath, Buffer.from(rc.canonicalJSONStringify(startup), 'utf8'),
  ).ok, true);
}

function seedFiveReadyActors(root, sessionId) {
  const initial = runEnsure(root, sessionId);
  assert.strictEqual(initial.exitCode, 0, JSON.stringify(initial));
  assert.strictEqual(initial.envelope.status, 'ACTION_REQUIRED', JSON.stringify(initial.envelope));
  assert.strictEqual(initial.envelope.actions.length, ROLES.length, JSON.stringify(initial.envelope.actions));
  assert.ok(initial.envelope.actions.every((action) =>
    action.kind === 'role-spawn' && action.operation === 'Agent'));

  const actors = new Map();
  for (const action of initial.envelope.actions) {
    const actorBinding = rll.createRoleActorBinding(
      root, action.role, action.worktree_id, action.plan_digest,
      action.session_generation_id, 600,
    );
    assert.strictEqual(actorBinding.ok, true, JSON.stringify(actorBinding));
    const profileDigest = rll.roleProfileDigestFor(action.role);
    const before = rll.readRoleBindingState(
      root, action.worktree_id, action.plan_digest, profileDigest,
      action.session_generation_id, action.role,
    );
    const ready = rll.transitionRoleBinding(
      root, action.worktree_id, action.plan_digest, profileDigest,
      action.session_generation_id, action.role, before.state, 'READY', before.record, {},
    );
    assert.strictEqual(ready.ok, true, JSON.stringify(ready));
    const agentId = 'active-probe-' + action.role + '-' + action.session_generation_id;
    writeStartupObservation(root, sessionId, action, actorBinding, agentId);
    actors.set(action.role, {
      action, actorBinding, agentId, agentDigest: sha(agentId),
    });
  }
  return {
    actors,
    generationId: initial.envelope.actions[0].session_generation_id,
  };
}


const SESSION = 'rotation-session';

test('ensure after the session generation rotates asks for fresh role-spawn actions, never a stale READY', () => {
  const root = makeProject();
  try {
    const seeded = seedFiveReadyActors(root, SESSION);
    // Inside the generation, the live roles are probed, not respawned.
    const within = runEnsure(root, SESSION);
    assert.strictEqual(within.envelope.status, 'ACTION_REQUIRED', JSON.stringify(within.envelope));
    assert.ok(within.envelope.actions.every((action) => action.kind === 'role-notify'), 'live roles are probed inside the generation');

    // An hour and five minutes later the generation (3600 s) has rotated. Whatever the roles' old READY records say, the
    // orchestrator must be told to start them again, bound to the NEW generation.
    clock.offsetMs = 65 * 60 * 1000;
    const after = runEnsure(root, SESSION);
    assert.strictEqual(after.exitCode, 0, JSON.stringify(after));
    assert.notStrictEqual(after.envelope.status, 'READY', JSON.stringify(after.envelope));
    assert.strictEqual(after.envelope.status, 'ACTION_REQUIRED', JSON.stringify(after.envelope));
    assert.strictEqual(after.envelope.actions.length, ROLES.length, JSON.stringify(after.envelope.actions));
    for (const action of after.envelope.actions) {
      assert.strictEqual(action.kind, 'role-spawn', `${action.role} must be respawned, got ${action.kind}`);
      assert.notStrictEqual(action.session_generation_id, seeded.generationId, 'the new actions belong to the rotated generation');
    }
  } finally { clock.offsetMs = 0; cleanup(root); }
});
