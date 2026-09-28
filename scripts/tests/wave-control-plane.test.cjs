'use strict';
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const test = require('node:test');
const control = require('../lib/wave-control-plane.cjs');
const entrypoints = require('../lib/runtime-collaboration-entrypoints.cjs');

function fixture({ className = 'FAST-PATH', architects = '[]', lifecycleRoles = '[]', executionMode = 'disk-only', required = '' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wave-control-'));
  fs.mkdirSync(path.join(root, '.planning', 'wave-demo'), { recursive: true });
  fs.mkdirSync(path.join(root, '.claude', 'registry'), { recursive: true });
  fs.writeFileSync(path.join(root, '.planning', 'wave-demo', 'PLAN.md'), `### Wave Class\n\n**Class**: ${className}\n${required}`);
  fs.writeFileSync(path.join(root, '.planning', 'wave-demo', 'CLASS'), `${className}\n`);
  fs.writeFileSync(path.join(root, '.claude', 'registry', 'wave-topology.yaml'), `default_class: HARNESS\nclass_artifacts:\n  ${className}:\n    architects: ${architects}\n    lifecycle_roles: ${lifecycleRoles}\n    execution_mode: ${executionMode}\n`);
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: root });
  return root;
}

function writeRuntimeManifest(root, layer) {
  fs.writeFileSync(path.join(root, 'l0-manifest.json'), JSON.stringify({
    version: 2,
    sources: [{ layer: 'L0', role: 'tooling', path: path.relative(root, path.resolve(__dirname, '../..')) }],
    runtime: {
      schema: 'runtime-consumer/v1', enabled: true, consumer_layer: layer,
      toolkit_commit: 'a'.repeat(40), toolkit_content_sha256: 'b'.repeat(64),
    },
  }));
}

function publishPrepApproval(root, role = 'arch-platform') {
  const scriptsRoot = path.resolve(__dirname, '..');
  const requestLine = execFileSync('bash', [path.join(scriptsRoot, 'sh', 'write-verdict-request.sh'),
    '--role', role, '--phase', 'prep', '--slug', 'demo'], { cwd: root, encoding: 'utf8' }).trim();
  const [requestPath, requestDigest] = requestLine.split(/\s+/);
  execFileSync('bash', [path.join(scriptsRoot, 'sh', 'write-verdict.sh'),
    '--role', role, '--phase', 'prep', '--slug', 'demo',
    '--request', requestPath, '--request-sha256', requestDigest, '--decision', 'approve'],
  { cwd: root, input: 'fixture PREP approval\n', encoding: 'utf8' });
  return path.join(root, '.planning', 'wave-demo', `${role}-verdict-prep.json`);
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

test('an enabled L1 runtime manifest wins over local L0-shaped registry and MCP markers for QG proof routing', () => {
  const root = fixture();
  try {
    fs.mkdirSync(path.join(root, 'skills'), { recursive: true });
    fs.writeFileSync(path.join(root, 'skills', 'registry.json'), '{}\n');
    fs.mkdirSync(path.join(root, 'mcp-server'), { recursive: true });
    fs.writeFileSync(path.join(root, 'mcp-server', 'package.json'), '{}\n');
    writeRuntimeManifest(root, 'L1');

    const invocation = control.qualityGateProofInvocation(root, 'demo', 'c'.repeat(40));
    assert.strictEqual(invocation.executable, process.execPath);
    assert.strictEqual(path.basename(invocation.args[0]), 'runtime-consumer-quality-gate.cjs');
    assert.deepStrictEqual(invocation.args.slice(1), [root, 'verify', '--slug', 'demo', '--head', 'c'.repeat(40)]);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('L0 QG proof routing selects the native PowerShell verifier on Windows', () => {
  const toolkitRoot = path.resolve(__dirname, '../..');
  const invocation = control.qualityGateProofInvocation(toolkitRoot, 'demo', 'd'.repeat(40), 'win32');
  assert.strictEqual(invocation.executable, 'pwsh.exe');
  assert.deepStrictEqual(invocation.args.slice(0, 4), ['-NoLogo', '-NoProfile', '-NonInteractive', '-File']);
  assert.strictEqual(path.basename(invocation.args[4]), 'verify-push-proof.ps1');
  assert.deepStrictEqual(invocation.args.slice(5), ['-PushedSha', 'd'.repeat(40), '-RepoRoot', toolkitRoot]);
});

test('a PREP transition with a real authorizing verdict persists a readable approve decision', () => {
  const root = fixture({ className: 'HARNESS', architects: '[arch-platform]', lifecycleRoles: '[]' });
  try {
    control.initialize(root, 'demo');
    const verdictPath = publishPrepApproval(root);
    assert.strictEqual(fs.existsSync(path.join(root, 'scripts', 'lib')), false);
    const transitioned = control.transition(root, 'demo', 'EXECUTE', {
      verdicts: [{ role: 'arch-platform', path: verdictPath }],
    });
    assert.strictEqual(transitioned.transitions[0].evidence[0].decision, 'approve');
    assert.strictEqual(control.status(root, 'demo').phase, 'EXECUTE');
    assert.strictEqual(control.status(root, 'demo').current, true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('decisionless legacy state is atomically migrated only after its verdict source revalidates', () => {
  const root = fixture({ className: 'HARNESS', architects: '[arch-platform]', lifecycleRoles: '[]' });
  try {
    control.initialize(root, 'demo');
    const verdictPath = publishPrepApproval(root);
    control.transition(root, 'demo', 'EXECUTE', { verdicts: [{ role: 'arch-platform', path: verdictPath }] });
    const statePath = path.join(root, '.androidcommondoc', 'wave-control', 'demo.json');
    const legacy = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    delete legacy.transitions[0].evidence[0].decision;
    fs.writeFileSync(statePath, JSON.stringify(legacy, null, 2) + '\n');

    const migrated = control.status(root, 'demo');
    assert.strictEqual(migrated.phase, 'EXECUTE');
    assert.strictEqual(migrated.transitions[0].evidence[0].decision, 'approve');
    const persisted = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    assert.strictEqual(persisted.transitions[0].evidence[0].decision, 'approve');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('decisionless legacy state fails closed and remains byte-identical when verdict revalidation fails', () => {
  const root = fixture({ className: 'HARNESS', architects: '[arch-platform]', lifecycleRoles: '[]' });
  try {
    control.initialize(root, 'demo');
    const verdictPath = publishPrepApproval(root);
    control.transition(root, 'demo', 'EXECUTE', { verdicts: [{ role: 'arch-platform', path: verdictPath }] });
    const statePath = path.join(root, '.androidcommondoc', 'wave-control', 'demo.json');
    const legacy = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    delete legacy.transitions[0].evidence[0].decision;
    const legacyBytes = Buffer.from(JSON.stringify(legacy, null, 2) + '\n');
    fs.writeFileSync(statePath, legacyBytes);
    fs.writeFileSync(verdictPath, '{"tampered":true}\n');

    assert.throws(() => control.status(root, 'demo'), /LEGACY_PHASE_STATE_VERDICT_INVALID:arch-platform/);
    assert.deepStrictEqual(fs.readFileSync(statePath), legacyBytes);
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

test('wave class grammar normalizes bounded prose punctuation and backticks without accepting prefixes', () => {
  for (const expected of ['HARNESS', 'DOC', 'FAST-PATH']) {
    for (const rendered of [expected, `${expected}.`, `${expected};`, `\`${expected}\``, `\`${expected}\`.`]) {
      assert.strictEqual(control.parsePlanClass(`### Wave Class\n**Class**: ${rendered}\n`), expected);
      assert.strictEqual(control.parsePlanClass(`## Wave Class\n- **Class**: ${rendered}\n`), expected);
    }
  }
  for (const invalid of ['HARNESS.foo', 'HARNESS-extra', 'UNKNOWN', '`HARNESS.foo`', 'HARNESS trailing']) {
    assert.throws(() => control.parsePlanClass(`### Wave Class\n**Class**: ${invalid}\n`), /INVALID_WAVE_CLASS/);
  }
  assert.throws(() => control.parsePlanClass('### Wave Class\n**Class**: HARNESS\n**Class**: DOC\n'), /PLAN_WAVE_CLASS_AMBIGUOUS/);
});

test('wave class parsing is section-anchored and ignores markers outside the H2/H3 Wave Class section', () => {
  const plan = [
    '### Context',
    '',
    '- **Class**: DOC',
    '',
    '## Wave Class',
    '',
    '- **Class**: HARNESS',
    '',
    '### Example',
    '',
    '**Class**: FAST-PATH',
  ].join('\n');
  assert.strictEqual(control.parsePlanClass(plan), 'HARNESS');
});

test('wave class parsing rejects missing, duplicate, and unsupported declarations deterministically', () => {
  assert.throws(() => control.parsePlanClass('### Context\n- **Class**: HARNESS\n'), /WAVE_CLASS_SECTION_MISSING/);
  assert.throws(() => control.parsePlanClass('### Wave Class\nNo declaration here.\n'), /PLAN_WAVE_CLASS_MISSING/);
  assert.throws(() => control.parsePlanClass('### Wave Class\n- **Class**: HARNESS\n- **Class**: DOC\n'), /PLAN_WAVE_CLASS_AMBIGUOUS/);
  assert.throws(() => control.parsePlanClass('## Wave Class\n- **Class**: UNKNOWN\n'), /INVALID_WAVE_CLASS/);
  assert.throws(() => control.parsePlanClass('## Wave Class\n- **Class**: HARNESS\n\n### Wave Class\n**Class**: HARNESS\n'), /WAVE_CLASS_SECTION_AMBIGUOUS/);
  assert.throws(() => control.parsePlanClass('#### Wave Class\n- **Class**: HARNESS\n'), /WAVE_CLASS_SECTION_MISSING/);
  assert.throws(() => control.parsePlanClass('```markdown\n## Wave Class\n- **Class**: HARNESS\n```\n'), /WAVE_CLASS_SECTION_MISSING/);
  assert.throws(
    () => control.parsePlanClass('```markdown\n```not-a-closing-fence\n## Wave Class\n- **Class**: HARNESS\n```\n'),
    /WAVE_CLASS_SECTION_MISSING/,
  );
});

test('control-plane initialization binds the PLAN class to the mandatory CLASS sentinel', () => {
  const root = fixture({ className: 'HARNESS' });
  const sentinel = path.join(root, '.planning', 'wave-demo', 'CLASS');
  const statePath = path.join(root, '.androidcommondoc', 'wave-control', 'demo.json');
  try {
    fs.writeFileSync(sentinel, 'DOC\n');
    assert.throws(() => control.initialize(root, 'demo'), /WAVE_CLASS_MISMATCH:sentinel=DOC:plan=HARNESS/);
    assert.strictEqual(fs.existsSync(statePath), false);

    fs.rmSync(sentinel);
    assert.throws(() => control.initialize(root, 'demo'), /WAVE_CLASS_SENTINEL_MISSING/);
    assert.strictEqual(fs.existsSync(statePath), false);

    fs.writeFileSync(sentinel, 'HARNESS\nDOC\n');
    assert.throws(() => control.initialize(root, 'demo'), /INVALID_WAVE_CLASS_SENTINEL/);
    assert.strictEqual(fs.existsSync(statePath), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('control-plane initialization accepts the planner canonical H2 bullet form', () => {
  const root = fixture({ className: 'HARNESS' });
  try {
    fs.writeFileSync(
      path.join(root, '.planning', 'wave-demo', 'PLAN.md'),
      '## Wave Class\n\n- **Class**: HARNESS\n',
    );
    const state = control.initialize(root, 'demo');
    assert.strictEqual(state.wave_class, 'HARNESS');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('canonical runtime entrypoint preflights exact wave without mutating state', () => {
  const root = fixture({
    className: 'HARNESS',
    architects: '[arch-platform, arch-testing]',
    lifecycleRoles: '[context-provider, doc-updater]',
    executionMode: 'persistent',
  });
  try {
    const plan = entrypoints.planEntrypointStep('init-session', { mode: 'start', wave_slug: 'demo' }, root);
    assert.deepStrictEqual(plan.role_scope, ['context-provider', 'doc-updater']);
    assert.strictEqual(fs.existsSync(path.join(root, '.androidcommondoc', 'wave-control', 'demo.json')), false);
    assert.strictEqual(control.inspect(root, 'demo').initialized, false);
    assert.deepStrictEqual(entrypoints.plannedEntrypointWaveScope(plan), {
      waveSlug: 'demo',
      planDigest: control.inspect(root, 'demo').plan_sha256,
      worktreeId: require('../lib/runtime-role-lifecycle.cjs').computeWorktreeId(root),
      initializeAfterAdmission: true,
    });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('wave-scoped init-session selects its exact PLAN when sibling waves exist', () => {
  const root = fixture({ lifecycleRoles: '[context-provider, doc-updater]' });
  try {
    const sibling = path.join(root, '.planning', 'wave-sibling');
    fs.mkdirSync(sibling, { recursive: true });
    fs.writeFileSync(path.join(sibling, 'PLAN.md'), '### Wave Class\n**Class**: HARNESS\n');
    const plan = entrypoints.planEntrypointStep('init-session', { mode: 'start', wave_slug: 'demo' }, root);
    const scope = entrypoints.plannedEntrypointWaveScope(plan);
    assert.match(scope.planDigest, /^[0-9a-f]{64}$/);
    assert.strictEqual(require('../lib/runtime-role-lifecycle.cjs').discoverPlan(root).ok, false);
    const selected = require('../lib/runtime-role-lifecycle.cjs').discoverPlan(root, scope.planDigest);
    assert.strictEqual(selected.ok, true);
    assert.strictEqual(selected.planPath, path.join(root, '.planning', 'wave-demo', 'PLAN.md'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('exact wave selection remains unambiguous for byte-identical sibling plans and rejects unsafe targets', () => {
  const root = fixture({ lifecycleRoles: '[context-provider]' });
  try {
    const target = path.join(root, '.planning', 'wave-demo', 'PLAN.md');
    const bytes = fs.readFileSync(target);
    fs.mkdirSync(path.join(root, '.planning', 'wave-copy'), { recursive: true });
    fs.writeFileSync(path.join(root, '.planning', 'wave-copy', 'PLAN.md'), bytes);
    const digest = require('crypto').createHash('sha256').update(bytes).digest('hex');
    const rll = require('../lib/runtime-role-lifecycle.cjs');
    assert.strictEqual(rll.discoverPlan(root, digest).ok, false, 'digest-only lookup remains deliberately ambiguous');
    assert.deepStrictEqual(rll.discoverPlan(root, { waveSlug: 'demo', expectedDigest: digest }), {
      ok: true, planPath: path.join(fs.realpathSync(root), '.planning', 'wave-demo', 'PLAN.md'), planDigest: digest, waveSlug: 'demo',
    });
    const entrypointPlan = entrypoints.planEntrypointStep(
      'init-session', { mode: 'start', wave_slug: 'demo' }, root,
    );
    const scope = entrypoints.plannedEntrypointWaveScope(entrypointPlan);
    const exactGrant = rll.resolveOrMintManagedLifecycleGrant({
      projectRootDescriptor: root,
      sessionId: 'wave-exact-managed-grant',
      subcommand: entrypointPlan.command,
      argvDigest: entrypointPlan.argv_digest,
      role: entrypointPlan.role_scope,
      actionId: null,
      worktreeId: scope.worktreeId,
      planDigest: scope.planDigest,
      waveSlug: scope.waveSlug,
    });
    assert.strictEqual(exactGrant.ok, true,
      'the managed lifecycle grant must preserve the exact wave selector');
    assert.deepStrictEqual(rll.resolveOrMintManagedLifecycleGrant({
      projectRootDescriptor: root,
      sessionId: 'wave-ambiguous-managed-grant',
      subcommand: entrypointPlan.command,
      argvDigest: entrypointPlan.argv_digest,
      role: entrypointPlan.role_scope,
      actionId: null,
      worktreeId: scope.worktreeId,
      planDigest: scope.planDigest,
    }), { ok: false, reason: 'MANAGED_LIFECYCLE_PLAN_INVALID' },
    'digest-only managed lifecycle selection must remain fail-closed when two plans share bytes');
    assert.strictEqual(rll.discoverPlan(root, { waveSlug: '../demo', expectedDigest: digest }).ok, false);
    assert.strictEqual(rll.discoverPlan(root, { waveSlug: 'demo', expectedDigest: '0'.repeat(64) }).ok, false);
    fs.renameSync(target, `${target}.real`);
    fs.symlinkSync(`${target}.real`, target);
    assert.strictEqual(rll.discoverPlan(root, { waveSlug: 'demo', expectedDigest: digest }).ok, false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('wave-scoped work keeps the exact selector when sibling plans are byte-identical', () => {
  const root = fixture({ lifecycleRoles: '[]' });
  try {
    const target = path.join(root, '.planning', 'wave-demo', 'PLAN.md');
    fs.mkdirSync(path.join(root, '.planning', 'wave-copy'), { recursive: true });
    fs.copyFileSync(target, path.join(root, '.planning', 'wave-copy', 'PLAN.md'));
    control.initialize(root, 'demo');
    control.transition(root, 'demo', 'EXECUTE');
    const plan = entrypoints.planEntrypointStep('work', {
      role: 'toolkit-specialist',
      subject_ref: `subject:${'a'.repeat(64)}`,
      task: 'bounded exact-wave task',
      wave_slug: 'demo',
    }, root);
    assert.strictEqual(plan.command, 'root-source',
      'work planning must not fall back to blocked merely because another wave has identical PLAN bytes');
    assert.match(plan.argv_digest, /^[0-9a-f]{64}$/);
    assert.deepStrictEqual(entrypoints.plannedEntrypointWaveScope(plan).waveSlug, 'demo');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('CLI reports typed control-plane ancestry failure instead of usage-invalid', () => {
  const root = fixture();
  try {
    const encoded = Buffer.from(JSON.stringify({ mode: 'start', wave_slug: 'missing-wave' }), 'utf8').toString('base64url');
    const result = spawnSync(process.execPath, [
      path.resolve(__dirname, '../lib/runtime-collaboration-entrypoints.cjs'), 'execute',
      '--entrypoint', 'init-session', '--project-root', root, '--intent', encoded,
    ], { cwd: root, encoding: 'utf8' });
    assert.strictEqual(result.status, 2);
    const envelope = JSON.parse(result.stdout.trim());
    assert.strictEqual(envelope.status, 'FAILED');
    assert.strictEqual(envelope.detail, 'phase-state-ancestry-missing');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('atomic initialization rejects preflight PLAN drift without publishing PREP', () => {
  const root = fixture();
  try {
    const preflight = control.inspect(root, 'demo');
    fs.appendFileSync(path.join(root, '.planning', 'wave-demo', 'PLAN.md'), '\ndrift\n');
    assert.throws(() => control.initialize(root, 'demo', preflight.plan_sha256), /PHASE_STATE_PLAN_DRIFT/);
    assert.strictEqual(fs.existsSync(path.join(root, '.androidcommondoc', 'wave-control', 'demo.json')), false);
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
