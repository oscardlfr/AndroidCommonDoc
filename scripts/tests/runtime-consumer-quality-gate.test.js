'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const waveControl = require('../lib/wave-control-plane.cjs');
const { installConsumerFixture } = require('./lib/consumer-runtime-fixture.cjs');

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

function commitWavePlans(root, slugs, message) {
  for (const slug of slugs) {
    const waveDir = path.join(root, '.planning', `wave-${slug}`);
    fs.mkdirSync(waveDir, { recursive: true });
    fs.writeFileSync(path.join(waveDir, 'PLAN.md'), '### Wave Class\n\n- **Class**: HARNESS\n\n### Path-Manifest\n\n- tracked.txt\n');
    fs.writeFileSync(path.join(waveDir, 'CLASS'), 'HARNESS\n');
    git(root, ['add', '-f', path.relative(root, path.join(waveDir, 'PLAN.md')), path.relative(root, path.join(waveDir, 'CLASS'))]);
  }
  git(root, ['commit', '-qm', message]);
}

function promoteWaveStateToQG(root, slug) {
  const state = waveControl.initialize(root, slug);
  const now = new Date().toISOString();
  const transition = (from, to) => ({
    from, to, at: now, from_head: state.head, to_head: state.head, evidence: [],
  });
  const qg = {
    ...state,
    phase: 'QG',
    revision: 3,
    updated_at: now,
    transitions: [
      transition('PREP', 'EXECUTE'),
      transition('EXECUTE', 'VERIFY_FINAL'),
      transition('VERIFY_FINAL', 'QG'),
    ],
  };
  fs.writeFileSync(path.join(root, '.androidcommondoc', 'wave-control', `${slug}.json`), `${JSON.stringify(qg, null, 2)}\n`);
}

function resolveActiveWaveThroughLauncher(fixture, env = {}) {
  return spawnSync(process.execPath, [fixture.launcher, 'run', 'runtime-consumer-qg',
    '--project-root', fixture.consumerRoot, '--', 'resolve-active-wave'], {
    cwd: fixture.consumerRoot, encoding: 'utf8', env: { ...process.env, ...env },
  });
}

test('resolve-active-wave ignores ambient slug and newer stale wave state, selecting the only current QG state', (t) => {
  const fixture = installConsumerFixture('L2');
  t.after(() => fs.rmSync(fixture.consumerRoot, { recursive: true, force: true }));

  commitWavePlans(fixture.consumerRoot, ['stale'], 'stale wave');
  promoteWaveStateToQG(fixture.consumerRoot, 'stale');
  const staleState = path.join(fixture.consumerRoot, '.androidcommondoc', 'wave-control', 'stale.json');

  commitWavePlans(fixture.consumerRoot, ['current'], 'current wave');
  promoteWaveStateToQG(fixture.consumerRoot, 'current');
  const future = new Date(Date.now() + 60_000);
  fs.utimesSync(staleState, future, future);

  const result = resolveActiveWaveThroughLauncher(fixture, { CLAUDE_WAVE_SLUG: 'stale' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stdout, 'current\n');
});

test('resolve-active-wave fails closed when no durable state is currently in QG', (t) => {
  const fixture = installConsumerFixture('L1');
  t.after(() => fs.rmSync(fixture.consumerRoot, { recursive: true, force: true }));
  commitWavePlans(fixture.consumerRoot, ['prep-only'], 'prep wave');
  waveControl.initialize(fixture.consumerRoot, 'prep-only');

  const result = resolveActiveWaveThroughLauncher(fixture, { CLAUDE_WAVE_SLUG: 'prep-only' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /active-qg-wave-not-found/);
});

test('resolve-active-wave fails closed when two durable QG states are current', (t) => {
  const fixture = installConsumerFixture('L2');
  t.after(() => fs.rmSync(fixture.consumerRoot, { recursive: true, force: true }));
  commitWavePlans(fixture.consumerRoot, ['alpha', 'beta'], 'ambiguous waves');
  promoteWaveStateToQG(fixture.consumerRoot, 'alpha');
  promoteWaveStateToQG(fixture.consumerRoot, 'beta');

  const result = resolveActiveWaveThroughLauncher(fixture);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /active-qg-wave-ambiguous/);
});

test('every quality-gater surface resolves durable wave state per Bash block instead of reading ambient slug', () => {
  const root = path.resolve(__dirname, '../..');
  const canonical = fs.readFileSync(path.join(root, '.claude', 'agents', 'quality-gater.md'), 'utf8');
  const mirror = fs.readFileSync(path.join(root, 'setup', 'agent-templates', 'quality-gater.md'), 'utf8');
  const copilot = fs.readFileSync(path.join(root, 'setup', 'copilot-agent-templates', 'quality-gater.agent.md'), 'utf8');
  assert.equal(canonical, mirror, 'the installed Claude agent and source template stay byte-identical');

  for (const [label, contents] of [['canonical', canonical], ['copilot', copilot]]) {
    assert.equal((contents.match(/run runtime-consumer-qg --project-root "\$PWD" -- resolve-active-wave/g) || []).length, 6, label);
    assert.doesNotMatch(contents, /\$\{CLAUDE_WAVE_SLUG:\?/);
    assert.doesNotMatch(contents, /--(?:wave-)?slug "\$CLAUDE_WAVE_SLUG"/);
    assert.match(contents, /persisted QG phase state .* is the authority/);
  }
  assert.equal((canonical.match(/CLAUDE_WAVE_SLUG="\$wave_slug"/g) || []).length, 1,
    'the sole remaining environment assignment is scoped to the same legacy L0 proof invocation');
});

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
