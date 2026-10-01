'use strict';

// A session whose model differs from the active profile must get an actionable detail; every other
// composition failure stays the deliberately opaque one, and init-session tells the user the one-line fix.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { hostCompositionFailureDetail } = require('../lib/runtime-collaboration-entrypoints.cjs');

const repoRoot = path.resolve(__dirname, '..', '..');

test('a model/profile mismatch maps to host-model-mismatch', () => {
  assert.strictEqual(hostCompositionFailureDetail({ ok: false, reason: 'HOST_MODEL_PROFILE_MISMATCH' }), 'host-model-mismatch');
});

test('every other failure (and malformed input) stays host-composition-unavailable', () => {
  for (const consumed of [{ ok: false }, { ok: false, reason: 'HOST_PIN_UNPROVEN' }, { ok: false, reason: 'host-model-mismatch' }, null, undefined, 'HOST_MODEL_PROFILE_MISMATCH']) {
    assert.strictEqual(hostCompositionFailureDetail(consumed), 'host-composition-unavailable', JSON.stringify(consumed));
  }
});

test('the init-session skill prints the one-line model/effort fix for host-model-mismatch', () => {
  const skill = fs.readFileSync(path.join(repoRoot, 'skills', 'init-session', 'SKILL.md'), 'utf8');
  assert.match(skill, /host-model-mismatch/);
  assert.match(skill, /Switch the session model to Sonnet 5\.5 and effort High/);
});
