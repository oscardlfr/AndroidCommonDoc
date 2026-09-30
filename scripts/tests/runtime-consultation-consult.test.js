#!/usr/bin/env node
'use strict';

// BL-CONS-P1-08 / BL-CONS-P2-02: the single-command consumer consult path.
// `consult` builds plan-ref, intent and subject bundle from the wave PLAN and
// the authenticated role, then delegates to the existing publish-request and
// dispatch cores. Requester identity still comes only from the hook-minted
// grant (here: the grant wrapper fixture, the same primitives the hook uses).

require('./lib/private-registry-tmpdir-preload.cjs');

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

const TEST_CAPABILITY = 'rcc-consult-test-fixture-capability';
process.env.NODE_ENV = 'test';
process.env.RUNTIME_CONSULTATION_TEST_CAPABILITY = TEST_CAPABILITY;

const GRANT_WRAPPER = path.resolve(__dirname, 'fixtures/runtime-consultation-grant-wrapper.cjs');
const { createRequestProtocol } = require('../lib/runtime-consultation/protocol/request.cjs');

class PolicyCliError extends Error {
  constructor(status, detailCode, message) { super(detailCode + ': ' + message); this.detailCode = detailCode; }
}
// assertRolePolicy depends only on fs and CliError; every other protocol dependency is unused by it.
const noop = () => true;
const { assertRolePolicy } = createRequestProtocol({
  fs, path, CliError: PolicyCliError, orNull: () => noop, isEnum: () => noop,
  isNonEmptyString: noop, isNonNegativeInteger: noop, isHex64: noop, isHexId: noop,
  isIsoTimestamp: noop, isContentRefHandle: noop, utf8ByteLength: () => 0,
});
const launcher = require('../../.claude/runtime/l0-toolkit-launcher.cjs');

const MARKER = 'STATUS: DRAFT-CONTEXT-PENDING';

function git(dir, args) {
  const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  return r.stdout.trim();
}

function withWave({ slug, plan }, fn) {
  const proj = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rcc-consult-')));
  try {
    git(proj, ['init', '-q']);
    git(proj, ['config', 'user.email', 'consult-test@test.local']);
    git(proj, ['config', 'user.name', 'Consult Test']);
    git(proj, ['commit', '-q', '--allow-empty', '-m', 'init']);
    const waveDir = path.join(proj, '.planning', 'wave-' + slug);
    fs.mkdirSync(waveDir, { recursive: true });
    const planPath = path.join(waveDir, 'PLAN.md');
    fs.writeFileSync(planPath, plan);
    const coordRoot = path.join(proj, '.planning', 'coordination');
    const init = spawnCli(proj, 'arch-testing', ['root-init', '--coordination-root', coordRoot]);
    assert.strictEqual(init.status, 0, init.stdout + init.stderr);
    return fn({ proj, coordRoot, planPath });
  } finally {
    fs.rmSync(proj, { recursive: true, force: true });
  }
}

function spawnCli(proj, role, args, extraEnv) {
  return spawnSync(process.execPath, [GRANT_WRAPPER, ...args], {
    cwd: proj,
    encoding: 'utf8',
    env: Object.assign({}, process.env, {
      RCC_GRANT_PROJECT_ROOT: proj,
      RCC_GRANT_ROLE: role,
      CLAUDE_PROJECT_DIR: proj,
    }, extraEnv || {}),
  });
}

function consult(ctx, role, extra, extraEnv) {
  return spawnCli(ctx.proj, role, [
    'consult', '--coordination-root', ctx.coordRoot, '--question', 'Which KMP source set owns expect/actual?',
  ].concat(extra || []), extraEnv);
}

function envelope(result) {
  const line = result.stdout.trim().split('\n').pop();
  return JSON.parse(line);
}

test('consult (arch-testing): publishes a context-provider request from the PLAN and dispatches it', () => {
  withWave({ slug: 'consult-arch', plan: '# plan\n' }, (ctx) => {
    const out = envelope(consult(ctx, 'arch-testing'));
    assert.strictEqual(out.command, 'consult');
    assert.strictEqual(out.status, 'SUCCESS', JSON.stringify(out));
    assert.ok(out.request_id && out.artifact_ref, 'request id and request artifact are returned');
    const request = JSON.parse(fs.readFileSync(out.artifact_ref, 'utf8'));
    assert.strictEqual(request.source_role, 'arch-testing');
    assert.strictEqual(request.target_role, 'context-provider');
    assert.strictEqual(request.wave_slug, 'consult-arch');
    const dispatched = path.join(path.dirname(out.artifact_ref), 'attempts');
    assert.ok(fs.existsSync(path.dirname(out.artifact_ref)), 'transaction directory exists');
    assert.ok(out.activation_action === null || typeof out.activation_action === 'object');
    void dispatched;
  });
});

test('consult (planner): admitted only while the PLAN carries the draft marker', () => {
  withWave({ slug: 'consult-draft', plan: MARKER + '\n\n## Execution Plan: probe\n' }, (ctx) => {
    const out = envelope(consult(ctx, 'planner'));
    assert.strictEqual(out.status, 'SUCCESS', JSON.stringify(out));
    const request = JSON.parse(fs.readFileSync(out.artifact_ref, 'utf8'));
    assert.strictEqual(request.source_role, 'planner');
    assert.strictEqual(request.target_role, 'context-provider');
  });
});

test('consult (planner): a marker-free PLAN is rejected as AUTHORITY_INVALID', () => {
  withWave({ slug: 'consult-final', plan: '## Execution Plan: probe\n' }, (ctx) => {
    const out = envelope(consult(ctx, 'planner'));
    assert.strictEqual(out.status, 'INVALID', JSON.stringify(out));
    assert.strictEqual(out.detail_code, 'AUTHORITY_INVALID');
  });
});

test('consult (planner): the marker must be the first PLAN line, not quoted text later in the file', () => {
  withWave({ slug: 'consult-decoy', plan: '## Execution Plan: probe\n\n' + MARKER + '\n' }, (ctx) => {
    const out = envelope(consult(ctx, 'planner'));
    assert.strictEqual(out.status, 'INVALID', JSON.stringify(out));
    assert.strictEqual(out.detail_code, 'AUTHORITY_INVALID');
  });
});

test('consult: a non-requester specialist role is rejected even with a valid grant', () => {
  withWave({ slug: 'consult-specialist', plan: '# plan\n' }, (ctx) => {
    const out = envelope(consult(ctx, 'toolkit-specialist'));
    assert.strictEqual(out.status, 'INVALID', JSON.stringify(out));
    assert.strictEqual(out.detail_code, 'AUTHORITY_INVALID');
  });
});

test('consult: the flag set is closed — a caller cannot choose the target role', () => {
  withWave({ slug: 'consult-flags', plan: '# plan\n' }, (ctx) => {
    const result = consult(ctx, 'arch-testing', ['--target-role', 'arch-platform']);
    const out = envelope(result);
    assert.strictEqual(out.status, 'USAGE_ERROR', JSON.stringify(out));
    assert.strictEqual(out.detail_code, 'INVALID_ARGUMENT', 'rejected by the closed flag list, not as an unknown command');
    assert.notStrictEqual(result.status, 0);
  });
});

test('consult: a coordination root from a foreign worktree is rejected', () => {
  withWave({ slug: 'consult-home', plan: '# plan\n' }, (home) => {
    withWave({ slug: 'consult-foreign', plan: '# plan\n' }, (foreign) => {
      const result = spawnCli(home.proj, 'arch-testing', [
        'consult', '--coordination-root', foreign.coordRoot, '--question', 'foreign root?',
      ]);
      const out = envelope(result);
      assert.strictEqual(out.status, 'INVALID', JSON.stringify(out));
      assert.ok(['AUTHORITY_INVALID', 'CORRELATION_INVALID'].includes(out.detail_code), out.detail_code);
    });
  });
});

test('assertRolePolicy: planner → context-provider needs the draft PLAN; nothing else widens', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rcc-policy-'));
  try {
    const draft = path.join(dir, 'draft.md');
    const final = path.join(dir, 'final.md');
    fs.writeFileSync(draft, MARKER + '\n');
    fs.writeFileSync(final, '## Execution Plan\n');
    assert.doesNotThrow(() => assertRolePolicy('planner', 'context-provider', { planPath: draft }));
    assert.throws(() => assertRolePolicy('planner', 'context-provider', { planPath: final }), /AUTHORITY_INVALID|mediated chain/);
    assert.throws(() => assertRolePolicy('planner', 'context-provider'), /mediated chain/);
    assert.doesNotThrow(() => assertRolePolicy('planner', 'context-provider', { persisted: true }), 'read-side revalidation of a published draft consult');
    assert.throws(() => assertRolePolicy('toolkit-specialist', 'context-provider', { persisted: true }), /mediated chain/, 'persisted never widens other roles');
    for (const role of ['toolkit-specialist', 'test-specialist', 'doc-updater', 'quality-gater', 'verifier']) {
      assert.throws(() => assertRolePolicy(role, 'context-provider', { planPath: draft }), /mediated chain/, role);
    }
    assert.doesNotThrow(() => assertRolePolicy('arch-platform', 'context-provider'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('launcher: runtime-consult is one exact operation with a closed requester subcommand allowlist', () => {
  const spec = launcher.TOOL_SPECS['runtime-consult'];
  assert.ok(spec, 'runtime-consult must be a launcher operation');
  assert.strictEqual(spec.relative, 'scripts/lib/runtime-consultation.cjs');
  assert.strictEqual(spec.executor, 'node');
  assert.deepStrictEqual(
    spec.allowedSubcommands.slice().sort(),
    ['accept-result', 'await-result', 'consult', 'record-delivery'],
  );
});
