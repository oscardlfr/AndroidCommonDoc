'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

process.env.NODE_ENV = 'test';
process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY = 'claude-bootstrap-envelope-v1';
process.env.RUNTIME_COLLABORATION_ENTRYPOINTS_TEST_CAPABILITY = 'p3-entrypoints-v1';

const lifecycle = require('../lib/runtime-role-lifecycle.cjs');
const {
  claudeReadyBootstrapMessageFor,
  __TEST_ONLY__claudeReadyBootstrapMessageForPaths: claudeReadyBootstrapMessageForPathsForTest,
  coordinationRootPathFor,
  renderPosixDirect,
  parsePosixDirect,
} = lifecycle;
const {
  __TEST_ONLY__makeEnvelope: makeEnvelope,
  __TEST_ONLY__nativeToolResultEnvelopeBudgetBytes: NATIVE_TOOL_RESULT_ENVELOPE_BUDGET_BYTES,
} = require('../lib/runtime-collaboration-entrypoints.cjs');

const VALID_ACTION_ID = 'a'.repeat(32);
const VALID_ROLE = 'arch-platform';
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const SUPPORT_ROLES = [
  'arch-platform',
  'arch-testing',
  'arch-integration',
  'context-provider',
  'doc-updater',
];
const FIXED_SELECTION = Object.freeze({
  actual_host: 'claude',
  actual_model: 'claude-sonnet-5',
  actual_role_engine: 'claude',
  continuity: 'session-persistent',
  fallback_reason: null,
  fallback_used: false,
  requested_host: 'claude',
  requested_model_profile: '.claude/model-profiles.json#current',
  requested_role_engine: 'claude',
});

function messageForReceiver() {
  return claudeReadyBootstrapMessageFor(VALID_ACTION_ID, VALID_ROLE, PROJECT_ROOT);
}

function readyCommandFrom(message) {
  const prefix = 'FIRST Bash=';
  const suffix = ';require READY else report/stop;WAIT.';
  const firstLine = message.split('\n')[0];
  assert.ok(firstLine.startsWith(prefix));
  assert.ok(firstLine.endsWith(suffix));
  return firstLine.slice(prefix.length, -suffix.length);
}

function receiverContractFrom(message) {
  const lines = message.split('\n');
  const contractLine = lines.find((line) => line.startsWith('{"n":'));
  assert.ok(contractLine);
  return JSON.parse(contractLine);
}

test('valid scope returns the exact ready command followed by a closed persistent receiver contract', () => {
  const message = messageForReceiver();
  assert.ok(message.startsWith('FIRST Bash='));
  assert.match(message, /;require READY else report\/stop;WAIT\./);
  assert.match(message, /COORDINATION_CONSULT\/v1\\n/);
  assert.match(message, /JSON exact\{artifact_path,kind,request_id,role,target_role\}/);
  assert.match(message, /target_role=r/);
  assert.match(message, /Bash=single-quote;no-chain/);
  assert.match(message, /Pre-read:/);
  assert.match(message, /need SUCCESS;Z=\["--claim",artifact_ref\]/);
  assert.match(message, /lease-heartbeat/);
  assert.match(message, /publish-result/);
  assert.match(message, /invalid:stop/);
});

test('the embedded command parses with the real parsePosixDirect', () => {
  const message = messageForReceiver();
  const command = readyCommandFrom(message);
  const argv = parsePosixDirect(command);
  assert.ok(Array.isArray(argv));
});

test('parsed argv length is exactly five', () => {
  const message = messageForReceiver();
  const command = readyCommandFrom(message);
  const argv = parsePosixDirect(command);
  assert.equal(argv.length, 5);
});

test('argv[0] is fs.realpathSync(process.execPath)', () => {
  const message = messageForReceiver();
  const command = readyCommandFrom(message);
  const argv = parsePosixDirect(command);
  assert.equal(argv[0], fs.realpathSync(process.execPath));
});

test('argv[1] is path.resolve(__dirname, ../lib/runtime-role-lifecycle.cjs)', () => {
  const message = messageForReceiver();
  const command = readyCommandFrom(message);
  const argv = parsePosixDirect(command);
  assert.equal(argv[1], path.resolve(__dirname, '../lib/runtime-role-lifecycle.cjs'));
});

test('argv[2..4] are exactly ready --action <actionId>', () => {
  const message = messageForReceiver();
  const command = readyCommandFrom(message);
  const argv = parsePosixDirect(command);
  assert.deepEqual(argv.slice(2), ['ready', '--action', VALID_ACTION_ID]);
});

test('renderPosixDirect reproduces the embedded command byte-for-byte, no bare ready', () => {
  const message = messageForReceiver();
  const command = readyCommandFrom(message);
  const argv = parsePosixDirect(command);
  assert.equal(renderPosixDirect(argv), command);
  assert.ok(!message.includes('Execute `ready --action'));
  assert.equal(command, renderPosixDirect([
    fs.realpathSync(process.execPath),
    path.resolve(__dirname, '../lib/runtime-role-lifecycle.cjs'),
    'ready',
    '--action',
    VALID_ACTION_ID,
  ]));
});

test('receiver command templates pin canonical executable, script, coordination root and role', () => {
  const message = messageForReceiver();
  const script = path.resolve(__dirname, '../lib/runtime-consultation.cjs');
  const coordinationRoot = coordinationRootPathFor(PROJECT_ROOT);
  const contract = receiverContractFrom(message);
  assert.deepEqual(Object.keys(contract).sort(), ['n', 'p', 'r']);
  assert.equal(contract.n, 'node');
  assert.equal(contract.p, PROJECT_ROOT);
  assert.equal(contract.r, VALID_ROLE);
  const expectedCommands = {
    claim: renderPosixDirect([
      contract.n, script, 'claim', '--coordination-root', coordinationRoot,
      '--request', '{{ARTIFACT_PATH}}', '--role', VALID_ROLE,
    ]),
    'lease-heartbeat': renderPosixDirect([
      contract.n, script, 'lease-heartbeat', '--coordination-root', coordinationRoot,
      '--request', '{{ARTIFACT_PATH}}', '--claim', '{{CLAIM}}',
    ]),
    'publish-result': renderPosixDirect([
      contract.n, script, 'publish-result', '--coordination-root', coordinationRoot,
      '--request', '{{ARTIFACT_PATH}}', '--claim', '{{CLAIM}}', '--content', '{{CONTENT_BASE64URL}}',
    ]),
  };
  assert.ok(message.includes('Q=p+"/.planning/coordination";X=[n,C];Y=["--coordination-root",Q,"--request",artifact_path]'));
  assert.ok(message.includes('X+["claim"]+Y+["--role",r]'));
  assert.ok(message.includes('Z=["--claim",artifact_ref]'));
  assert.ok(message.includes('X+["lease-heartbeat"]+Y+Z'));
  assert.ok(message.includes('X+["publish-result"]+Y+Z+["--content",B]'));
  assert.equal(expectedCommands.claim, renderPosixDirect([
    contract.n, path.join(contract.p, 'scripts', 'lib', 'runtime-consultation.cjs'),
    'claim', '--coordination-root', path.join(contract.p, '.planning', 'coordination'),
    '--request', '{{ARTIFACT_PATH}}', '--role', contract.r,
  ]));
});

// The five-action envelope necessarily repeats the absolute, realpath-verified
// node and toolkit executables for each independent role action. The receiver
// contract therefore keeps the operated project root exactly once and reuses
// closed argv suffixes (Y and Z), rather than repeating long absolute values or
// one-use aliases. Measure a declared root bound instead of the ambient checkout
// so a deep worktree cannot make this test nondeterministic.
const MAX_SUPPORTED_PROJECT_ROOT_CHARS = 100;
const HERMETIC_NODE_PATH_CHARS = 45;
const HERMETIC_TOOLKIT_ROOT_CHARS = 88;

function absolutePathOfLength(length, fill) {
  const root = path.parse(path.resolve(path.sep)).root;
  assert.ok(length > root.length);
  const value = path.join(root, fill.repeat(length - root.length));
  assert.equal(value.length, length);
  assert.ok(path.isAbsolute(value));
  return value;
}

const HERMETIC_NODE_PATH = absolutePathOfLength(HERMETIC_NODE_PATH_CHARS, 'n');
const HERMETIC_TOOLKIT_ROOT = absolutePathOfLength(HERMETIC_TOOLKIT_ROOT_CHARS, 't');

function fiveRoleActionsForPaths(rootLength, nodePath = HERMETIC_NODE_PATH, toolkitRoot = HERMETIC_TOOLKIT_ROOT) {
  const projectRoot = absolutePathOfLength(rootLength, 'p');
  return SUPPORT_ROLES.map((role, index) => ({
    schema: 'coordination/role-lifecycle-action/v1',
    action_id: String(index + 1).repeat(32),
    kind: 'role-spawn',
    runtime: 'claude-native',
    repo_id: 'a'.repeat(64),
    worktree_id: 'b'.repeat(64),
    plan_digest: 'c'.repeat(64),
    policy_digest: 'd'.repeat(64),
    session_generation_id: 'e'.repeat(32),
    role,
    expires_at: '2026-09-08T15:57:58Z',
    payload: {
      team_name: 'wp3-support-plane',
      teammate_name: role,
      agent_type: role,
      bootstrap_artifact_ref: null,
      bootstrap_message: claudeReadyBootstrapMessageForPathsForTest(
        String(index + 1).repeat(32), role, projectRoot,
        nodePath, toolkitRoot,
      ),
    },
    operation: 'Agent',
  }));
}

function fiveRoleEnvelopeBytesForRootLength(rootLength) {
  const envelope = makeEnvelope(
    'init-session', 'ACTION_REQUIRED', 'support-plane-action-required', FIXED_SELECTION,
    fiveRoleActionsForPaths(rootLength),
  );
  return envelope.status === 'ACTION_REQUIRED'
    ? Buffer.byteLength(JSON.stringify(envelope), 'utf8')
    : Number.POSITIVE_INFINITY;
}

test('five receiver actions fit the pinned native tool-result transport budget', () => {
  const envelopeBytes = fiveRoleEnvelopeBytesForRootLength(MAX_SUPPORTED_PROJECT_ROOT_CHARS);
  assert.ok(envelopeBytes <= NATIVE_TOOL_RESULT_ENVELOPE_BUDGET_BYTES,
    `the complete five-role ACTION_REQUIRED must stay below the pinned host truncation boundary `
    + `for a project root of the declared maximum ${MAX_SUPPORTED_PROJECT_ROOT_CHARS} characters; saw ${envelopeBytes}`);
});

test('the compact receiver contract carries an external project root exactly once', () => {
  const projectRoot = absolutePathOfLength(MAX_SUPPORTED_PROJECT_ROOT_CHARS, 'p');
  const message = claudeReadyBootstrapMessageForPathsForTest(
    VALID_ACTION_ID, VALID_ROLE, projectRoot, HERMETIC_NODE_PATH, HERMETIC_TOOLKIT_ROOT,
  );
  assert.equal(message.split(projectRoot).length - 1, 1);
  assert.ok(!message.includes('A=artifact_path'));
  assert.ok(message.includes('Q=p+'));
  assert.equal(receiverContractFrom(message).n, 'node');
});

test('the envelope supports the declared maximum project-root length hermetically', () => {
  // The fixed node/toolkit paths make this a protocol property, not a property
  // of whichever checkout happens to execute the test.
  let supported = 0;
  for (let length = 8; length <= 400; length += 1) {
    if (fiveRoleEnvelopeBytesForRootLength(length) <= NATIVE_TOOL_RESULT_ENVELOPE_BUDGET_BYTES) supported = length;
    else break;
  }
  assert.ok(supported >= MAX_SUPPORTED_PROJECT_ROOT_CHARS,
    `the envelope must support project roots of at least ${MAX_SUPPORTED_PROJECT_ROOT_CHARS} characters; `
    + `the largest that fits on this host is ${supported}`);
  // A shorter root must obviously still fit -- guards against an inverted or
  // length-insensitive measurement passing the bound check for the wrong reason.
  assert.ok(fiveRoleEnvelopeBytesForRootLength(20) < fiveRoleEnvelopeBytesForRootLength(100),
    'the envelope must grow with the project-root length, or this budget measures nothing');
});

test('an oversized real-path combination returns an actionable small failure from the real envelope boundary', () => {
  const deepToolkitRoot = absolutePathOfLength(HERMETIC_TOOLKIT_ROOT_CHARS + 80, 't');
  const envelope = makeEnvelope(
    'init-session', 'ACTION_REQUIRED', 'support-plane-action-required', FIXED_SELECTION,
    fiveRoleActionsForPaths(MAX_SUPPORTED_PROJECT_ROOT_CHARS, HERMETIC_NODE_PATH, deepToolkitRoot),
  );
  assert.equal(envelope.status, 'FAILED');
  assert.deepEqual(envelope.actions, []);
  assert.match(envelope.detail, /^support-plane-envelope-too-large:bytes=\d+:max=9300:actions=5:/);
  assert.ok(envelope.detail.endsWith('shorten-project-or-toolkit-paths'));
  assert.ok(Buffer.byteLength(JSON.stringify(envelope), 'utf8') < NATIVE_TOOL_RESULT_ENVELOPE_BUDGET_BYTES);
});

test('the size guard is limited to init-session support-plane ACTION_REQUIRED', () => {
  const deepToolkitRoot = absolutePathOfLength(HERMETIC_TOOLKIT_ROOT_CHARS + 80, 't');
  const actions = fiveRoleActionsForPaths(
    MAX_SUPPORTED_PROJECT_ROOT_CHARS, HERMETIC_NODE_PATH, deepToolkitRoot,
  );
  for (const [entrypoint, status, detail] of [
    ['resume-work', 'ACTION_REQUIRED', 'support-plane-action-required'],
    ['init-session', 'READY', 'support-plane-action-required'],
    ['init-session', 'ACTION_REQUIRED', 'recovery-action-required'],
  ]) {
    const envelope = makeEnvelope(entrypoint, status, detail, FIXED_SELECTION, actions);
    assert.equal(envelope.status, status);
    assert.equal(envelope.actions.length, actions.length);
    assert.ok(Buffer.byteLength(JSON.stringify(envelope), 'utf8') > NATIVE_TOOL_RESULT_ENVELOPE_BUDGET_BYTES);
  }
});

test('the fixed-path constructor is non-enumerable and absent without its test capability', () => {
  assert.equal(Object.prototype.propertyIsEnumerable.call(
    lifecycle, '__TEST_ONLY__claudeReadyBootstrapMessageForPaths',
  ), false);
  const modulePath = require.resolve('../lib/runtime-role-lifecycle.cjs');
  const env = { ...process.env };
  delete env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY;
  const probe = spawnSync(process.execPath, ['-e',
    `const m=require(${JSON.stringify(modulePath)});process.stdout.write(String('__TEST_ONLY__claudeReadyBootstrapMessageForPaths' in m));`,
  ], { encoding: 'utf8', env });
  assert.equal(probe.status, 0, probe.stderr);
  assert.equal(probe.stdout, 'false');
});

test('invalid action ids throw TypeError with message invalid-action-id', () => {
  const invalidIds = [null, '', 'abc', 'g'.repeat(32), 'a'.repeat(31), 'A'.repeat(32)];
  for (const id of invalidIds) {
    assert.throws(
      () => claudeReadyBootstrapMessageFor(id, VALID_ROLE, PROJECT_ROOT),
      (err) => err instanceof TypeError && err.message === 'invalid-action-id'
    );
  }
});

test('invalid receiver role or project root fails closed', () => {
  assert.throws(
    () => claudeReadyBootstrapMessageFor(VALID_ACTION_ID, 'not-a-role', PROJECT_ROOT),
    (err) => err instanceof TypeError && err.message === 'invalid-role'
  );
  assert.throws(
    () => claudeReadyBootstrapMessageFor(VALID_ACTION_ID, VALID_ROLE, 'relative-root'),
    (err) => err instanceof TypeError && err.message === 'invalid-project-root'
  );
  assert.throws(
    () => claudeReadyBootstrapMessageForPathsForTest(
      VALID_ACTION_ID, VALID_ROLE, PROJECT_ROOT, 'relative-node', HERMETIC_TOOLKIT_ROOT,
    ),
    (err) => err instanceof TypeError && err.message === 'invalid-node-path'
  );
  assert.throws(
    () => claudeReadyBootstrapMessageForPathsForTest(
      VALID_ACTION_ID, VALID_ROLE, PROJECT_ROOT, HERMETIC_NODE_PATH, 'relative-toolkit',
    ),
    (err) => err instanceof TypeError && err.message === 'invalid-toolkit-root'
  );
});
