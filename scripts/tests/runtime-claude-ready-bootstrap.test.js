'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  claudeReadyBootstrapMessageFor,
  coordinationRootPathFor,
  renderPosixDirect,
  parsePosixDirect,
} = require('../lib/runtime-role-lifecycle.cjs');

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
  assert.match(message, /artifact_path,kind,request_id,role,target_role/);
  assert.match(message, /target_role=r/);
  assert.match(message, /Bash=single-quote tokens;no chain/);
  assert.match(message, /Before reads:/);
  assert.match(message, /need SUCCESS;K=artifact_ref/);
  assert.match(message, /lease-heartbeat/);
  assert.match(message, /publish-result/);
  assert.match(message, /Invalid=>no tool/);
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
  assert.ok(message.includes('X=[n,C];Y=["--coordination-root",Q,"--request",A]'));
  assert.ok(message.includes('X+["claim"]+Y+["--role",r]'));
  assert.ok(message.includes('X+["lease-heartbeat"]+Y+["--claim",K]'));
  assert.ok(message.includes('X+["publish-result"]+Y+["--claim",K,"--content",B]'));
  assert.equal(expectedCommands.claim, renderPosixDirect([
    contract.n, path.join(contract.p, 'scripts', 'lib', 'runtime-consultation.cjs'),
    'claim', '--coordination-root', path.join(contract.p, '.planning', 'coordination'),
    '--request', '{{ARTIFACT_PATH}}', '--role', contract.r,
  ]));
});

// The five-action envelope embeds the project root TWICE per action (once in the
// ready command, once in the receiver contract) and the node path once per
// action -- so every project-root character costs 10 envelope bytes and every
// node-path character costs 5. Measuring the AMBIENT checkout therefore makes
// this assertion a property of wherever the repository happens to live: it
// passes on a short CI checkout and fails on a deep worktree, while proving
// nothing stable about the envelope itself. Declare the bound instead, measure
// against it, and separately assert the bound is genuinely met -- so a
// regression that fattens the envelope is still caught, deterministically, on
// every platform.
const MAX_SUPPORTED_PROJECT_ROOT_CHARS = 100;
const NATIVE_TOOL_RESULT_ENVELOPE_BUDGET_BYTES = 9300;

function fiveRoleEnvelopeBytesForRootLength(rootLength) {
  const projectRoot = path.sep + 'p'.repeat(rootLength - 1);
  const actions = SUPPORT_ROLES.map((role, index) => ({
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
      bootstrap_message: claudeReadyBootstrapMessageFor(String(index + 1).repeat(32), role, projectRoot),
    },
    operation: 'Agent',
  }));
  const envelope = {
    actions,
    detail: 'support-plane-action-required',
    entrypoint: 'init-session',
    result: null,
    schema: 'runtime/collaboration-entrypoint-result/v1',
    selection: {
      actual_host: 'claude',
      actual_model: 'claude-sonnet-5',
      actual_role_engine: 'claude',
      continuity: 'session-persistent',
      fallback_reason: null,
      fallback_used: false,
      requested_host: 'claude',
      requested_model_profile: '.claude/model-profiles.json#current',
      requested_role_engine: 'claude',
    },
    status: 'ACTION_REQUIRED',
  };
  return Buffer.byteLength(JSON.stringify(envelope), 'utf8');
}

test('five receiver actions fit the pinned native tool-result transport budget', () => {
  const envelopeBytes = fiveRoleEnvelopeBytesForRootLength(MAX_SUPPORTED_PROJECT_ROOT_CHARS);
  assert.ok(envelopeBytes <= NATIVE_TOOL_RESULT_ENVELOPE_BUDGET_BYTES,
    `the complete five-role ACTION_REQUIRED must stay below the pinned host truncation boundary `
    + `for a project root of the declared maximum ${MAX_SUPPORTED_PROJECT_ROOT_CHARS} characters; saw ${envelopeBytes}`);
});

test('the envelope keeps genuine headroom above the declared maximum project-root length', () => {
  // Proves the declared bound is not merely asserted but actually achievable on
  // THIS host (the node path is ambient and also costs 5 bytes per character),
  // and pins the headroom so a change that fattens the envelope is caught even
  // when the declared maximum still happens to fit.
  let supported = 0;
  for (let length = 1; length <= 400; length += 1) {
    if (fiveRoleEnvelopeBytesForRootLength(length) <= NATIVE_TOOL_RESULT_ENVELOPE_BUDGET_BYTES) supported = length;
    else break;
  }
  assert.ok(supported >= MAX_SUPPORTED_PROJECT_ROOT_CHARS,
    `the envelope must support project roots of at least ${MAX_SUPPORTED_PROJECT_ROOT_CHARS} characters; `
    + `the largest that fits on this host is ${supported}`);
  // A shorter root must obviously still fit -- guards against an inverted or
  // length-insensitive measurement passing the bound check for the wrong reason.
  assert.ok(fiveRoleEnvelopeBytesForRootLength(20) < fiveRoleEnvelopeBytesForRootLength(120),
    'the envelope must grow with the project-root length, or this budget measures nothing');
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
});
