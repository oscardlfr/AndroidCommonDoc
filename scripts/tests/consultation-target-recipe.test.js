'use strict';

// One closed command grammar for every consultation target: the persistent role's startup bootstrap and the one-shot
// claude-agent bootstrap embed the same line, so a one-shot is told how to claim instead of guessing.

const assert = require('node:assert');
const path = require('node:path');
const { test } = require('node:test');

const rll = require('../lib/runtime-role-lifecycle.cjs');
const { consultationTargetCommandLine, oneShotConsultationRecipe } = require('../lib/runtime-role-lifecycle/consultation-target-recipe.cjs')
  .createConsultationTargetRecipe();

const INPUT = Object.freeze({
  role: 'context-provider',
  projectRoot: '/consumer/app',
  consultationCliPath: '/toolkit/scripts/lib/runtime-consultation.cjs',
  coordinationRoot: '/consumer/app/.planning/coordination',
  requestPath: '/consumer/app/.planning/coordination/r/w/p/transactions/abc/request.json',
});

test('the persistent bootstrap and the one-shot recipe embed the identical command line', () => {
  const persistent = rll.claudeReadyBootstrapMessageFor(
    'a'.repeat(32), 'context-provider', fsRealpath(path.resolve(__dirname, '..', '..')),
  );
  assert.ok(persistent.includes(consultationTargetCommandLine()), 'persistent bootstrap must carry the shared command line');
  assert.ok(oneShotConsultationRecipe(INPUT).includes(consultationTargetCommandLine()), 'one-shot recipe must carry it too');
});

test('the one-shot recipe names the canonical CLI, the request, the coordination root and every target command', () => {
  const recipe = oneShotConsultationRecipe(INPUT);
  for (const fragment of [INPUT.consultationCliPath, INPUT.requestPath, INPUT.coordinationRoot, INPUT.role,
    '["claim"]', '["lease-heartbeat"]', '["publish-result"]', 'no-chain',
    'Z=["--claim",artifact_ref]', 'b64url(result)', 'invalid:stop']) {
    assert.ok(recipe.includes(fragment), 'recipe must contain ' + fragment + ': ' + recipe);
  }
  assert.deepStrictEqual(JSON.parse(recipe.split('\n')[0]), { n: 'node', p: INPUT.projectRoot, r: INPUT.role });
  assert.strictEqual(recipe, oneShotConsultationRecipe(INPUT), 'the recipe is deterministic');
});

test('a missing or non-string field is rejected instead of producing a partial recipe', () => {
  for (const field of Object.keys(INPUT)) {
    assert.throws(() => oneShotConsultationRecipe({ ...INPUT, [field]: '' }), /invalid-/, field);
    assert.throws(() => oneShotConsultationRecipe({ ...INPUT, [field]: undefined }), /invalid-/, field);
  }
});

test('claudeAgentBootstrapMessageFor keeps its base message and appends the recipe only when given one', () => {
  const base = rll.claudeAgentBootstrapMessageFor('context-provider', 'req1', 'att1');
  assert.ok(base.startsWith('You are being activated as context-provider to handle consultation request req1 (attempt att1).'));
  assert.ok(!base.includes('claim'), 'without a recipe nothing about claiming is added');
  const recipe = oneShotConsultationRecipe(INPUT);
  assert.strictEqual(rll.claudeAgentBootstrapMessageFor('context-provider', 'req1', 'att1', recipe), base + '\n' + recipe);
  assert.strictEqual(rll.claudeAgentBootstrapMessageFor('context-provider', 'req1', 'att1', ''), base);
});

function fsRealpath(p) { return require('node:fs').realpathSync(p); }
