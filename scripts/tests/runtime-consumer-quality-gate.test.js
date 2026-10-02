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

// pre-pr is the canonical producer of the stamp that mint requires: a consumer has no other one. The secret scanner is
// an external binary, so these tests give the producer a stub of it (TRUFFLEHOG_BIN): the only simulation here.
function scannerStub(t, { findings = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-consumer-qg-scanner-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const bin = path.join(dir, 'trufflehog');
  fs.writeFileSync(bin, `#!/bin/sh\n[ "$1" = "--version" ] && { echo "stub 1.0"; exit 0; }\n${findings ? 'echo \'{"verified":true}\'' : ':'}\nexit 0\n`, { mode: 0o755 });
  return bin;
}

function prePr(root, slug, args, env) {
  return spawnSync(process.execPath, [SCRIPT, root, 'pre-pr', '--slug', slug, ...args], {
    cwd: root, encoding: 'utf8', env: { ...process.env, ...env },
  });
}

function qgFixtureWithoutStamp() {
  const { root, head } = fixture();
  fs.rmSync(path.join(root, '.androidcommondoc', 'pre-pr.stamp'));
  return { root, head };
}

test('pre-pr records a PASS stamp that mint then accepts, and keeps the reports out of git status', (t) => {
  const { root, head } = qgFixtureWithoutStamp();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const result = prePr(root, 'test', ['--project-gate', 'PASS'], { TRUFFLEHOG_BIN: scannerStub(t) });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const stamp = JSON.parse(fs.readFileSync(path.join(root, '.androidcommondoc', 'pre-pr.stamp'), 'utf8'));
  assert.deepEqual({ verdict: stamp.verdict, head: stamp.head, wave_slug: stamp.wave_slug }, { verdict: 'PASS', head, wave_slug: 'test' });
  assert.deepEqual(stamp.checks, { project_gate: 'PASS', tracked_worktree_clean: 'PASS', secret_scan: 'PASS' });
  assert.equal(git(root, ['status', '--porcelain']), '', 'the QG reports are ignored locally, not left untracked');
  assert.equal(mint(root).status, 0, 'the produced stamp is exactly what mint requires');
});

test('pre-pr records FAIL and exits 1 when the project gate failed, a secret was found or the tree is dirty', (t) => {
  for (const [label, args, env, dirty, failing] of [
    ['project gate', ['--project-gate', 'FAIL'], { TRUFFLEHOG_BIN: null }, false, 'project_gate'],
    ['secret found', ['--project-gate', 'PASS'], { TRUFFLEHOG_BIN: 'findings' }, false, 'secret_scan'],
    ['dirty tree', ['--project-gate', 'PASS'], { TRUFFLEHOG_BIN: null }, true, 'tracked_worktree_clean'],
  ]) {
    const { root } = qgFixtureWithoutStamp();
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    if (dirty) fs.writeFileSync(path.join(root, 'tracked.txt'), 'changed\n');
    const bin = env.TRUFFLEHOG_BIN === 'findings' ? scannerStub(t, { findings: true }) : scannerStub(t);
    const result = prePr(root, 'test', args, { TRUFFLEHOG_BIN: bin });
    assert.equal(result.status, 1, label + ': ' + (result.stderr || result.stdout));
    const stamp = JSON.parse(fs.readFileSync(path.join(root, '.androidcommondoc', 'pre-pr.stamp'), 'utf8'));
    assert.equal(stamp.verdict, 'FAIL', label);
    assert.equal(stamp.checks[failing], 'FAIL', label);
    if (!dirty) assert.notEqual(mint(root).status, 0, label + ': mint refuses a FAIL stamp');
  }
});

test('pre-pr needs the project gate outcome and a wave in phase QG at the current HEAD', (t) => {
  const { root } = qgFixtureWithoutStamp();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const env = { TRUFFLEHOG_BIN: scannerStub(t) };
  assert.match(prePr(root, 'test', [], env).stderr, /project-gate-required/);
  assert.match(prePr(root, 'test', ['--project-gate', 'maybe'], env).stderr, /project-gate-required/);
  fs.writeFileSync(path.join(root, '.androidcommondoc', 'wave-control', 'test.json'), JSON.stringify({ phase: 'EXECUTE', head: 'a'.repeat(40), plan_sha256: 'a'.repeat(64) }));
  assert.match(prePr(root, 'test', ['--project-gate', 'PASS'], env).stderr, /wave-state-not-current/);
  assert.equal(fs.existsSync(path.join(root, '.androidcommondoc', 'pre-pr.stamp')), false, 'no stamp when the preconditions fail');
});
