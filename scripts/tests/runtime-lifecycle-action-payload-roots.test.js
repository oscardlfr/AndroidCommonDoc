'use strict';

require('./lib/private-registry-tmpdir-preload.cjs');

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const TEST_CAPABILITY = 'payload-roots-capability';
process.env.NODE_ENV = 'test';
process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY = TEST_CAPABILITY;

const { createLifecycleActionPayloads } = require('../lib/runtime-role-lifecycle/lifecycle-action-payloads.cjs');
const { parsePosixDirect, renderPosixDirect } = require('../lib/runtime-role-lifecycle.cjs');
const rll = require('../lib/runtime-role-lifecycle.cjs');
const consultation = require('../lib/runtime-consultation.cjs');
const RLL_CLI = path.resolve(__dirname, '../lib/runtime-role-lifecycle.cjs');

const ACTION_ID = 'a'.repeat(32);
const ROLE = 'arch-platform';

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rll-action-roots-'));
  const toolkitLib = path.join(root, 'android-common-doc', 'scripts', 'lib');
  const l1Root = path.join(root, 'l1-libraries');
  const l2Root = path.join(root, 'product');
  for (const dir of [toolkitLib, path.join(l1Root, 'scripts', 'lib'), path.join(l2Root, 'scripts', 'lib')]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  for (const consumerRoot of [l1Root, l2Root]) {
    fs.writeFileSync(path.join(consumerRoot, 'scripts', 'lib', 'runtime-role-lifecycle.cjs'), '// consumer decoy\n');
    fs.writeFileSync(path.join(consumerRoot, 'scripts', 'lib', 'runtime-consultation.cjs'), '// consumer decoy\n');
  }
  fs.writeFileSync(path.join(toolkitLib, 'runtime-role-lifecycle.cjs'), '// qualified toolkit runtime\n');
  fs.writeFileSync(path.join(toolkitLib, 'runtime-consultation.cjs'), '// qualified toolkit runtime\n');
  return { root, toolkitLib, l1Root, l2Root };
}

function payloadsFor(toolkitLib) {
  return createLifecycleActionPayloads({
    fs,
    path,
    process,
    facadeDirname: toolkitLib,
    CANONICAL_ROLES: [ROLE],
    canonicalJSONStringify: JSON.stringify,
    isHexActionId: (value) => typeof value === 'string' && /^[0-9a-f]{32}$/.test(value),
    realpathOrSelf: (value) => path.resolve(value),
    renderPosixDirect,
  });
}

function readyArgv(message) {
  const prefix = 'FIRST Bash=';
  const suffix = ';require READY else report/stop;WAIT.';
  const firstLine = message.split('\n')[0];
  assert.ok(firstLine.startsWith(prefix));
  assert.ok(firstLine.endsWith(suffix));
  return parsePosixDirect(firstLine.slice(prefix.length, -suffix.length));
}

function receiverContract(message) {
  const line = message.split('\n').find((candidate) => candidate.startsWith('{"n":'));
  assert.ok(line, 'bootstrap must contain its closed receiver contract');
  return JSON.parse(line);
}

function assertQualifiedToolkitPayload(payloads, toolkitLib, consumerRoot) {
  const message = payloads.claudeReadyBootstrapMessageFor(ACTION_ID, ROLE, consumerRoot);
  const argv = readyArgv(message);
  const contract = receiverContract(message);

  assert.equal(argv[1], path.join(toolkitLib, 'runtime-role-lifecycle.cjs'));
  assert.notEqual(argv[1], path.join(consumerRoot, 'scripts', 'lib', 'runtime-role-lifecycle.cjs'));
  assert.equal(contract.p, consumerRoot);
  assert.ok(message.includes('Only COORDINATION_CONSULT/v1\\nJSON exact{artifact_path,kind,request_id,role,target_role}'));
  assert.ok(message.includes(';kind=consult;target_role=r;'));
  assert.ok(message.includes('C=' + JSON.stringify(path.join(toolkitLib, 'runtime-consultation.cjs'))));
  assert.ok(message.includes('Q=p+"/.planning/coordination"'));
  assert.ok(!message.includes(path.join(consumerRoot, 'scripts', 'lib', 'runtime-consultation.cjs')),
    'consumer-owned decoy executables must never enter the action payload');
}

function makeLinkedConsumer() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rll-linked-consumer-'));
  const source = path.join(root, 'source');
  const consumerRoot = path.join(root, 'consumer-worktree');
  fs.mkdirSync(source, { recursive: true });
  execFileSync('git', ['-C', source, 'init', '-q']);
  execFileSync('git', ['-C', source, 'config', 'user.email', 'payload-roots@test.local']);
  execFileSync('git', ['-C', source, 'config', 'user.name', 'Payload Roots Test']);
  execFileSync('git', ['-C', source, 'commit', '-q', '--allow-empty', '-m', 'init']);
  execFileSync('git', ['-C', source, 'worktree', 'add', '-q', '-b', 'linked-consumer', consumerRoot]);

  const consumerLib = path.join(consumerRoot, 'scripts', 'lib');
  fs.mkdirSync(consumerLib, { recursive: true });
  const policy = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../lib/runtime-collaboration-policy.json'), 'utf8'));
  policy.schema = 'runtime-collaboration-policy/v1';
  policy.version = 1;
  delete policy.selection;
  delete policy.claude_native_startup_timeout_seconds;
  fs.writeFileSync(path.join(consumerLib, 'runtime-collaboration-policy.json'), JSON.stringify(policy, null, 2) + '\n');
  fs.copyFileSync(path.resolve(__dirname, '../lib/runtime-routing.json'), path.join(consumerLib, 'runtime-routing.json'));
  fs.writeFileSync(path.join(consumerLib, 'runtime-role-lifecycle.cjs'), '// consumer decoy\n');
  fs.writeFileSync(path.join(consumerLib, 'runtime-consultation.cjs'), '// consumer decoy\n');
  const waveDir = path.join(consumerRoot, '.planning', 'wave-payload-roots');
  fs.mkdirSync(waveDir, { recursive: true });
  fs.writeFileSync(path.join(waveDir, 'PLAN.md'), '# linked worktree payload roots\n');
  return { root, consumerRoot };
}

function mintEnsureGrant(consumerRoot, role) {
  const identity = { ok: true, provider: 'claude-hook', runtime_session_key: 'payload-roots-session' };
  const worktreeId = rll.computeWorktreeId(consumerRoot);
  const planDigest = rll.discoverPlan(consumerRoot).planDigest;
  const binding = rll.createMainOrchestratorBinding(
    consumerRoot, identity, worktreeId, planDigest, 120,
  );
  assert.equal(binding.ok, true, JSON.stringify(binding));
  const digest = consultation.sha256String('ensure:' + role);
  const grant = rll.mintLifecycleCommandGrant(
    consumerRoot, binding.binding, digest, role, 'ensure',
    'main-orchestrator', 'orchestrator', 'normal', null,
  );
  assert.equal(grant.ok, true, JSON.stringify(grant));
  const generation = rll.resolveSessionGeneration(consumerRoot, identity);
  assert.equal(generation.ok, true, JSON.stringify(generation));
  return {
    binding: binding.binding,
    generationId: generation.generationId,
    grantId: grant.grantId,
  };
}

function runEnsure(consumerRoot, role, grantId) {
  const output = execFileSync(process.execPath, [
    RLL_CLI, 'ensure', '--project-root', consumerRoot, '--role', role,
    '--lifecycle-binding', grantId,
  ], {
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'test',
      RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY: TEST_CAPABILITY,
      RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES: JSON.stringify(['claude-sendmessage']),
    },
  });
  return JSON.parse(output.trim().split('\n').at(-1));
}

function cleanupLinkedFixture(fixture) {
  try { fs.rmSync(rll.registryRepoDir(fixture.consumerRoot), { recursive: true, force: true }); } catch {}
  fs.rmSync(fixture.root, { recursive: true, force: true });
}

test('ensure action payload for an L1 consumer uses qualified L0 executables and consumer coordination state', () => {
  const fixture = makeFixture();
  try {
    assertQualifiedToolkitPayload(payloadsFor(fixture.toolkitLib), fixture.toolkitLib, fixture.l1Root);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('rotate/recovery action payload for an L2 consumer uses qualified L0 executables and rejects consumer decoys', () => {
  const fixture = makeFixture();
  try {
    assertQualifiedToolkitPayload(payloadsFor(fixture.toolkitLib), fixture.toolkitLib, fixture.l2Root);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('real ensure producer in a linked consumer worktree binds executables to L0 and state to consumer', () => {
  const fixture = makeLinkedConsumer();
  try {
    const grant = mintEnsureGrant(fixture.consumerRoot, ROLE);
    const result = runEnsure(fixture.consumerRoot, ROLE, grant.grantId);
    assert.equal(result.status, 'ACTION_REQUIRED', JSON.stringify(result));
    const action = result.actions.find((candidate) => candidate.kind === 'role-spawn');
    assert.ok(action, JSON.stringify(result));
    assertQualifiedToolkitPayload(
      { claudeReadyBootstrapMessageFor: () => action.payload.bootstrap_message },
      path.resolve(__dirname, '../lib'),
      fixture.consumerRoot,
    );
  } finally {
    cleanupLinkedFixture(fixture);
  }
});

test('real rotate/recovery producer in a linked worktree uses the same qualified payload boundary', () => {
  const fixture = makeLinkedConsumer();
  try {
    const role = 'arch-integration';
    const grant = mintEnsureGrant(fixture.consumerRoot, role);
    const ensured = runEnsure(fixture.consumerRoot, role, grant.grantId);
    assert.equal(ensured.status, 'ACTION_REQUIRED', JSON.stringify(ensured));
    const pair = rll.resolvePolicyPair(fixture.consumerRoot);
    assert.equal(pair.ok, true, JSON.stringify(pair));
    const profileDigest = rll.roleProfileDigestFor(role);
    let starting = rll.readRoleBindingState(
      fixture.consumerRoot,
      grant.binding.worktree_id,
      grant.binding.plan_digest,
      profileDigest,
      grant.generationId,
      role,
    );
    if (starting.state === 'ABSENT') {
      const seed = rll.transitionRoleBinding(
        fixture.consumerRoot,
        grant.binding.worktree_id,
        grant.binding.plan_digest,
        profileDigest,
        grant.generationId,
        role,
        'ABSENT',
        'STARTING',
        null,
        {
          driver: 'claude-sendmessage',
          respawn_count: 0,
          pending_action_id: ensured.actions[0].action_id,
        },
      );
      assert.equal(seed.ok, true, JSON.stringify(seed));
      starting = seed;
      starting.state = 'STARTING';
    }
    assert.equal(starting.state, 'STARTING', JSON.stringify(starting));
    const ready = rll.transitionRoleBinding(
      fixture.consumerRoot,
      grant.binding.worktree_id,
      grant.binding.plan_digest,
      profileDigest,
      grant.generationId,
      role,
      'STARTING',
      'READY',
      starting.record,
      {},
    );
    assert.equal(ready.ok, true, JSON.stringify(ready));
    const rotating = rll.transitionRoleBinding(
      fixture.consumerRoot,
      grant.binding.worktree_id,
      grant.binding.plan_digest,
      profileDigest,
      grant.generationId,
      role,
      'READY',
      'ROTATING',
      ready.record,
      {},
    );
    assert.equal(rotating.ok, true, JSON.stringify(rotating));
    const result = rll.spawnOrRehydrateSingleRole(
      fixture.consumerRoot,
      pair,
      { availableDrivers: ['claude-sendmessage'] },
      role,
      profileDigest,
      grant.binding.worktree_id,
      grant.binding.plan_digest,
      grant.generationId,
      'ROTATING',
      'REHYDRATING',
      rotating.record,
      0,
      grant.binding.expiry,
    );
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.terminal, false);
    assertQualifiedToolkitPayload(
      { claudeReadyBootstrapMessageFor: () => result.action.payload.bootstrap_message },
      path.resolve(__dirname, '../lib'),
      fixture.consumerRoot,
    );
  } finally {
    cleanupLinkedFixture(fixture);
  }
});
