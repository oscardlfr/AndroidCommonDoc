'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const test = require('node:test');
const control = require('../lib/wave-control-plane.cjs');

function fixture({ architects = '[]' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wave-rework-'));
  fs.mkdirSync(path.join(root, '.planning', 'wave-demo'), { recursive: true });
  fs.mkdirSync(path.join(root, '.claude', 'registry'), { recursive: true });
  fs.writeFileSync(path.join(root, '.planning', 'wave-demo', 'PLAN.md'), '## Wave Class\n\n- **Class**: FAST-PATH\n');
  fs.writeFileSync(path.join(root, '.planning', 'wave-demo', 'CLASS'), 'FAST-PATH\n');
  fs.writeFileSync(path.join(root, '.claude', 'registry', 'wave-topology.yaml'), [
    'class_artifacts:',
    '  FAST-PATH:',
    `    architects: ${architects}`,
    '    lifecycle_roles: []',
    '    execution_mode: disk-only',
    '',
  ].join('\n'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: root });
  execFileSync('git', ['commit', '--allow-empty', '-qm', 'fixture base'], { cwd: root });
  return root;
}

function publishVerdict(root, phase, preverifyReceipt = null) {
  const scripts = path.resolve(__dirname, '..', 'sh');
  const requestLine = execFileSync('bash', [path.join(scripts, 'write-verdict-request.sh'),
    '--role', 'arch-platform', '--phase', phase, '--slug', 'demo'], { cwd: root, encoding: 'utf8' }).trim();
  const split = requestLine.lastIndexOf(' ');
  const requestPath = requestLine.slice(0, split);
  const requestDigest = requestLine.slice(split + 1);
  const args = [path.join(scripts, 'write-verdict.sh'), '--role', 'arch-platform', '--phase', phase,
    '--slug', 'demo', '--request', requestPath, '--request-sha256', requestDigest, '--decision', 'approve'];
  if (phase === 'verify-final') {
    args.push('--evidence-text', 'current cycle verified', '--evidence-file', preverifyReceipt);
  }
  execFileSync('bash', args, { cwd: root, input: 'approved\n', encoding: 'utf8' });
  return path.join(root, '.planning', 'wave-demo', `arch-platform-verdict-${phase}.json`);
}

function advance(root, to, options = {}) {
  const revision = control.readState(root, 'demo').revision;
  return control.transition(root, 'demo', to, { ...options, expectedRevision: revision });
}

function reachQG(root) {
  control.initialize(root, 'demo');
  advance(root, 'EXECUTE');
  const revision = control.readState(root, 'demo').revision;
  const receipt = control.preverify(root, 'demo', { expectedRevision: revision });
  advance(root, 'VERIFY_FINAL', { rebindHead: true, preverifyReceipt: receipt.path });
  advance(root, 'QG');
  return control.readState(root, 'demo');
}

function failAndRework(root) {
  const before = control.readState(root, 'demo');
  const receipt = control.qgAttempt(root, 'demo', 'FAIL', {
    expectedRevision: before.revision,
    checks: { project_gate: 'FAIL' },
  });
  return { receipt, state: control.rework(root, 'demo', {
    expectedRevision: before.revision,
    failReceipt: receipt.path,
  }) };
}

test('v2 initializes epoch/cycle and migrates an untouched v1 state atomically', () => {
  const root = fixture();
  try {
    const state = control.initialize(root, 'demo');
    assert.equal(state.schema, 'wave-phase-state/v2');
    assert.equal(state.cycle, 0);
    assert.equal(state.verification_epoch, 0);
    const statePath = path.join(root, '.androidcommondoc', 'wave-control', 'demo.json');
    const legacy = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    legacy.schema = 'wave-phase-state/v1';
    delete legacy.cycle;
    delete legacy.verification_epoch;
    fs.writeFileSync(statePath, `${JSON.stringify(legacy, null, 2)}\n`);
    const migrated = control.readState(root, 'demo');
    assert.equal(migrated.schema, 'wave-phase-state/v2');
    assert.equal(migrated.cycle, 0);
    assert.equal(migrated.verification_epoch, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('all mutations use revision CAS and stale writers leave state byte-identical', () => {
  const root = fixture();
  try {
    control.initialize(root, 'demo');
    const statePath = path.join(root, '.androidcommondoc', 'wave-control', 'demo.json');
    const before = fs.readFileSync(statePath);
    assert.throws(() => control.transition(root, 'demo', 'EXECUTE'), /EXPECTED_REVISION_REQUIRED/);
    assert.throws(() => control.transition(root, 'demo', 'EXECUTE', { expectedRevision: 1 }), /PHASE_STATE_CAS_MISMATCH/);
    assert.deepEqual(fs.readFileSync(statePath), before);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('EXECUTE to VERIFY_FINAL requires a current preverify receipt and clean tracked tree', () => {
  const root = fixture();
  try {
    control.initialize(root, 'demo');
    advance(root, 'EXECUTE');
    const revision = control.readState(root, 'demo').revision;
    assert.throws(() => advance(root, 'VERIFY_FINAL', { rebindHead: true }), /PHASE_STATE_ANCESTRY_MISSING|PREVERIFY_RECEIPT_INVALID/);
    fs.writeFileSync(path.join(root, 'dirty.txt'), 'dirty');
    execFileSync('git', ['add', 'dirty.txt'], { cwd: root });
    assert.throws(() => control.preverify(root, 'demo', { expectedRevision: revision }), /PREVERIFY_TRACKED_TREE_DIRTY/);
    execFileSync('git', ['reset', '-q', 'HEAD', '--', 'dirty.txt'], { cwd: root });
    fs.rmSync(path.join(root, 'dirty.txt'));
    const receipt = control.preverify(root, 'demo', { expectedRevision: revision });
    assert.deepEqual(control.preverify(root, 'demo', { expectedRevision: revision }), receipt,
      'a caller that lost the first response recovers the same immutable receipt');
    const final = advance(root, 'VERIFY_FINAL', { rebindHead: true, preverifyReceipt: receipt.path });
    assert.equal(final.phase, 'VERIFY_FINAL');
    assert.equal(final.transitions.at(-1).evidence.at(-1).kind, 'preverify');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('FAIL receipt is immutable, fully bound, consumed once, and preserves prior evidence as inert history', () => {
  const root = fixture();
  try {
    const qg = reachQG(root);
    const attempt = control.qgAttempt(root, 'demo', 'FAIL', {
      expectedRevision: qg.revision, checks: { unit: 'FAIL' },
    });
    const attemptPath = path.join(root, attempt.path);
    assert.throws(() => fs.writeFileSync(attemptPath, 'overwrite', { flag: 'wx' }), /EEXIST/);
    for (const relative of ['.androidcommondoc/pre-pr.stamp', '.androidcommondoc/quality-gate.stamp',
      '.androidcommondoc/push-proof.json', '.planning/wave-demo/qg-result.json',
      '.planning/wave-demo/arch-platform-verdict-verify-final.json']) {
      const target = path.join(root, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, '{}\n');
    }
    const state = control.rework(root, 'demo', { expectedRevision: qg.revision, failReceipt: attempt.path });
    assert.equal(state.phase, 'EXECUTE');
    assert.equal(state.cycle, 1);
    assert.equal(state.verification_epoch, 1);
    assert.equal(state.revision, qg.revision + 1);
    assert.equal(state.transitions.at(-1).kind, 'rework');
    assert.throws(() => control.rework(root, 'demo', {
      expectedRevision: state.revision, failReceipt: attempt.path,
    }), /REWORK_OUTSIDE_QG/);
    assert.equal(fs.existsSync(path.join(root, '.androidcommondoc', 'push-proof.json')), true);
    assert.equal(fs.existsSync(path.join(root, '.planning', 'wave-demo', 'arch-platform-verdict-verify-final.json')), true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('tampered or cross-cycle FAIL receipts are rejected without changing state', () => {
  const root = fixture();
  try {
    const qg = reachQG(root);
    const attempt = control.qgAttempt(root, 'demo', 'FAIL', { expectedRevision: qg.revision, checks: { gate: 'FAIL' } });
    const attemptPath = path.join(root, attempt.path);
    const original = fs.readFileSync(attemptPath);
    const copiedPath = path.join(path.dirname(attemptPath), 'copied.json');
    fs.writeFileSync(copiedPath, original);
    assert.throws(() => control.rework(root, 'demo', {
      expectedRevision: qg.revision, failReceipt: path.relative(root, copiedPath),
    }), /QG_FAIL_RECEIPT_INVALID:path/);
    fs.rmSync(copiedPath);
    const tampered = JSON.parse(original);
    tampered.head = 'f'.repeat(40);
    fs.writeFileSync(attemptPath, `${JSON.stringify(tampered, null, 2)}\n`);
    const statePath = path.join(root, '.androidcommondoc', 'wave-control', 'demo.json');
    const before = fs.readFileSync(statePath);
    assert.throws(() => control.rework(root, 'demo', {
      expectedRevision: qg.revision, failReceipt: attempt.path,
    }), /QG_FAIL_RECEIPT_INVALID:head/);
    assert.deepEqual(fs.readFileSync(statePath), before);
    fs.writeFileSync(attemptPath, original);
    const moved = failAndRework(root).state;
    const stale = path.relative(root, attemptPath);
    assert.throws(() => control.rework(root, 'demo', {
      expectedRevision: moved.revision, failReceipt: stale,
    }), /REWORK_OUTSIDE_QG/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('rework is capped at three cycles and every cycle gets a fresh epoch', () => {
  const root = fixture();
  try {
    reachQG(root);
    for (let cycle = 1; cycle <= 3; cycle += 1) {
      const { state } = failAndRework(root);
      assert.equal(state.cycle, cycle);
      assert.equal(state.verification_epoch, cycle);
      const receipt = control.preverify(root, 'demo', { expectedRevision: state.revision });
      advance(root, 'VERIFY_FINAL', { rebindHead: true, preverifyReceipt: receipt.path });
      advance(root, 'QG');
    }
    const qg = control.readState(root, 'demo');
    const attempt = control.qgAttempt(root, 'demo', 'FAIL', { expectedRevision: qg.revision });
    assert.throws(() => control.rework(root, 'demo', {
      expectedRevision: qg.revision, failReceipt: attempt.path,
    }), /REWORK_CYCLE_LIMIT/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('PASS attempt is required for COMPLETE and cannot be substituted by a FAIL attempt', () => {
  const root = fixture();
  try {
    const qg = reachQG(root);
    const failed = control.qgAttempt(root, 'demo', 'FAIL', { expectedRevision: qg.revision });
    assert.throws(() => advance(root, 'COMPLETE', { qgAttempt: failed.path }), /QG_PASS_RECEIPT_INVALID:verdict/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a VERIFY_FINAL verdict from an earlier epoch is preserved but cannot authorize the next cycle', () => {
  const root = fixture({ architects: '[arch-platform]' });
  try {
    control.initialize(root, 'demo');
    const prep = publishVerdict(root, 'prep');
    control.transition(root, 'demo', 'EXECUTE', {
      expectedRevision: 0, verdicts: [{ role: 'arch-platform', path: prep }],
    });
    const firstPreverify = control.preverify(root, 'demo', { expectedRevision: 1 });
    control.transition(root, 'demo', 'VERIFY_FINAL', {
      expectedRevision: 1, rebindHead: true, preverifyReceipt: firstPreverify.path,
    });
    const oldVerdict = publishVerdict(root, 'verify-final', path.join(root, firstPreverify.path));
    const verdictBody = JSON.parse(fs.readFileSync(oldVerdict, 'utf8'));
    const receiptDigest = require('node:crypto').createHash('sha256')
      .update(fs.readFileSync(path.join(root, firstPreverify.path))).digest('hex');
    assert.ok(verdictBody.evidence.some((entry) => entry.path.includes('/preverify/') && entry.sha256 === receiptDigest),
      JSON.stringify(verdictBody.evidence));
    control.transition(root, 'demo', 'QG', {
      expectedRevision: 2, verdicts: [{ role: 'arch-platform', path: oldVerdict }],
    });
    const failed = control.qgAttempt(root, 'demo', 'FAIL', { expectedRevision: 3 });
    control.rework(root, 'demo', { expectedRevision: 3, failReceipt: failed.path });
    const secondPreverify = control.preverify(root, 'demo', { expectedRevision: 4 });
    control.transition(root, 'demo', 'VERIFY_FINAL', {
      expectedRevision: 4, rebindHead: true, preverifyReceipt: secondPreverify.path,
    });
    assert.equal(fs.existsSync(oldVerdict), true, 'the old verdict remains available as audit history');
    assert.throws(() => control.transition(root, 'demo', 'QG', {
      expectedRevision: 5, verdicts: [{ role: 'arch-platform', path: oldVerdict }],
    }), /VERDICT_NOT_AUTHORIZING:arch-platform:preverify-binding/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the public CLI exposes explicit rework with revision CAS and the exact FAIL receipt', () => {
  const root = fixture();
  try {
    const qg = reachQG(root);
    const failed = control.qgAttempt(root, 'demo', 'FAIL', { expectedRevision: qg.revision });
    const cli = path.resolve(__dirname, '..', 'tools', 'wave-control-plane.cjs');
    const stale = spawnSync(process.execPath, [cli, 'rework', '--root', root, '--slug', 'demo',
      '--expected-revision', String(qg.revision + 1), '--fail-receipt', failed.path], { encoding: 'utf8' });
    assert.equal(stale.status, 2);
    assert.match(JSON.parse(stale.stdout).reason, /PHASE_STATE_CAS_MISMATCH/);
    const accepted = spawnSync(process.execPath, [cli, 'rework', '--root', root, '--slug', 'demo',
      '--expected-revision', String(qg.revision), '--fail-receipt', failed.path], { encoding: 'utf8' });
    assert.equal(accepted.status, 0, accepted.stdout + accepted.stderr);
    assert.deepEqual({ phase: JSON.parse(accepted.stdout).phase, cycle: JSON.parse(accepted.stdout).cycle },
      { phase: 'EXECUTE', cycle: 1 });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
