'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const SCRIPT = path.resolve(__dirname, '../lib/runtime-consumer-quality-gate.cjs');

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-consumer-qg-')));
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'runtime-qg@example.invalid']);
  git(root, ['config', 'user.name', 'Runtime QG']);
  fs.writeFileSync(path.join(root, 'tracked.txt'), 'fixture\n');
  git(root, ['add', 'tracked.txt']);
  git(root, ['commit', '-qm', 'fixture']);
  const head = git(root, ['rev-parse', 'HEAD']);
  const control = path.join(root, '.androidcommondoc', 'wave-control');
  fs.mkdirSync(control, { recursive: true });
  fs.writeFileSync(path.join(root, '.androidcommondoc', 'pre-pr.stamp'), `${JSON.stringify({
    verdict: 'PASS', timestamp: new Date().toISOString(), head,
  })}\n`);
  fs.writeFileSync(path.join(control, 'test.json'), `${JSON.stringify({
    phase: 'QG', head, plan_sha256: 'a'.repeat(64),
  })}\n`);
  return { root, head };
}

function mint(root) {
  return spawnSync(process.execPath, [SCRIPT, root, 'mint', '--slug', 'test'], {
    cwd: root, encoding: 'utf8',
  });
}

test('mint confines every artifact to regular consumer-owned ancestors', (t) => {
  const { root } = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const result = mint(root);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(fs.lstatSync(path.join(root, '.planning')).isDirectory(), true);
  assert.equal(fs.lstatSync(path.join(root, '.planning', 'wave-test')).isSymbolicLink(), false);
  assert.equal(fs.existsSync(path.join(root, '.planning', 'wave-test', 'qg-result.json')), true);
  assert.equal(fs.existsSync(path.join(root, '.androidcommondoc', 'push-proof.json')), true);
});

test('mint rejects a symlinked output ancestor without writing outside the consumer', {
  skip: process.platform === 'win32' ? 'symlink creation is privilege-dependent on Windows' : false,
}, (t) => {
  const { root } = fixture();
  const external = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-consumer-qg-external-')));
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(external, { recursive: true, force: true });
  });
  fs.symlinkSync(external, path.join(root, '.planning'));

  const result = mint(root);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /path-ancestor-unsafe/);
  assert.equal(fs.existsSync(path.join(external, 'wave-test', 'qg-result.json')), false);
  assert.equal(fs.existsSync(path.join(root, '.androidcommondoc', 'push-proof.json')), false);
});
