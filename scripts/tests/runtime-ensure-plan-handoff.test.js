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


const SESSION = 'handoff-session';
const planPath = (root) => path.join(root, '.planning', 'wave-ensure-rotation', 'PLAN.md');
const SHUTDOWN = { type: 'shutdown_request', reason: 'plan-handoff' };

/** Five READY peers under plan A; then the PLAN changes (the draft becomes the final) and `ensure` runs for plan B. */
function handoffProject() {
  const root = makeProject();
  const seeded = seedFiveReadyActors(root, SESSION);
  fs.writeFileSync(planPath(root), '# the final plan, a different digest\n');
  return { root, seeded };
}

function retire(root, seeded, role) {
  const actor = seeded.actors.get(role);
  const identity = rll.computeClaudeAuthorityIdentityId(root, 'claude-hook', SESSION, actor.agentId);
  assert.strictEqual(rll.publishClaudeAuthorityFence(root, identity).ok, true);
  const terminal = rll.publishClaudeSupportRoleTerminal(root, { sessionId: SESSION, agentId: actor.agentId, agentType: role });
  assert.strictEqual(terminal.ok, true, JSON.stringify(terminal));
}

test('a new plan digest with live old-plan peers: ensure stops them first and spawns nothing', () => {
  const { root } = handoffProject();
  try {
    const first = runEnsure(root, SESSION);
    assert.strictEqual(first.exitCode, 0, JSON.stringify(first));
    assert.strictEqual(first.envelope.status, 'ACTION_REQUIRED', JSON.stringify(first.envelope));
    assert.strictEqual(first.envelope.actions.length, ROLES.length);
    for (const action of first.envelope.actions) {
      assert.strictEqual(action.kind, 'role-stop-owned', `${action.role}: ${action.kind}`);
      assert.strictEqual(action.operation, 'SendMessage');
      assert.deepStrictEqual(action.payload.message, SHUTDOWN, 'the canonical shutdown_request, nothing else');
      assert.strictEqual(action.payload.teammate_name, action.role);
    }
    // A stop that is still pending is re-reported, never duplicated.
    const again = runEnsure(root, SESSION);
    assert.deepStrictEqual(again.envelope.actions.map((a) => a.action_id).sort(), first.envelope.actions.map((a) => a.action_id).sort());
  } finally { cleanup(root); }
});

test('once every old-plan peer has its terminal, ensure spawns the roles under the new digest with the same names', () => {
  const { root, seeded } = handoffProject();
  try {
    assert.strictEqual(runEnsure(root, SESSION).envelope.actions[0].kind, 'role-stop-owned');
    for (const role of ROLES) retire(root, seeded, role);
    const next = runEnsure(root, SESSION);
    assert.strictEqual(next.exitCode, 0, JSON.stringify(next));
    assert.strictEqual(next.envelope.status, 'ACTION_REQUIRED', JSON.stringify(next.envelope));
    assert.deepStrictEqual(next.envelope.actions.map((a) => a.kind), Array(ROLES.length).fill('role-spawn'));
    assert.deepStrictEqual(next.envelope.actions.map((a) => a.payload.teammate_name).sort(), ROLES.slice().sort(), 'same names, so the host has no collision');
    assert.ok(next.envelope.actions.every((a) => a.plan_digest === rll.discoverPlan(root).planDigest), 'bound to the new digest');
  } finally { cleanup(root); }
});

test('one old-plan peer without a terminal keeps every spawn back; after the attempt limit the role is reported', () => {
  const { root, seeded } = handoffProject();
  try {
    assert.strictEqual(runEnsure(root, SESSION).envelope.status, 'ACTION_REQUIRED');
    for (const role of ROLES.filter((r) => r !== 'doc-updater')) retire(root, seeded, role);
    // Four roles are gone; doc-updater never answers. Its stop is re-issued after each expiry, then given up on.
    for (let attempt = 2; attempt <= 3; attempt += 1) {
      clock.offsetMs += 5 * 60 * 1000;
      const retry = runEnsure(root, SESSION);
      assert.deepStrictEqual(retry.envelope.actions.map((a) => a.role), ['doc-updater'], `attempt ${attempt} stops only the silent peer`);
      assert.ok(retry.envelope.actions.every((a) => a.kind === 'role-stop-owned'), 'and spawns nobody');
    }
    clock.offsetMs += 5 * 60 * 1000;
    const exhausted = runEnsure(root, SESSION);
    assert.strictEqual(exhausted.envelope.status, 'UNAVAILABLE', JSON.stringify(exhausted.envelope));
    assert.match(exhausted.stderr, /doc-updater:draft-peer-not-terminal/);
    assert.deepStrictEqual(exhausted.envelope.actions, []);
  } finally { clock.offsetMs = 0; cleanup(root); }
});

test('no old-plan peer alive: ensure behaves as before and spawns the five roles', () => {
  const root = makeProject();
  try {
    const first = runEnsure(root, SESSION);
    assert.deepStrictEqual(first.envelope.actions.map((a) => a.kind), Array(ROLES.length).fill('role-spawn'));
  } finally { cleanup(root); }
});
