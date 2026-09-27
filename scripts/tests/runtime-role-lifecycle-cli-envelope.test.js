#!/usr/bin/env node
'use strict';

const assert = require('node:assert');
const { test } = require('node:test');
const path = require('node:path');

const { createCliEnvelope } = require(path.resolve(
  __dirname, '../lib/runtime-role-lifecycle/cli-envelope.cjs',
));

test('emitAndExit waits for a piped stdout flush before exiting', () => {
  const envelope = createCliEnvelope({});
  const originalWrite = process.stdout.write;
  const originalExit = process.exit;
  const originalExitCode = process.exitCode;
  let flushCallback = null;
  const exitCalls = [];
  let written = '';

  try {
    process.stdout.write = (chunk, callback) => {
      written += String(chunk);
      flushCallback = callback;
      return false;
    };
    process.exit = (code) => {
      exitCalls.push(code);
    };

    const result = envelope.makeResult(
      'ensure', envelope.RC.OK, 'ACTION_REQUIRED', 'NONE', [], [{
        action_id: 'a'.repeat(32),
        payload: 'x'.repeat(16 * 1024),
      }],
    );
    envelope.emitAndExit(result);

    assert.strictEqual(process.exitCode, 0);
    assert.deepStrictEqual(exitCalls, [], 'must not exit while the pipe is still draining');
    assert.strictEqual(typeof flushCallback, 'function');
    assert.deepStrictEqual(JSON.parse(written), result);

    flushCallback();
    assert.deepStrictEqual(exitCalls, [0], 'exits only after the complete JSON line flushed');
  } finally {
    process.stdout.write = originalWrite;
    process.exit = originalExit;
    process.exitCode = originalExitCode;
  }
});
