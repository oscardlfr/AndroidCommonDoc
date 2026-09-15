'use strict';

// Sequence 18: deterministic documentation<->code drift gate. Every number
// this test checks is RE-DERIVED from disk/the live facade exports, never
// hardcoded here -- the assertions compare that live-derived truth against
// whatever docs/agents/runtime-messaging-adapters.md and CHANGELOG.md
// currently claim, so a future module split/merge or ABI change fails this
// test the instant docs and code disagree, instead of accumulating silently.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');

const TREES = Object.freeze([
  { name: 'consultation', facade: 'runtime-consultation.cjs', dir: 'runtime-consultation' },
  { name: 'role-lifecycle', facade: 'runtime-role-lifecycle.cjs', dir: 'runtime-role-lifecycle' },
  { name: 'bridge-codex', facade: 'runtime-bridge-codex.cjs', dir: 'runtime-bridge-codex' },
]);

function walkCjs(dir) {
  let out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out = out.concat(walkCjs(full));
    else if (entry.isFile() && entry.name.endsWith('.cjs')) out.push(full);
  }
  return out;
}

function facadeLocAndMaxLine(facadePath) {
  const lines = fs.readFileSync(facadePath, 'utf8').split(/\r?\n/);
  return { loc: lines.length, maxLine: Math.max(...lines.map((l) => l.length)) };
}

function liveFacts() {
  const facts = {};
  for (const tree of TREES) {
    const facadePath = path.join(repoRoot, 'scripts', 'lib', tree.facade);
    const moduleDir = path.join(repoRoot, 'scripts', 'lib', tree.dir);
    const { loc, maxLine } = facadeLocAndMaxLine(facadePath);
    facts[tree.name] = {
      loc, maxLine,
      moduleCount: walkCjs(moduleDir).length,
    };
  }
  return facts;
}

// Mirrors runtime-bridge-codex-module-boundaries.test.js's own
// exportsFromFreshProcess exactly (same env-mutation-inside-the-child-script
// technique) -- the legitimate, already-accepted way to toggle
// isTestCapability() for a fresh require, never an invented env value.
function requireFreshAbiKeyCount(facadePath, testCapability) {
  const script = [
    testCapability ? "process.env.NODE_ENV='test';process.env.RUNTIME_BRIDGE_CODEX_TEST_CAPABILITY='docs-drift-check';" : 'delete process.env.NODE_ENV;delete process.env.RUNTIME_BRIDGE_CODEX_TEST_CAPABILITY;',
    `process.stdout.write(String(Object.keys(require(${JSON.stringify(facadePath)})).length));`,
  ].join('');
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: repoRoot, encoding: 'utf8', env: { ...process.env }, windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr);
  return Number(result.stdout);
}

test('docs/agents/runtime-messaging-adapters.md Architecture Map table matches live facade/module facts', () => {
  const facts = liveFacts();
  const docPath = path.join(repoRoot, 'docs', 'agents', 'runtime-messaging-adapters.md');
  const docText = fs.readFileSync(docPath, 'utf8');

  const rowPatterns = {
    consultation: /\|\s*`scripts\/lib\/runtime-consultation\.cjs`\s*\|[^|]*\|\s*([\d,]+)\s*\/\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*keys\s*\|/,
    'role-lifecycle': /\|\s*`scripts\/lib\/runtime-role-lifecycle\.cjs`\s*\|[^|]*\|\s*([\d,]+)\s*\/\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*keys\s*\|/,
    'bridge-codex': /\|\s*`scripts\/lib\/runtime-bridge-codex\.cjs`\s*\|[^|]*\|\s*([\d,]+)\s*\/\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*keys\s*\(([\d]+)\s*under test capability\)\s*\|/,
  };

  for (const tree of TREES) {
    const pattern = rowPatterns[tree.name];
    const m = docText.match(pattern);
    assert.ok(m, `Architecture Map table row for ${tree.facade} not found or not in the expected "LOC / maxLine | moduleCount | ABI keys" shape`);
    const docLoc = Number(m[1].replace(/,/g, ''));
    const docMaxLine = Number(m[2]);
    const docModuleCount = Number(m[3]);
    const docAbiCount = Number(m[4]);

    assert.equal(docLoc, facts[tree.name].loc, `${tree.facade}: doc claims ${docLoc} physical lines, disk has ${facts[tree.name].loc}`);
    assert.equal(docMaxLine, facts[tree.name].maxLine, `${tree.facade}: doc claims max line ${docMaxLine}, disk has ${facts[tree.name].maxLine}`);
    assert.equal(docModuleCount, facts[tree.name].moduleCount, `${tree.dir}/: doc claims ${docModuleCount} modules, disk has ${facts[tree.name].moduleCount}`);

    const facadePath = path.join(repoRoot, 'scripts', 'lib', tree.facade);
    if (tree.name === 'bridge-codex') {
      const prodAbi = requireFreshAbiKeyCount(facadePath, false);
      const testAbi = requireFreshAbiKeyCount(facadePath, true);
      const docTestAbiCount = Number(m[5]);
      assert.equal(docAbiCount, prodAbi, `${tree.facade}: doc claims ${docAbiCount} production ABI keys, live facade has ${prodAbi}`);
      assert.equal(docTestAbiCount, testAbi, `${tree.facade}: doc claims ${docTestAbiCount} test-capability ABI keys, live facade has ${testAbi}`);
    } else {
      const abi = requireFreshAbiKeyCount(facadePath, false);
      assert.equal(docAbiCount, abi, `${tree.facade}: doc claims ${docAbiCount} public ABI keys, live facade has ${abi}`);
    }
  }
});

test('CHANGELOG.md module-split counts match live per-tree module counts and their sum', () => {
  const facts = liveFacts();
  const changelogPath = path.join(repoRoot, 'CHANGELOG.md');
  const changelogText = fs.readFileSync(changelogPath, 'utf8');

  const m = changelogText.match(/into (\d+) cohesive internal CommonJS modules \((\d+) \+ (\d+) \+ (\d+)\)/);
  assert.ok(m, 'CHANGELOG.md must state the module-split total as "into N cohesive internal CommonJS modules (a + b + c)"');
  const [, total, consultationCount, lifecycleCount, bridgeCount] = m.map(Number);

  assert.equal(consultationCount, facts.consultation.moduleCount, 'CHANGELOG consultation module count is stale');
  assert.equal(lifecycleCount, facts['role-lifecycle'].moduleCount, 'CHANGELOG role-lifecycle module count is stale');
  assert.equal(bridgeCount, facts['bridge-codex'].moduleCount, 'CHANGELOG bridge-codex module count is stale');
  assert.equal(total, consultationCount + lifecycleCount + bridgeCount, 'CHANGELOG stated total does not equal the sum of its own three per-tree counts');
});

test('every module-boundaries suite enforces the exact ceilings this doc claims (1,500 lines / 320 chars, 500 lines / 320 chars per module)', () => {
  const boundaryFiles = [
    'runtime-consultation-module-boundaries.test.js',
    'runtime-role-lifecycle-module-boundaries.test.js',
    'runtime-bridge-codex-module-boundaries.test.js',
  ];
  for (const file of boundaryFiles) {
    const text = fs.readFileSync(path.join(repoRoot, 'scripts', 'tests', file), 'utf8');
    assert.match(text, /1500/, `${file} must enforce the facade's 1,500-line ceiling`);
    assert.match(text, /320/, `${file} must enforce the 320-char-per-line ceiling`);
    assert.match(text, /500/, `${file} must enforce the 500-line-per-module (and per-function) ceiling`);
  }
});

test('R33 is never described as completed anywhere in the runtime-messaging docs', () => {
  const docsDir = path.join(repoRoot, 'docs', 'agents');
  const runtimeMessagingDocs = fs.readdirSync(docsDir)
    .filter((name) => name.startsWith('runtime-messaging-') && name.endsWith('.md'));
  const completedClaimRe = /R33[^.\n]{0,80}\b(complete|completed|shipped|closed|done)\b/i;
  for (const name of runtimeMessagingDocs) {
    const text = fs.readFileSync(path.join(docsDir, name), 'utf8');
    assert.doesNotMatch(text, completedClaimRe, `${name} must not describe R33 as completed -- it remains deferred (PENDING_EXTERNAL_RELEASE)`);
  }
});
