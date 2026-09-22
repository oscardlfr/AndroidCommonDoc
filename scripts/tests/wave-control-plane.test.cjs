'use strict';
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const test = require('node:test');
const control = require('../lib/wave-control-plane.cjs');
const entrypoints = require('../lib/runtime-collaboration-entrypoints.cjs');

function fixture({ className = 'FAST-PATH', architects = '[]', lifecycleRoles = '[]', executionMode = 'disk-only', required = '' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wave-control-'));
  fs.mkdirSync(path.join(root, '.planning', 'wave-demo'), { recursive: true });
  fs.mkdirSync(path.join(root, '.claude', 'registry'), { recursive: true });
  fs.mkdirSync(path.join(root, 'mcp-server', 'node_modules'), { recursive: true });
  fs.symlinkSync(path.resolve(__dirname, '../../mcp-server/node_modules/yaml'), path.join(root, 'mcp-server', 'node_modules', 'yaml'), 'junction');
  fs.writeFileSync(path.join(root, '.planning', 'wave-demo', 'PLAN.md'), `### Wave Class\n\n**Class**: ${className}\n${required}`);
  fs.writeFileSync(path.join(root, '.claude', 'registry', 'wave-topology.yaml'), `default_class: HARNESS\nclass_artifacts:\n  ${className}:\n    architects: ${architects}\n    lifecycle_roles: ${lifecycleRoles}\n    execution_mode: ${executionMode}\n`);
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: root });
  return root;
}

test('initialization is idempotent and bound to PLAN and HEAD', () => {
  const root = fixture();
  try {
    const a = control.initialize(root, 'demo');
    const b = control.initialize(root, 'demo');
    assert.strictEqual(a.phase, 'PREP');
    assert.strictEqual(a.execution_mode, 'disk-only');
    assert.strictEqual(a.plan_sha256, b.plan_sha256);
    assert.deepStrictEqual(a.required_roles, []);
    assert.deepStrictEqual(a.lifecycle_roles, []);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('legal transitions advance exactly one phase and illegal transitions fail closed', () => {
  const root = fixture();
  try {
    control.initialize(root, 'demo');
    assert.strictEqual(control.transition(root, 'demo', 'EXECUTE').phase, 'EXECUTE');
    assert.throws(() => control.transition(root, 'demo', 'QG'), /ILLEGAL_PHASE_TRANSITION/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a transition records one atomic timestamp so persisted state never invalidates itself across a clock tick', () => {
  const root = fixture();
  const NativeDate = global.Date;
  let milliseconds;
  try {
    const initialized = control.initialize(root, 'demo');
    milliseconds = Date.parse(initialized.created_at) + 1000;
    global.Date = class AdvancingDate extends NativeDate {
      constructor(...args) {
        if (args.length) super(...args);
        else { super(milliseconds); milliseconds += 1000; }
      }
      static now() { return milliseconds; }
      static parse(value) { return NativeDate.parse(value); }
    };
    const transitioned = control.transition(root, 'demo', 'EXECUTE');
    assert.strictEqual(transitioned.updated_at, transitioned.transitions[0].at);
    assert.doesNotThrow(() => control.readState(root, 'demo'));
  } finally {
    global.Date = NativeDate;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('PLAN drift invalidates persisted state', () => {
  const root = fixture();
  try {
    control.initialize(root, 'demo');
    fs.appendFileSync(path.join(root, '.planning', 'wave-demo', 'PLAN.md'), '\nchanged\n');
    assert.strictEqual(control.status(root, 'demo').current, false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('lifecycle actions use only the shipped Wave-1 CLI operations and carry class mode', () => {
  const root = fixture({ className: 'HARNESS', architects: '[]', lifecycleRoles: '[arch-platform, arch-testing, context-provider]', executionMode: 'persistent' });
  try {
    control.initialize(root, 'demo');
    assert.deepStrictEqual(control.lifecycleActions(root, 'demo').map(({ operation, role, mode }) => ({ operation, role, mode })), [
      { operation: 'ensure', role: 'arch-platform', mode: 'persistent' },
      { operation: 'ensure', role: 'arch-testing', mode: 'persistent' },
      { operation: 'ensure', role: 'context-provider', mode: 'persistent' },
    ]);
    control.transition(root, 'demo', 'EXECUTE');
    assert.deepStrictEqual(control.lifecycleActions(root, 'demo').map(({ operation, role, mode }) => ({ operation, role, mode })), [
      { operation: 'status', role: 'arch-platform', mode: 'persistent' },
      { operation: 'status', role: 'arch-testing', mode: 'persistent' },
      { operation: 'status', role: 'context-provider', mode: 'persistent' },
    ]);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('declared roles reject duplicates and non-architect role names', () => {
  for (const required of ['**Required-Architects**: arch-testing, arch-testing\n', '**Required-Architects**: toolkit-specialist\n']) {
    const root = fixture({ className: 'DOC', architects: 'declared', lifecycleRoles: '[context-provider, doc-updater]', executionMode: 'ephemeral', required });
    try { assert.throws(() => control.initialize(root, 'demo'), /INVALID_TOPOLOGY_ROLES/); }
    finally { fs.rmSync(root, { recursive: true, force: true }); }
  }
});

test('lifecycle roles reject duplicates and invalid names independently of verdict roles', () => {
  for (const lifecycleRoles of ['[context-provider, context-provider]', '[Bad Role]']) {
    const root = fixture({ className: 'HARNESS', architects: '[arch-platform]', lifecycleRoles, executionMode: 'persistent' });
    try { assert.throws(() => control.initialize(root, 'demo'), /INVALID_LIFECYCLE_ROLES/); }
    finally { fs.rmSync(root, { recursive: true, force: true }); }
  }
});

test('canonical runtime entrypoint derives init-session role scope from wave state', () => {
  const root = fixture({
    className: 'HARNESS',
    architects: '[arch-platform, arch-testing]',
    lifecycleRoles: '[context-provider, doc-updater]',
    executionMode: 'persistent',
  });
  try {
    const plan = entrypoints.planEntrypointStep('init-session', { mode: 'start', wave_slug: 'demo' }, root);
    assert.deepStrictEqual(plan.role_scope, ['context-provider', 'doc-updater']);
    assert.deepStrictEqual(control.status(root, 'demo').lifecycle_roles, ['context-provider', 'doc-updater']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('runtime entrypoint rejects an active wave whose persisted inputs drifted', () => {
  const root = fixture({ lifecycleRoles: '[]' });
  try {
    control.initialize(root, 'demo');
    fs.appendFileSync(path.join(root, '.planning', 'wave-demo', 'PLAN.md'), '\ndrift\n');
    assert.throws(() => entrypoints.planEntrypointStep('resume-work', {
      checkpoint_ref: `checkpoint:${'a'.repeat(64)}`,
      wave_slug: 'demo',
    }, root), /wave-control-plan-drift/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('work is EXECUTE-only and permits HEAD movement until the explicit final-HEAD rebind', () => {
  const root = fixture({ lifecycleRoles: '[]' });
  const intent = {
    role: 'toolkit-specialist',
    subject_ref: `subject:${'a'.repeat(64)}`,
    task: 'bounded task',
    wave_slug: 'demo',
  };
  try {
    control.initialize(root, 'demo');
    assert.throws(() => entrypoints.planEntrypointStep('work', intent, root), /wave-control-work-outside-execute/);
    control.transition(root, 'demo', 'EXECUTE');
    fs.writeFileSync(path.join(root, 'execution-change.txt'), 'change');
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', ['commit', '-qm', 'execution change'], { cwd: root });
    const status = control.status(root, 'demo');
    assert.strictEqual(status.plan_current, true);
    assert.strictEqual(status.head_current, false);
    assert.doesNotThrow(() => entrypoints.planEntrypointStep('work', intent, root));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('persisted state rejects unknown keys and a forged transition chain', () => {
  const root = fixture();
  try {
    control.initialize(root, 'demo');
    const statePath = path.join(root, '.androidcommondoc', 'wave-control', 'demo.json');
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    fs.writeFileSync(statePath, JSON.stringify({ ...state, injected: true }));
    assert.throws(() => control.status(root, 'demo'), /INVALID_PHASE_STATE/);
    delete state.injected;
    state.phase = 'EXECUTE';
    state.revision = 1;
    state.transitions = [{ from: 'VERIFY_FINAL', to: 'QG', at: state.updated_at,
      from_head: state.head, to_head: state.head, evidence: [] }];
    fs.writeFileSync(statePath, JSON.stringify(state));
    assert.throws(() => control.status(root, 'demo'), /INVALID_PHASE_STATE/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('state initialization rejects a symlinked control-plane ancestry', () => {
  const root = fixture();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'wave-control-outside-'));
  try {
    fs.symlinkSync(outside, path.join(root, '.androidcommondoc'), 'junction');
    assert.throws(() => control.initialize(root, 'demo'), /PHASE_STATE_ANCESTRY_UNSAFE/);
  } finally {
    fs.rmSync(path.join(root, '.androidcommondoc'), { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});
