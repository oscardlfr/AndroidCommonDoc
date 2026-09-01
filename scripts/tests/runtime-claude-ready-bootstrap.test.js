'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  claudeReadyBootstrapMessageFor,
  renderPosixDirect,
  parsePosixDirect,
} = require('../lib/runtime-role-lifecycle.cjs');

const VALID_ACTION_ID = 'a'.repeat(32);

test('valid 32-hex action id returns one line with fixed prefix and suffix', () => {
  const message = claudeReadyBootstrapMessageFor(VALID_ACTION_ID);
  assert.equal(message.split('\n').length, 1);
  assert.ok(message.startsWith('Execute `'));
  assert.ok(message.endsWith('` as one standalone Bash call, read the validated bootstrap/bundle, then enter WAITING.'));
});

test('the embedded command parses with the real parsePosixDirect', () => {
  const message = claudeReadyBootstrapMessageFor(VALID_ACTION_ID);
  const command = message.slice('Execute `'.length, message.indexOf('` as one standalone'));
  const argv = parsePosixDirect(command);
  assert.ok(Array.isArray(argv));
});

test('parsed argv length is exactly five', () => {
  const message = claudeReadyBootstrapMessageFor(VALID_ACTION_ID);
  const command = message.slice('Execute `'.length, message.indexOf('` as one standalone'));
  const argv = parsePosixDirect(command);
  assert.equal(argv.length, 5);
});

test('argv[0] is fs.realpathSync(process.execPath)', () => {
  const message = claudeReadyBootstrapMessageFor(VALID_ACTION_ID);
  const command = message.slice('Execute `'.length, message.indexOf('` as one standalone'));
  const argv = parsePosixDirect(command);
  assert.equal(argv[0], fs.realpathSync(process.execPath));
});

test('argv[1] is path.resolve(__dirname, ../lib/runtime-role-lifecycle.cjs)', () => {
  const message = claudeReadyBootstrapMessageFor(VALID_ACTION_ID);
  const command = message.slice('Execute `'.length, message.indexOf('` as one standalone'));
  const argv = parsePosixDirect(command);
  assert.equal(argv[1], path.resolve(__dirname, '../lib/runtime-role-lifecycle.cjs'));
});

test('argv[2..4] are exactly ready --action <actionId>', () => {
  const message = claudeReadyBootstrapMessageFor(VALID_ACTION_ID);
  const command = message.slice('Execute `'.length, message.indexOf('` as one standalone'));
  const argv = parsePosixDirect(command);
  assert.deepEqual(argv.slice(2), ['ready', '--action', VALID_ACTION_ID]);
});

test('renderPosixDirect reproduces the embedded command byte-for-byte, no bare ready', () => {
  const message = claudeReadyBootstrapMessageFor(VALID_ACTION_ID);
  const command = message.slice('Execute `'.length, message.indexOf('` as one standalone'));
  const argv = parsePosixDirect(command);
  assert.equal(renderPosixDirect(argv), command);
  assert.ok(!message.includes('Execute `ready --action'));
});

test('invalid action ids throw TypeError with message invalid-action-id', () => {
  const invalidIds = [null, '', 'abc', 'g'.repeat(32), 'a'.repeat(31), 'A'.repeat(32)];
  for (const id of invalidIds) {
    assert.throws(
      () => claudeReadyBootstrapMessageFor(id),
      (err) => err instanceof TypeError && err.message === 'invalid-action-id'
    );
  }
});
