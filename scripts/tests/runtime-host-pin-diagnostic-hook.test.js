'use strict';

// R131/P3 diagnostics through the genuine hooks: when SessionStart could not mint
// the interactive host pin, the collaboration-entrypoint denial names the
// bounded failure code instead of the opaque "evidence is unavailable". Only
// `^[A-Z0-9_]+$` codes may ever reach the message.

require('./lib/private-registry-tmpdir-preload.cjs');

const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { runOrphanedSessionStart } = require('./lib/orphaned-session-start.cjs');

const REPO_ROOT = path.resolve(__dirname, '../..');
const GATE_HOOK = path.join(REPO_ROOT, '.claude/hooks/context-provider-gate.js');
const SESSION_START_HOOK = path.join(REPO_ROOT, '.claude/hooks/runtime-host-session-start.js');
const ENTRYPOINT_CLI = path.join(REPO_ROOT, 'scripts/lib/runtime-collaboration-entrypoints.cjs');

const rll = require('../lib/runtime-role-lifecycle.cjs');
const runtimeHostClaude = require('../lib/runtime-host-claude.cjs');

const UNAVAILABLE = '[R131/P3] genuine claude-sonnet-5 host composition evidence is unavailable';

function sessionId() {
  return 'pin-diagnostic-hook-' + crypto.randomBytes(8).toString('hex');
}

function transcriptPath() {
  return path.join(os.tmpdir(), 'pin-diagnostic-no-persist-' + crypto.randomBytes(8).toString('hex') + '.jsonl');
}

function sessionStartEvent(id) {
  return { hook_event_name: 'SessionStart', source: 'startup', session_id: id,
    transcript_path: transcriptPath(), cwd: REPO_ROOT, model: 'claude-sonnet-5' };
}

function diagnosticPath(id) {
  return path.join(rll.registryRepoDir(REPO_ROOT), 'host-sessions',
    'diagnostic-interactive-' + crypto.createHash('sha256').update(id, 'utf8').digest('hex') + '.json');
}

function gateDenial(id, extraEnv) {
  const command = rll.renderPosixDirect([
    // The planless read-only dashboard needs no PLAN, so the L0 checkout reaches host-composition admission.
    'node', ENTRYPOINT_CLI, 'execute', '--entrypoint', 'init-session', '--project-root', REPO_ROOT,
    '--intent', Buffer.from(JSON.stringify({ mode: 'dashboard' }), 'utf8').toString('base64url'),
  ]);
  const event = { hook_event_name: 'PreToolUse', tool_name: 'Bash', session_id: id,
    tool_use_id: 'toolu_' + crypto.randomBytes(6).toString('hex'), transcript_path: transcriptPath(),
    cwd: REPO_ROOT, effort: { level: 'high' }, tool_input: { command } };
  const result = spawnSync(process.execPath, [GATE_HOOK], {
    input: JSON.stringify(event), encoding: 'utf8', cwd: REPO_ROOT,
    env: { ...process.env, CLAUDE_PROJECT_DIR: REPO_ROOT, ...(extraEnv || {}) },
  });
  assert.strictEqual(result.status, 0, result.stderr);
  const body = JSON.parse(result.stdout);
  assert.strictEqual(body.hookSpecificOutput.permissionDecision, 'deny');
  return body.hookSpecificOutput.permissionDecisionReason;
}

test('PIN-DIAG-HOOK-01 the R131/P3 denial names the persisted SessionStart failure code', () => {
  const id = sessionId();
  try {
    assert.strictEqual(gateDenial(id), UNAVAILABLE + ' (HOST_PIN_UNPROVEN: HOST_PIN_SESSION_RECORD_ABSENT).');
    assert.strictEqual(runtimeHostClaude.recordInteractiveSessionPinDiagnostic({
      projectRoot: REPO_ROOT, event: sessionStartEvent(id),
      result: { ok: false, reason: 'HOST_PIN_UNPROVEN', detail: 'HOST_PIN_VENDOR_MATCH_COUNT_4' },
    }).ok, true);
    assert.strictEqual(gateDenial(id), UNAVAILABLE + ' (HOST_PIN_UNPROVEN: HOST_PIN_VENDOR_MATCH_COUNT_4).');
  } finally { fs.rmSync(diagnosticPath(id), { force: true }); }
});

test('PIN-DIAG-HOOK-02 a non-code detail is never echoed by the denial', () => {
  const id = sessionId();
  try {
    assert.strictEqual(runtimeHostClaude.recordInteractiveSessionPinDiagnostic({
      projectRoot: REPO_ROOT, event: sessionStartEvent(id),
      result: { ok: false, reason: 'HOST_PIN_UNPROVEN', detail: 'HOST_PIN_VENDOR_MATCH_COUNT_4' },
    }).ok, true);
    const record = JSON.parse(fs.readFileSync(diagnosticPath(id), 'utf8'));
    fs.writeFileSync(diagnosticPath(id), JSON.stringify({ ...record, detail: 'see /Users/someone/private repo' }));
    const tampered = gateDenial(id);
    assert.doesNotMatch(tampered, /someone|private|\/Users/);
    assert.strictEqual(tampered, UNAVAILABLE + ' (HOST_PIN_UNPROVEN: HOST_PIN_SESSION_RECORD_ABSENT).');
    fs.writeFileSync(diagnosticPath(id), JSON.stringify({ ...record, reason: 'Host pin unproven', detail: null }));
    assert.strictEqual(gateDenial(id), UNAVAILABLE + ' (HOST_PIN_UNPROVEN: HOST_PIN_SESSION_RECORD_ABSENT).');
  } finally { fs.rmSync(diagnosticPath(id), { force: true }); }
});

test('PIN-DIAG-HOOK-03 the genuine SessionStart hook persists the code it reports and the gate repeats it',
  { skip: process.platform !== 'darwin' }, () => {
    const id = sessionId();
    try {
      const started = runOrphanedSessionStart({
        event: sessionStartEvent(id), hookPath: SESSION_START_HOOK, projectRoot: REPO_ROOT,
      });
      assert.strictEqual(started.status, 0);
      assert.strictEqual(started.stdout.trim(), '');
      assert.strictEqual(started.stderr, '[runtime-host-session-start] HOST_PIN_VENDOR_MATCH_COUNT_0\n',
        'an orphaned hook has no signed Claude ancestor');
      const record = JSON.parse(fs.readFileSync(diagnosticPath(id), 'utf8'));
      assert.deepStrictEqual([record.reason, record.detail], ['HOST_PIN_UNPROVEN', 'HOST_PIN_VENDOR_MATCH_COUNT_0']);
      assert.strictEqual(gateDenial(id), UNAVAILABLE + ' (HOST_PIN_UNPROVEN: HOST_PIN_VENDOR_MATCH_COUNT_0).');
    } finally { fs.rmSync(diagnosticPath(id), { force: true }); }
  });

// The gate validates codes itself rather than trusting the library: a mint result carrying free text (stubbed in the
// gate process through a test-only preload) must never reach the message.
test('PIN-DIAG-HOOK-04 the gate echoes only uppercase codes even if the mint result carries free text', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pin-diagnostic-stub-'));
  try {
    const preload = path.join(dir, 'stub-mint.cjs');
    fs.writeFileSync(preload, "'use strict';\n"
      + 'const lib = require(' + JSON.stringify(path.join(REPO_ROOT, 'scripts/lib/runtime-host-claude.cjs')) + ');\n'
      + 'const stub = JSON.parse(process.env.PIN_DIAG_STUB_RESULT);\n'
      + 'lib.mintProductionHostComposition = () => stub;\n');
    const denialFor = (result) => gateDenial(sessionId(), {
      NODE_OPTIONS: '--require ' + preload, PIN_DIAG_STUB_RESULT: JSON.stringify(result),
    });
    assert.strictEqual(denialFor({ ok: false, reason: 'HOST_PIN_UNPROVEN', detail: 'HOST_PIN_NESTED_VENDOR_HOST' }),
      UNAVAILABLE + ' (HOST_PIN_UNPROVEN: HOST_PIN_NESTED_VENDOR_HOST).', 'the stub must be in effect');
    assert.strictEqual(denialFor({ ok: false, reason: 'HOST_PIN_UNPROVEN', detail: '/Users/someone/private repo' }),
      UNAVAILABLE + ' (HOST_PIN_UNPROVEN).');
    assert.strictEqual(denialFor({ ok: false, reason: 'host pin at /Users/someone', detail: 'HOST_PIN_X' }),
      UNAVAILABLE + '.');
    assert.strictEqual(denialFor({ ok: false, reason: 'HOST_PIN_UNPROVEN', detail: 'A'.repeat(65) }),
      UNAVAILABLE + ' (HOST_PIN_UNPROVEN).', 'codes are length-bounded');
    assert.strictEqual(denialFor({ ok: false }), UNAVAILABLE + '.');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
