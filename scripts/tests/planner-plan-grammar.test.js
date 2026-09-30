'use strict';

// The planner template is the canonical PLAN producer and the wave control
// plane is its consumer. `/init-session --orchestrate <slug>` validates the
// Pass A draft before Pass B, so the draft's Wave Class block must already be
// parseable. A provisional annotation on the class line made planning from
// scratch fail closed with an opaque R131/P3 in the L2 physical acceptance.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const waveControl = require('../lib/wave-control-plane.cjs');

const repoRoot = path.resolve(__dirname, '..', '..');
const templates = [
  path.join(repoRoot, 'setup', 'agent-templates', 'planner.md'),
  path.join(repoRoot, '.claude', 'agents', 'planner.md'),
];

function waveClassBlock(template) {
  const lines = template.split(/\r?\n/);
  const start = lines.indexOf('### Wave Class');
  assert.ok(start >= 0, 'planner template must document a ### Wave Class block');
  const block = [];
  for (let i = start; i < lines.length && lines[i].trim() !== ''; i += 1) block.push(lines[i]);
  return block.join('\n');
}

function draftFor(template, className, architects) {
  const block = waveClassBlock(template)
    .replace('<HARNESS|DOC|FAST-PATH>', className)
    .replace(/<comma-separated arch-\* roles; DOC waves only>/, architects);
  return ['STATUS: DRAFT-CONTEXT-PENDING', '', '## Execution Plan: probe', '', block, ''].join('\n');
}

for (const templatePath of templates) {
  const label = path.relative(repoRoot, templatePath);

  test(`${label}: an instantiated Pass A Wave Class block is accepted by the wave control plane`, () => {
    const template = fs.readFileSync(templatePath, 'utf8');
    const doc = draftFor(template, 'DOC', 'arch-integration');
    assert.strictEqual(waveControl.parsePlanClass(doc), 'DOC');
    assert.deepStrictEqual(waveControl.requiredRoles(repoRoot, doc, 'DOC'), ['arch-integration']);
    const harness = draftFor(template, 'HARNESS', 'arch-platform');
    assert.strictEqual(waveControl.parsePlanClass(harness), 'HARNESS');
    assert.deepStrictEqual(
      waveControl.requiredRoles(repoRoot, harness, 'HARNESS'),
      ['arch-platform', 'arch-testing', 'arch-integration'],
    );
  });

  test(`${label}: the planner writes the CLASS sentinel with the Pass A draft`, () => {
    const template = fs.readFileSync(templatePath, 'utf8');
    assert.match(template, /Write the CLASS sentinel in BOTH passes/);
    assert.match(template, /exactly `- \*\*Class\*\*: <HARNESS\|DOC\|FAST-PATH>` with no annotation/);
  });
}

test('an annotated class line is rejected, which is why the template forbids annotations', () => {
  const annotated = '### Wave Class\n- **Class**: DOC (provisional; confirm in Pass B)\n';
  assert.throws(() => waveControl.parsePlanClass(annotated), /INVALID_WAVE_CLASS/);
});
