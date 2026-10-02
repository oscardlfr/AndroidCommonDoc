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

function advance(root, to, options = {}) {
  return control.transition(root, 'demo', to, { ...options, expectedRevision: control.readState(root, 'demo').revision });
}

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
    assert.strictEqual(advance(root, 'EXECUTE').phase, 'EXECUTE');
    assert.throws(() => advance(root, 'QG'), /ILLEGAL_PHASE_TRANSITION/);
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
    const transitioned = advance(root, 'EXECUTE', {
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
    advance(root, 'EXECUTE', { verdicts: [{ role: 'arch-platform', path: verdictPath }] });
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
    advance(root, 'EXECUTE', { verdicts: [{ role: 'arch-platform', path: verdictPath }] });
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
    const transitioned = advance(root, 'EXECUTE');
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

// Pass A binds the wave to a DRAFT PLAN; Pass B legitimately rewrites it. The state may be re-bound ONCE to the final
// PLAN while nothing was decided on the draft (PREP, revision 0, same HEAD, same class). Anything else stays drift.
const DRAFT_MARKER = 'STATUS: DRAFT-CONTEXT-PENDING';
const planPathOf = (root) => path.join(root, '.planning', 'wave-demo', 'PLAN.md');
function asDraft(root) { fs.writeFileSync(planPathOf(root), DRAFT_MARKER + '\n' + fs.readFileSync(planPathOf(root), 'utf8')); }
function asFinal(root, extra = 'Pass B added context.\n') {
  fs.writeFileSync(planPathOf(root), fs.readFileSync(planPathOf(root), 'utf8').replace(DRAFT_MARKER + '\n', '') + extra);
}

test('draft rebind: a state bound to the draft is re-bound once to the final PLAN, in one initialize', () => {
  const root = fixture();
  try {
    asDraft(root);
    const draft = control.initialize(root, 'demo');
    assert.strictEqual(draft.plan_draft, true);
    asFinal(root);
    const inspected = control.inspect(root, 'demo');
    assert.strictEqual(inspected.draft_rebind, true, 'the admission can see the pending re-binding');
    assert.strictEqual(inspected.plan_current, false);
    const rebound = control.initialize(root, 'demo');
    assert.strictEqual(rebound.plan_draft, false);
    assert.notStrictEqual(rebound.plan_sha256, draft.plan_sha256);
    assert.strictEqual(rebound.revision, 0);
    assert.strictEqual(rebound.phase, 'PREP');
    assert.strictEqual(control.status(root, 'demo').current, true, 'the state now follows the final PLAN');
    assert.strictEqual(control.initialize(root, 'demo').plan_sha256, rebound.plan_sha256, 'idempotent afterwards');
    assert.strictEqual(advance(root, 'EXECUTE').phase, 'EXECUTE', 'the wave proceeds on the final digest');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// A real consumer planner wrote the marker below a title line, so the first-line-only parser recorded plan_draft:false
// and the documented re-binding was refused as drift. The marker is a standalone line anywhere outside fenced code.
function withLeadingTitle(root) {
  fs.writeFileSync(planPathOf(root), '# Execution Plan: demo\n\n' + DRAFT_MARKER + '\n' + fs.readFileSync(planPathOf(root), 'utf8'));
}
test('draft rebind: a draft whose marker line follows a title is recognized and re-bound', () => {
  const root = fixture();
  try {
    withLeadingTitle(root);
    const draft = control.initialize(root, 'demo');
    assert.strictEqual(draft.plan_draft, true, 'a standalone marker line below the title marks a draft');
    asFinal(root);
    const rebound = control.initialize(root, 'demo');
    assert.strictEqual(rebound.plan_draft, false);
    assert.notStrictEqual(rebound.plan_sha256, draft.plan_sha256);
    assert.strictEqual(control.status(root, 'demo').current, true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('draft marker: inline prose or fenced code is not a draft, and a final PLAN still carrying the line is drift', () => {
  const root = fixture();
  try {
    const base = fs.readFileSync(planPathOf(root), 'utf8');
    fs.writeFileSync(planPathOf(root), 'Pass B removed the `' + DRAFT_MARKER + '` line.\n' + base);
    assert.strictEqual(control.initialize(root, 'demo').plan_draft, false, 'an inline quotation is not the marker line');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
  const fenced = fixture();
  try {
    const base = fs.readFileSync(planPathOf(fenced), 'utf8');
    fs.writeFileSync(planPathOf(fenced), '```text\n' + DRAFT_MARKER + '\n```\n' + base);
    assert.strictEqual(control.initialize(fenced, 'demo').plan_draft, false, 'a code sample is not the marker line');
  } finally { fs.rmSync(fenced, { recursive: true, force: true }); }
  const stale = fixture();
  try {
    withLeadingTitle(stale);
    control.initialize(stale, 'demo');
    fs.writeFileSync(planPathOf(stale), fs.readFileSync(planPathOf(stale), 'utf8') + 'Pass B kept the marker.\n');
    assert.throws(() => control.initialize(stale, 'demo'), /PHASE_STATE_INPUT_DRIFT/, 'a PLAN that is still a draft is never a re-binding target');
  } finally { fs.rmSync(stale, { recursive: true, force: true }); }
});

test('draft rebind: a second PLAN change after the re-binding is drift as before', () => {
  const root = fixture();
  try {
    asDraft(root);
    control.initialize(root, 'demo');
    asFinal(root);
    control.initialize(root, 'demo');
    fs.appendFileSync(planPathOf(root), 'A later edit.\n');
    assert.strictEqual(control.inspect(root, 'demo').draft_rebind, false);
    assert.throws(() => control.initialize(root, 'demo'), /PHASE_STATE_INPUT_DRIFT/);
    assert.throws(() => advance(root, 'EXECUTE'), /PHASE_STATE_PLAN_DRIFT/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('draft rebind: a final PLAN that was never a draft cannot be swapped for another final PLAN', () => {
  const root = fixture();
  try {
    control.initialize(root, 'demo');
    fs.appendFileSync(planPathOf(root), 'Another final PLAN.\n');
    assert.throws(() => control.initialize(root, 'demo'), /PHASE_STATE_INPUT_DRIFT/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('draft rebind: a draft that already made a transition is not re-bound', () => {
  const root = fixture();
  try {
    asDraft(root);
    control.initialize(root, 'demo');
    assert.strictEqual(advance(root, 'EXECUTE').phase, 'EXECUTE');
    asFinal(root);
    assert.strictEqual(control.inspect(root, 'demo').draft_rebind, false);
    assert.throws(() => control.initialize(root, 'demo'), /PHASE_STATE_INPUT_DRIFT/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('draft rebind: a different HEAD is not re-bound', () => {
  const root = fixture();
  try {
    asDraft(root);
    control.initialize(root, 'demo');
    asFinal(root);
    execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'test: move head'], { cwd: root });
    assert.strictEqual(control.inspect(root, 'demo').draft_rebind, false);
    assert.throws(() => control.initialize(root, 'demo'), /PHASE_STATE_INPUT_DRIFT/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('draft rebind: a different class is not re-bound', () => {
  const root = fixture();
  try {
    asDraft(root);
    control.initialize(root, 'demo');
    fs.writeFileSync(path.join(root, '.claude', 'registry', 'wave-topology.yaml'),
      'default_class: HARNESS\nclass_artifacts:\n  FAST-PATH:\n    architects: []\n    lifecycle_roles: []\n    execution_mode: disk-only\n'
      + '  DOC:\n    architects: declared\n    lifecycle_roles: []\n    execution_mode: disk-only\n');
    fs.writeFileSync(planPathOf(root), '### Wave Class\n\n**Class**: DOC\n**Required-Architects**: arch-platform\n');
    fs.writeFileSync(path.join(root, '.planning', 'wave-demo', 'CLASS'), 'DOC\n');
    assert.strictEqual(control.inspect(root, 'demo').draft_rebind, false);
    assert.throws(() => control.initialize(root, 'demo'), /PHASE_STATE_INPUT_DRIFT/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('draft rebind: a state written before the draft flag existed is never rebindable', () => {
  const root = fixture();
  try {
    asDraft(root);
    control.initialize(root, 'demo');
    const statePath = path.join(root, '.androidcommondoc', 'wave-control', 'demo.json');
    const legacy = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    delete legacy.plan_draft;
    fs.writeFileSync(statePath, JSON.stringify(legacy));
    asFinal(root);
    assert.strictEqual(control.inspect(root, 'demo').draft_rebind, false);
    assert.throws(() => control.initialize(root, 'demo'), /PHASE_STATE_INPUT_DRIFT/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('status and transition of a wave that was never initialized say so', () => {
  const root = fixture();
  try {
    assert.throws(() => control.status(root, 'demo'), /^Error: WAVE_NOT_INITIALIZED$/);
    assert.throws(() => control.transition(root, 'demo', 'EXECUTE'), /^Error: WAVE_NOT_INITIALIZED$/);
    const cli = path.resolve(__dirname, '..', 'tools', 'wave-control-plane.cjs');
    const out = spawnSync(process.execPath, [cli, 'status', '--root', root, '--slug', 'demo'], { encoding: 'utf8' });
    assert.strictEqual(out.status, 2);
    const body = JSON.parse(out.stdout);
    assert.strictEqual(body.reason, 'WAVE_NOT_INITIALIZED');
    assert.match(body.message, /^wave not initialized: run `wave-control init --slug <slug>`/);
    assert.ok(!/ANCESTRY/.test(out.stdout), 'no path-ancestry failure is shown');
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
    advance(root, 'EXECUTE');
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

test('a DOC wave starts its declared architects through the lifecycle, in addition to its floor roles', () => {
  const doc = (required) => fixture({ className: 'DOC', architects: 'declared', lifecycleRoles: '[context-provider, doc-updater]', executionMode: 'ephemeral', required });
  let root = doc('**Required-Architects**: arch-integration\n');
  try {
    const state = control.initialize(root, 'demo');
    assert.deepStrictEqual(state.required_roles, ['arch-integration']);
    assert.deepStrictEqual(state.lifecycle_roles, ['context-provider', 'doc-updater', 'arch-integration']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }

  root = doc('**Required-Architects**: arch-platform, arch-testing\n');
  try {
    assert.deepStrictEqual(control.initialize(root, 'demo').lifecycle_roles,
      ['context-provider', 'doc-updater', 'arch-platform', 'arch-testing']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }

  root = doc('');
  try { assert.throws(() => control.initialize(root, 'demo'), /DECLARED_ROLES_MISSING/, 'a DOC wave without Required-Architects still fails as before'); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('fixed-architect classes keep their configured lifecycle roles unchanged', () => {
  const root = fixture({ className: 'HARNESS', architects: '[arch-platform]', lifecycleRoles: '[arch-platform, context-provider]', executionMode: 'persistent' });
  try { assert.deepStrictEqual(control.initialize(root, 'demo').lifecycle_roles, ['arch-platform', 'context-provider']); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
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
    advance(root, 'EXECUTE');
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
    advance(root, 'EXECUTE');
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
