#!/usr/bin/env node
'use strict';

// Sequence 0009: black-box characterization of createAppServerConnection's
// incoming-frame router and safe-shutdown wiring, captured BEFORE splitting
// the connection into controllers, so a behavior change during that split is
// caught here rather than discovered live. Drives the real public connection
// object over fake PassThrough stdio -- never reaches into closure internals.

const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const { PassThrough } = require('node:stream');

const facadePath = path.resolve(__dirname, '..', 'lib', 'runtime-bridge-codex.cjs');

function freshFacade() {
  delete require.cache[require.resolve(facadePath)];
  return require(facadePath);
}

function makeStreams() {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const written = [];
  let buffer = '';
  stdin.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let idx;
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      if (line.length > 0) written.push(JSON.parse(line));
    }
  });
  return { stdin, stdout, written };
}

function respond(stdout, obj) {
  stdout.write(JSON.stringify(obj) + '\n');
}

async function tick() {
  await new Promise((resolve) => setImmediate(resolve));
}

test('CHAR-01 initialize allocates request id 1, writes exactly one frame, and resolves on the matching response', async () => {
  const facade = freshFacade();
  const { stdin, stdout, written } = makeStreams();
  const connection = facade.createAppServerConnection({ stdin, stdout });
  const p = connection.initialize();
  await tick();
  assert.equal(written.length, 1);
  assert.equal(written[0].id, 1);
  assert.equal(written[0].method, 'initialize');
  respond(stdout, { id: 1, result: { userAgent: 'x', codexHome: '/x', platformFamily: 'linux', platformOs: 'linux' } });
  const result = await p;
  assert.equal(result.ok, true);
  assert.equal(connection.connectionPhase(), 'INITIALIZED');
});

test('CHAR-02 a malformed (non-JSON) line stops the connection with reason malformed-frame:malformed-json and fails the pending call', async () => {
  const facade = freshFacade();
  const { stdin, stdout } = makeStreams();
  const connection = facade.createAppServerConnection({ stdin, stdout });
  const p = connection.initialize();
  stdout.write('not json\n');
  const result = await p;
  assert.equal(result.ok, false);
  assert.equal(connection.isStopped(), true);
  assert.equal(connection.stopReason(), 'malformed-frame:malformed-json');
});

test('CHAR-03 a response carrying an invented jsonrpc member stops the connection with reason malformed-frame:frame-has-invented-jsonrpc-member', async () => {
  const facade = freshFacade();
  const { stdin, stdout } = makeStreams();
  const connection = facade.createAppServerConnection({ stdin, stdout });
  connection.initialize();
  stdout.write(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }) + '\n');
  await tick();
  assert.equal(connection.stopReason(), 'malformed-frame:frame-has-invented-jsonrpc-member');
});

test('CHAR-04 an extra-key response wrapper stops the connection with reason invalid-frame:response-wrapper-extra-keys', async () => {
  const facade = freshFacade();
  const { stdin, stdout } = makeStreams();
  const connection = facade.createAppServerConnection({ stdin, stdout });
  connection.initialize();
  respond(stdout, { id: 1, result: {}, extra: true });
  await tick();
  assert.equal(connection.stopReason(), 'invalid-frame:response-wrapper-extra-keys');
});

test('CHAR-05 transport EOF (stdout end) settles the pending call as possibly-delivered and stops with reason transport-eof', async () => {
  const facade = freshFacade();
  const { stdin, stdout } = makeStreams();
  const connection = facade.createAppServerConnection({ stdin, stdout });
  const p = connection.initialize();
  stdout.end();
  const result = await p;
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'transport-eof-possibly-delivered');
  assert.equal(connection.stopReason(), 'transport-eof');
});

test('CHAR-06 transport error (stdout emits error) settles the pending call as possibly-delivered and stops with a transport-error reason', async () => {
  const facade = freshFacade();
  const { stdin, stdout } = makeStreams();
  const connection = facade.createAppServerConnection({ stdin, stdout });
  const p = connection.initialize();
  stdout.emit('error', new Error('boom'));
  const result = await p;
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'transport-error-possibly-delivered:boom');
  assert.equal(connection.stopReason(), 'transport-error:boom');
});

test('CHAR-07 after STOP, a second call is rejected with reason connection-stopped and writes no further frame', async () => {
  const facade = freshFacade();
  const { stdin, stdout, written } = makeStreams();
  const connection = facade.createAppServerConnection({ stdin, stdout });
  const p = connection.initialize();
  stdout.end();
  await p;
  const before = written.length;
  const second = await connection.initialize();
  assert.equal(second.ok, false);
  assert.equal(second.reason, 'connection-stopped');
  assert.equal(written.length, before);
});

test('CHAR-08 a response for an unknown id with no matching pending call is diagnostic-only (never stops the connection)', async () => {
  const facade = freshFacade();
  const { stdin, stdout } = makeStreams();
  const connection = facade.createAppServerConnection({ stdin, stdout });
  respond(stdout, { id: 999, result: {} });
  await tick();
  assert.equal(connection.isStopped(), false);
});

test('CHAR-09 an unknown server-request method gets the frozen unknown-method error reply and STOPs', async () => {
  const facade = freshFacade();
  const { stdin, stdout, written } = makeStreams();
  const connection = facade.createAppServerConnection({ stdin, stdout });
  respond(stdout, { id: 7, method: 'totally/unknown', params: {} });
  await tick();
  const reply = written.find((f) => f.id === 7);
  assert.deepEqual(reply.error, { code: -32601, message: 'unknown method' });
  assert.equal(connection.stopReason(), 'unknown-server-request-method:totally/unknown');
});

test('CHAR-10 a fixed-row server-request (attestation/generate, params must be exactly {}) gets its exact frozen reply and STOPs afterward', async () => {
  const facade = freshFacade();
  const { stdin, stdout, written } = makeStreams();
  const connection = facade.createAppServerConnection({ stdin, stdout });
  respond(stdout, { id: 3, method: 'attestation/generate', params: {} });
  await tick();
  const reply = written.find((f) => f.id === 3);
  assert.deepEqual(reply.error, { code: -32601, message: 'non-interactive bridge issues no attestation' });
  assert.equal(connection.stopReason(), 'server-request-attestation/generate');
});
