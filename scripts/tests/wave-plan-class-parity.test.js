'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { execFileSync, spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '../..');
const CLI = path.join(ROOT, 'scripts', 'tools', 'wave-plan-class.cjs');
const AUDIT = path.join(ROOT, 'scripts', 'sh', 'qg-path-audit.sh');
const CORPUS = require('./fixtures/wave-plan-class-corpus.json');
const contract = require('../lib/wave-plan-class.cjs');
const waveControl = require('../lib/wave-control-plane.cjs');

function makeAuditFixture(plan, sentinel) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wave-class-parity-')));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'wave-class@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Wave Class'], { cwd: root });
  execFileSync('git', ['commit', '--allow-empty', '-qm', 'base'], { cwd: root });
  const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const waveDir = path.join(root, '.planning', 'wave-corpus');
  fs.mkdirSync(waveDir, { recursive: true });
  fs.writeFileSync(path.join(waveDir, 'CLASS'), `${sentinel}\n`);
  fs.writeFileSync(path.join(waveDir, 'PLAN.md'), `${plan}\n### Path-Manifest\n\n- docs/example.md\n`);
  return { root, waveDir, base };
}

for (const entry of CORPUS) {
  test(`Wave Class grammar parity: ${entry.name}`, (t) => {
    let moduleResult;
    try { moduleResult = { className: contract.parsePlanClass(entry.plan) }; }
    catch (error) { moduleResult = { error: error.message }; }

    let controlResult;
    try { controlResult = { className: waveControl.parsePlanClass(entry.plan) }; }
    catch (error) { controlResult = { error: error.message }; }
    assert.deepEqual(controlResult, moduleResult, 'control plane delegates to the canonical parser');

    const planFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wave-class-cli-')), 'PLAN.md');
    t.after(() => fs.rmSync(path.dirname(planFile), { recursive: true, force: true }));
    fs.writeFileSync(planFile, entry.plan);
    const cli = spawnSync(process.execPath, [CLI, '--plan', planFile], { encoding: 'utf8' });

    const fixture = makeAuditFixture(entry.plan, entry.class || 'HARNESS');
    t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
    const audit = spawnSync('bash', [AUDIT, '--wave-dir', fixture.waveDir,
      '--plan', path.join(fixture.waveDir, 'PLAN.md'), '--base', fixture.base], {
      cwd: fixture.root, encoding: 'utf8',
    });

    if (entry.class) {
      assert.deepEqual(moduleResult, { className: entry.class });
      assert.equal(cli.status, 0, cli.stderr);
      assert.equal(cli.stdout.trim(), entry.class);
      assert.equal(audit.status, 0, audit.stderr || audit.stdout);
    } else {
      assert.deepEqual(moduleResult, { error: entry.error });
      assert.equal(cli.status, 2, cli.stderr);
      assert.match(cli.stderr, new RegExp(`${entry.error}$`, 'm'));
      assert.equal(audit.status, 2, audit.stderr || audit.stdout);
      assert.match(audit.stderr, new RegExp(entry.error));
    }
  });
}

test('Wave Class CLI fails closed for a symlinked PLAN', {
  skip: process.platform === 'win32' ? 'symlink creation is privilege-dependent on Windows' : false,
}, (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wave-class-symlink-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const target = path.join(dir, 'target.md');
  const link = path.join(dir, 'PLAN.md');
  fs.writeFileSync(target, '### Wave Class\n- **Class**: HARNESS\n');
  fs.symlinkSync(target, link);
  const result = spawnSync(process.execPath, [CLI, '--plan', link], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /PLAN_FILE_UNREADABLE|PLAN_FILE_UNSAFE/);
});

test('Wave Class adapters fail closed on invalid UTF-8 bytes', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wave-class-encoding-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const plan = path.join(dir, 'PLAN.md');
  fs.writeFileSync(plan, Buffer.from([0x23, 0x23, 0x20, 0xff, 0x0a]));
  assert.throws(() => contract.decodePlanBytes(fs.readFileSync(plan)), /PLAN_TEXT_ENCODING_INVALID/);
  const result = spawnSync(process.execPath, [CLI, '--plan', plan], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /PLAN_TEXT_ENCODING_INVALID/);
});
