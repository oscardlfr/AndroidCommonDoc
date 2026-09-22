'use strict';
const assert = require('assert');
const test = require('node:test');
const { authorizePushActor } = require('../lib/push-peer-policy.cjs');

test('only the main host actor may perform a push', () => {
  assert.strictEqual(authorizePushActor({ operation: 'perform' }).ok, true);
  assert.deepStrictEqual(authorizePushActor({ operation: 'perform', agentType: 'quality-gater' }), {
    ok: false, reason: 'PEER_PUSH_PERFORM_DENIED',
  });
});

test('approved peers may request but not perform a push', () => {
  assert.strictEqual(authorizePushActor({ operation: 'request', agentType: 'quality-gater' }).ok, true);
  assert.strictEqual(authorizePushActor({ operation: 'request', agentType: 'toolkit-specialist' }).ok, false);
});

test('runtime capability assurance is never inferred from a role string', () => {
  assert.strictEqual(authorizePushActor({ operation: 'request', agentType: 'arch-platform' }).assurance, 'advisory-role');
  assert.strictEqual(authorizePushActor({ operation: 'request', agentType: 'arch-platform', runtimeBound: true }).assurance, 'runtime-capability');
});
