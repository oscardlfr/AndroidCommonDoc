'use strict';

// A consumer accumulates `.planning/wave-*` directories. Requester authority and `consult` must resolve the session's own
// wave through the existing branch resolver (`<prefix>/<slug>`, no env, no alias) instead of failing as "no discoverable PLAN".
// The option is opt-in: every other discoverPlan caller keeps its exact-one-wave contract.

require('./lib/private-registry-tmpdir-preload.cjs');

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

const rll = require('../lib/runtime-role-lifecycle.cjs');
const BY_BRANCH = { activeWaveByBranch: true };

function project(branch, waves) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'active-wave-')));
  const git = (...args) => assert.strictEqual(spawnSync('git', args, { cwd: root, encoding: 'utf8' }).status, 0, args.join(' '));
  git('init', '-q', '-b', 'develop');
  git('config', 'user.email', 'wave@test.local');
  git('config', 'user.name', 'Wave');
  git('commit', '-q', '--allow-empty', '-m', 'init');
  if (branch !== 'develop') git('switch', '-q', '-c', branch);
  for (const [slug, hasPlan] of Object.entries(waves)) {
    const dir = path.join(root, '.planning', 'wave-' + slug);
    fs.mkdirSync(dir, { recursive: true });
    if (hasPlan) fs.writeFileSync(path.join(dir, 'PLAN.md'), '# plan ' + slug + '\n');
  }
  return root;
}

function withProject(branch, waves, fn) {
  const root = project(branch, waves);
  try { return fn(root); } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test('several waves: the wave named by the feature branch is accepted', () => {
  withProject('feature/consult-live3', { 'consult-live': true, 'consult-live3': true, 'other': true }, (root) => {
    const found = rll.discoverPlan(root, null, BY_BRANCH);
    assert.strictEqual(found.ok, true, JSON.stringify(found));
    assert.strictEqual(found.planPath, path.join(root, '.planning', 'wave-consult-live3', 'PLAN.md'));
  });
});

test('several waves without a matching branch fail exactly as before', () => {
  withProject('feature/unrelated', { a: true, b: true }, (root) => {
    assert.deepStrictEqual(rll.discoverPlan(root, null, BY_BRANCH), { ok: false });
  });
  withProject('develop', { a: true, b: true }, (root) => {
    assert.deepStrictEqual(rll.discoverPlan(root, null, BY_BRANCH), { ok: false }, 'a protected branch names no wave');
  });
  withProject('feature/b', { a: true, b: false, c: true }, (root) => {
    assert.deepStrictEqual(rll.discoverPlan(root, null, BY_BRANCH), { ok: false }, 'the named wave must have a PLAN');
  });
});

test('a single wave is unchanged, with or without the option and whatever the branch', () => {
  withProject('feature/whatever', { only: true }, (root) => {
    const plain = rll.discoverPlan(root);
    const byBranch = rll.discoverPlan(root, null, BY_BRANCH);
    assert.strictEqual(plain.ok, true);
    assert.deepStrictEqual(byBranch, plain);
  });
});

test('without the option several waves stay ambiguous even on the matching branch (opt-in only)', () => {
  withProject('feature/b', { a: true, b: true }, (root) => {
    assert.deepStrictEqual(rll.discoverPlan(root), { ok: false });
  });
});

test('the environment and the planning alias never choose a wave', () => {
  withProject('feature/unrelated', { a: true, b: true }, (root) => {
    const saved = process.env.CLAUDE_WAVE_SLUG;
    process.env.CLAUDE_WAVE_SLUG = 'b';
    try { assert.deepStrictEqual(rll.discoverPlan(root, null, BY_BRANCH), { ok: false }); }
    finally { if (saved === undefined) delete process.env.CLAUDE_WAVE_SLUG; else process.env.CLAUDE_WAVE_SLUG = saved; }
  });
});
