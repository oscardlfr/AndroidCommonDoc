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
  fs.mkdirSync(path.join(root, '.planning', 'wave-test'), { recursive: true });
  fs.mkdirSync(path.join(root, '.claude', 'registry'), { recursive: true });
  fs.writeFileSync(path.join(root, '.planning', 'wave-test', 'PLAN.md'), '## Wave Class\n\n- **Class**: FAST-PATH\n');
  fs.writeFileSync(path.join(root, '.planning', 'wave-test', 'CLASS'), 'FAST-PATH\n');
  fs.writeFileSync(path.join(root, '.claude', 'registry', 'wave-topology.yaml'), [
    'class_artifacts:', '  FAST-PATH:', '    architects: []', '    lifecycle_roles: []',
    '    execution_mode: disk-only', '',
  ].join('\n'));
  git(root, ['add', '.']);
  git(root, ['commit', '-qm', 'fixture']);
  const head = git(root, ['rev-parse', 'HEAD']);
  waveControl.initialize(root, 'test');
  waveControl.transition(root, 'test', 'EXECUTE', { expectedRevision: 0 });
  const preverify = waveControl.preverify(root, 'test', { expectedRevision: 1 });
  waveControl.transition(root, 'test', 'VERIFY_FINAL', {
    expectedRevision: 1, rebindHead: true, preverifyReceipt: preverify.path,
  });
  waveControl.transition(root, 'test', 'QG', { expectedRevision: 2 });
  fs.writeFileSync(path.join(root, '.androidcommondoc', 'pre-pr.stamp'), `${JSON.stringify({
    verdict: 'PASS', timestamp: new Date().toISOString(), head,
  })}\n`);
  return { root, head };
}

function mint(root, qgAttemptPath) {
  const receipt = qgAttemptPath || waveControl.qgAttempt(root, 'test', 'PASS', { expectedRevision: 3 }).path;
  return spawnSync(process.execPath, [SCRIPT, root, 'mint', '--slug', 'test', '--qg-attempt', receipt], {
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
  const attempt = waveControl.qgAttempt(root, 'test', 'PASS', { expectedRevision: 3 });
  git(root, ['update-index', '--assume-unchanged', '.planning/wave-test/PLAN.md', '.planning/wave-test/CLASS']);
  fs.rmSync(path.join(root, '.planning'), { recursive: true, force: true });
  fs.symlinkSync(external, path.join(root, '.planning'));

  const result = mint(root, attempt.path);

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
  return spawnSync(process.execPath, [SCRIPT, root, 'pre-pr', '--slug', slug, '--expected-revision', '3', ...args], {
    cwd: root, encoding: 'utf8', env: { ...process.env, ...env },
  });
}

function commitWavePlans(root, slugs, message) {
  for (const slug of slugs) {
    const waveDir = path.join(root, '.planning', `wave-${slug}`);
    fs.mkdirSync(waveDir, { recursive: true });
    fs.writeFileSync(path.join(waveDir, 'PLAN.md'), '### Wave Class\n\n- **Class**: FAST-PATH\n\n### Path-Manifest\n\n- tracked.txt\n');
    fs.writeFileSync(path.join(waveDir, 'CLASS'), 'FAST-PATH\n');
    git(root, ['add', '-f', path.relative(root, path.join(waveDir, 'PLAN.md')), path.relative(root, path.join(waveDir, 'CLASS'))]);
  }
  git(root, ['commit', '-qm', message]);
}

function promoteWaveStateToQG(root, slug) {
  waveControl.initialize(root, slug);
  waveControl.transition(root, slug, 'EXECUTE', { expectedRevision: 0 });
  const preverify = waveControl.preverify(root, slug, { expectedRevision: 1 });
  waveControl.transition(root, slug, 'VERIFY_FINAL', {
    expectedRevision: 1,
    rebindHead: true,
    preverifyReceipt: preverify.path,
  });
  waveControl.transition(root, slug, 'QG', { expectedRevision: 2 });
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
  assert.doesNotMatch(canonical, /CLAUDE_WAVE_SLUG="\$wave_slug"/,
    'quality-gater must not recreate ambient wave-slug authority');
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
  const attemptPath = result.stdout.trim().split(/\s+/)[2];
  assert.equal(mint(root, attemptPath).status, 0, 'the produced stamp and immutable attempt are exactly what mint requires');
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
    if (!dirty) {
      const attemptPath = result.stdout.trim().split(/\s+/)[2];
      assert.notEqual(mint(root, attemptPath).status, 0, label + ': mint refuses a FAIL attempt');
    }
  }
});

test('pre-pr needs the project gate outcome and a wave in phase QG at the current HEAD', (t) => {
  const { root } = qgFixtureWithoutStamp();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const env = { TRUFFLEHOG_BIN: scannerStub(t) };
  assert.match(prePr(root, 'test', [], env).stderr, /project-gate-required/);
  assert.match(prePr(root, 'test', ['--project-gate', 'maybe'], env).stderr, /project-gate-required/);
  const statePath = path.join(root, '.androidcommondoc', 'wave-control', 'test.json');
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  state.phase = 'EXECUTE';
  fs.writeFileSync(statePath, JSON.stringify(state));
  assert.match(prePr(root, 'test', ['--project-gate', 'PASS'], env).stderr, /wave-state-not-current/);
  assert.equal(fs.existsSync(path.join(root, '.androidcommondoc', 'pre-pr.stamp')), false, 'no stamp when the preconditions fail');
});

test('a prior cycle push proof remains on disk but cannot verify in the next epoch', (t) => {
  const { root, head } = qgFixtureWithoutStamp();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const env = { TRUFFLEHOG_BIN: scannerStub(t) };
  const passed = prePr(root, 'test', ['--project-gate', 'PASS'], env);
  assert.equal(passed.status, 0, passed.stderr);
  const passAttempt = passed.stdout.trim().split(/\s+/)[2];
  assert.equal(mint(root, passAttempt).status, 0);
  const oldProof = fs.readFileSync(path.join(root, '.androidcommondoc', 'push-proof.json'));

  const failed = waveControl.qgAttempt(root, 'test', 'FAIL', { expectedRevision: 3, checks: { retry: 'FAIL' } });
  waveControl.rework(root, 'test', { expectedRevision: 3, failReceipt: failed.path });
  const preverify = waveControl.preverify(root, 'test', { expectedRevision: 4 });
  waveControl.transition(root, 'test', 'VERIFY_FINAL', {
    expectedRevision: 4, rebindHead: true, preverifyReceipt: preverify.path,
  });
  waveControl.transition(root, 'test', 'QG', { expectedRevision: 5 });

  assert.deepEqual(fs.readFileSync(path.join(root, '.androidcommondoc', 'push-proof.json')), oldProof,
    'the prior proof remains immutable audit evidence');
  const verify = spawnSync(process.execPath, [SCRIPT, root, 'verify', '--slug', 'test', '--head', head], {
    cwd: root, encoding: 'utf8',
  });
  assert.notEqual(verify.status, 0);
  assert.match(verify.stderr, /push-proof-not-current/);
});
