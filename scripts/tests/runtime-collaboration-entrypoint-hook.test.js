'use strict';

// R131/P4: proves the entrypoint hook repair -- the documented bare
// `node scripts/lib/runtime-collaboration-entrypoints.cjs execute` command
// (and its absolute-path bare sibling) is recognized and rewritten into the
// existing canonical renderPosixDirect form before execution, that the
// existing canonical renderPosixDirect absolute command still works
// unchanged, and that every non-conforming lookalike is still rejected
// (no injection). Uses real subprocess invocation of the genuine hook, the
// real repo root, and real production host composition mint/consume -- no
// mocks of the hook parser or host owner.

require('./lib/private-registry-tmpdir-preload.cjs');

const assert = require('assert');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '../..');
const HOOK_PATH = path.join(REPO_ROOT, '.claude/hooks/context-provider-gate.js');
const SESSION_START_HOOK_PATH = path.join(REPO_ROOT, '.claude/hooks/runtime-host-session-start.js');

const runtimeRoleLifecycle = require('../lib/runtime-role-lifecycle.cjs');
const runtimeHostClaude = require('../lib/runtime-host-claude.cjs');
const runtimeCollaborationEntrypoints = require('../lib/runtime-collaboration-entrypoints.cjs');

const CANONICAL_ENTRYPOINT_CLI_PATH = path.resolve(REPO_ROOT, 'scripts/lib/runtime-collaboration-entrypoints.cjs');
const RELATIVE_ENTRYPOINT_CLI_PATH = 'scripts/lib/runtime-collaboration-entrypoints.cjs';
const PORTABLE_REPO_ROOT = REPO_ROOT.replace(/\\/g, '/');
const PORTABLE_CANONICAL_ENTRYPOINT_CLI_PATH = CANONICAL_ENTRYPOINT_CLI_PATH.replace(/\\/g, '/');

let passed = 0;

function uniqueSessionId() {
  return 'r131-p4-hook-test-' + crypto.randomBytes(8).toString('hex');
}

function runHook(event) {
  const result = spawnSync(process.execPath, [HOOK_PATH], {
    input: JSON.stringify(event),
    encoding: 'utf8',
    cwd: REPO_ROOT,
  });
  return result;
}

function runHookAt(event, hookPath, cwd) {
  return spawnSync(process.execPath, [hookPath], { input: JSON.stringify(event), encoding: 'utf8', cwd });
}

// One minted fixture's worktreeRoot, consistently, for every path an admitted
// case needs: the hook script itself, cwd/event, the command's --project-root
// and script-token, planEntrypointStep and consumeProductionHostComposition.
// Never REPO_ROOT for these -- recordManagedSystemInit mints identity against
// the isolated worktree, so a hook subprocess or plan/consume call still
// pointed at REPO_ROOT would look in the wrong registry entry entirely.
function buildWorktreeContext(worktreeRoot) {
  const canonicalEntrypointPath = path.resolve(worktreeRoot, 'scripts/lib/runtime-collaboration-entrypoints.cjs');
  return {
    worktreeRoot,
    hookPath: path.join(worktreeRoot, '.claude/hooks/context-provider-gate.js'),
    canonicalEntrypointPath,
    portableWorktreeRoot: worktreeRoot.replace(/\\/g, '/'),
    portableCanonicalEntrypointPath: canonicalEntrypointPath.replace(/\\/g, '/'),
  };
}

function baseEvent(command, cwd, sessionId) {
  return {
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    session_id: sessionId || uniqueSessionId(),
    transcript_path: path.join(os.tmpdir(), 'r131-p4-no-persist-transcript-' + crypto.randomBytes(8).toString('hex') + '.jsonl'),
    cwd: cwd || REPO_ROOT,
    tool_input: { command },
  };
}

const { mintIsolatedHostContractSession } = require('./lib/host-contract-fixture.cjs');
const runtimeConsultation = require('../lib/runtime-consultation.cjs');

process.on('exit', () => {
  for (const fixture of hostContractFixtures) {
    try { fixture.cleanup(); } catch { /* best-effort */ }
  }
});
const hostContractFixtures = [];

function recordManagedSystemInit(sessionId) {
  const event = {
    type: 'system',
    subtype: 'init',
    session_id: sessionId,
    model: 'claude-sonnet-5',
    tools: ['Agent', 'Bash', 'SendMessage', 'Read'],
    mcp_servers: [],
  };
  const minted = mintIsolatedHostContractSession(REPO_ROOT, { rc: runtimeConsultation, runtimeHostClaude, event });
  hostContractFixtures.push(minted); // process-exit safety net, on top of each case's own deterministic finally cleanup.
  assert.strictEqual(minted.result.ok, true, 'managed system/init fixture must be admitted: ' + JSON.stringify(minted.result));
  return minted;
}

function monitorDocsIntent() {
  return Buffer.from(JSON.stringify({ scope: 'all' })).toString('base64url');
}

function initSessionIntent() {
  return Buffer.from(JSON.stringify({ mode: 'start' })).toString('base64url');
}

function extractRewrittenCommand(stdout) {
  const body = JSON.parse(stdout);
  return body.hookSpecificOutput.updatedInput.command;
}

function extractFlag(tokens, flag) {
  const idx = tokens.indexOf(flag);
  return idx === -1 ? undefined : tokens[idx + 1];
}

// buildCommand(ctx) receives the ONE minted worktree's paths and returns the
// exact command string for this case's shape (relative/absolute/quoted/
// renderPosixDirect/realpath-alias) -- one mint+hook+plan+consume flow shared
// by every admitted case, never duplicated per shape.
function assertAdmittedAndConsume(label, buildCommand) {
  const sessionId = uniqueSessionId();
  const minted = recordManagedSystemInit(sessionId);
  try {
    const ctx = buildWorktreeContext(minted.worktreeRoot);
    const command = buildCommand(ctx);
    const event = baseEvent(command, ctx.worktreeRoot, sessionId);
    const result = runHookAt(event, ctx.hookPath, ctx.worktreeRoot);
    assert.strictEqual(result.status, 0, label + ': hook exit code');
    assert.notStrictEqual(result.stdout.trim(), '', label + ': expected non-empty stdout (injection)');
    const rewritten = extractRewrittenCommand(result.stdout);

    const parsedTokens = runtimeRoleLifecycle.parsePosixDirect(rewritten);
    assert.ok(parsedTokens, label + ': rewritten command must parse with parsePosixDirect');
    assert.strictEqual(parsedTokens[1], ctx.canonicalEntrypointPath, label + ': script token must be exact absolute owner');

    const hostCompositionId = extractFlag(parsedTokens, '--host-composition');
    assert.ok(hostCompositionId && /^[0-9a-f]{32}$/.test(hostCompositionId), label + ': expected real 32-hex --host-composition');
    assert.strictEqual(extractFlag(parsedTokens, '--lifecycle-binding'), undefined, label + ': monitor-docs must not carry --lifecycle-binding');

    const intent = { scope: 'all' };
    const plan = runtimeCollaborationEntrypoints.planEntrypointStep('monitor-docs', intent, ctx.worktreeRoot);
    const consumed = runtimeHostClaude.consumeProductionHostComposition(ctx.worktreeRoot, hostCompositionId, {
      entrypoint: 'monitor-docs',
      argvDigest: plan.argv_digest,
      roleScope: plan.role_scope,
    });
    assert.strictEqual(consumed.ok, true, label + ': composition must be consumable with the exact plan tuple');

    console.log('PASS: ' + label);
    return { rewritten, ctx };
  } finally {
    minted.cleanup();
  }
}

function assertNoInjection(command, cwd, label) {
  const event = baseEvent(command, cwd);
  const result = runHook(event);
  assert.strictEqual(result.status, 0, label + ': hook exit code');
  assert.strictEqual(result.stdout.trim(), '', label + ': expected empty stdout (no injection)');
  console.log('PASS: ' + label);
}

// Case 1: exact documented relative bare command is allowed/rewritten.
{
  assertAdmittedAndConsume('case-1-relative-bare-command', (ctx) =>
    'node ' + RELATIVE_ENTRYPOINT_CLI_PATH + ' execute --entrypoint monitor-docs --project-root '
      + ctx.portableWorktreeRoot + ' --intent ' + monitorDocsIntent());
  passed += 1;
}

// Case 2: bare absolute owner command is likewise rewritten canonically and admitted.
{
  assertAdmittedAndConsume('case-2-absolute-bare-command', (ctx) =>
    'node ' + ctx.portableCanonicalEntrypointPath + ' execute --entrypoint monitor-docs --project-root '
      + ctx.portableWorktreeRoot + ' --intent ' + monitorDocsIntent());
  passed += 1;
}

// Case 3: existing canonical renderPosixDirect absolute command still rewrites/admitted.
{
  assertAdmittedAndConsume('case-3-canonical-renderposixdirect-command', (ctx) =>
    runtimeRoleLifecycle.renderPosixDirect([
      'node', ctx.canonicalEntrypointPath, 'execute',
      '--entrypoint', 'monitor-docs', '--project-root', ctx.worktreeRoot,
      '--intent', monitorDocsIntent(),
    ]));
  passed += 1;
}

// R131/P4 live regression: on Windows, process.execPath can be an NVM junction
// while resolvedNodePath() is the real versioned executable. The hook must
// recognize the junction only when it realpaths to that exact trusted binary.
{
  const { rewritten } = assertAdmittedAndConsume('case-3b-realpath-equivalent-node-alias', (ctx) =>
    runtimeRoleLifecycle.renderPosixDirect([
      process.execPath, ctx.canonicalEntrypointPath, 'execute',
      '--entrypoint', 'monitor-docs', '--project-root', ctx.worktreeRoot,
      '--intent', monitorDocsIntent(),
    ]));
  const parsed = runtimeRoleLifecycle.parsePosixDirect(rewritten);
  assert.strictEqual(parsed[0], runtimeRoleLifecycle.resolvedNodePath(),
    'case-3b-realpath-equivalent-node-alias: execution must use the canonical realpath');
  passed += 1;
}

// Realpath equivalence must not broaden recognition to any other existing
// absolute file supplied as argv[0].
{
  const command = runtimeRoleLifecycle.renderPosixDirect([
    __filename, CANONICAL_ENTRYPOINT_CLI_PATH, 'execute',
    '--entrypoint', 'monitor-docs', '--project-root', REPO_ROOT,
    '--intent', monitorDocsIntent(),
  ]);
  assertNoInjection(command, REPO_ROOT, 'case-3c-unrelated-absolute-node-token');
  passed += 1;
}

// Exact genuine-live P4 command shape: init-session requires both the host
// composition and the lifecycle binding that were absent in the failed run.
{
  const sessionId = uniqueSessionId();
  const minted = recordManagedSystemInit(sessionId);
  try {
    const ctx = buildWorktreeContext(minted.worktreeRoot);
    const command = runtimeRoleLifecycle.renderPosixDirect([
      process.execPath, ctx.canonicalEntrypointPath, 'execute',
      '--entrypoint', 'init-session', '--project-root', ctx.worktreeRoot,
      '--intent', initSessionIntent(),
    ]);
    const result = runHookAt(baseEvent(command, ctx.worktreeRoot, sessionId), ctx.hookPath, ctx.worktreeRoot);
    assert.strictEqual(result.status, 0, 'case-3d-exact-live-init-session-shape: hook exit code');
    assert.notStrictEqual(result.stdout.trim(), '', 'case-3d-exact-live-init-session-shape: expected injection');
    const parsed = runtimeRoleLifecycle.parsePosixDirect(extractRewrittenCommand(result.stdout));
    assert.strictEqual(parsed[0], runtimeRoleLifecycle.resolvedNodePath(),
      'case-3d-exact-live-init-session-shape: execution must use canonical Node realpath');
    assert.match(extractFlag(parsed, '--host-composition') || '', /^[0-9a-f]{32}$/,
      'case-3d-exact-live-init-session-shape: host composition must be injected');
    assert.match(extractFlag(parsed, '--lifecycle-binding') || '', /^[0-9a-f]{32}$/,
      'case-3d-exact-live-init-session-shape: lifecycle binding must be injected');
    console.log('PASS: case-3d-exact-live-init-session-shape');
    passed += 1;
  } finally {
    minted.cleanup();
  }
}

// Case 4: exact relative token with cwd set to a different absolute directory receives no injection.
{
  const command = 'node ' + RELATIVE_ENTRYPOINT_CLI_PATH + ' execute --entrypoint monitor-docs --project-root '
    + PORTABLE_REPO_ROOT + ' --intent ' + monitorDocsIntent();
  assertNoInjection(command, path.resolve(REPO_ROOT, '..'), 'case-4-mismatched-cwd');
  passed += 1;
}

// Case 5: same documented command with two spaces between any words receives no injection.
{
  const command = 'node  ' + RELATIVE_ENTRYPOINT_CLI_PATH + ' execute --entrypoint monitor-docs --project-root '
    + PORTABLE_REPO_ROOT + ' --intent ' + monitorDocsIntent();
  assertNoInjection(command, REPO_ROOT, 'case-5-double-space');
  passed += 1;
}

// Case 6: same documented command with `;` plus another command receives no injection.
{
  const command = 'node ' + RELATIVE_ENTRYPOINT_CLI_PATH + ' execute --entrypoint monitor-docs --project-root '
    + PORTABLE_REPO_ROOT + ' --intent ' + monitorDocsIntent() + ' ; echo pwned';
  assertNoInjection(command, REPO_ROOT, 'case-6-shell-operator');
  passed += 1;
}

{
  assertAdmittedAndConsume('case-7-claude-windows-double-quoted-project-root', (ctx) =>
    'node ' + RELATIVE_ENTRYPOINT_CLI_PATH + ' execute --entrypoint monitor-docs --project-root "'
      + ctx.worktreeRoot + '" --intent ' + monitorDocsIntent());
  passed += 1;
}

// Case 8: a production-shaped PreToolUse event cannot self-assert its model.
// Without the preceding SessionStart observation, the recognized command is
// denied even when the caller injects a model-shaped field of its own.
{
  const command = runtimeRoleLifecycle.renderPosixDirect([
    'node', CANONICAL_ENTRYPOINT_CLI_PATH, 'execute',
    '--entrypoint', 'monitor-docs', '--project-root', REPO_ROOT,
    '--intent', monitorDocsIntent(),
  ]);
  const event = baseEvent(command, REPO_ROOT);
  event.model = 'claude-sonnet-5';
  const result = runHook(event);
  assert.strictEqual(result.status, 0, 'case-8-missing-session-start-evidence: hook exit code');
  const body = JSON.parse(result.stdout);
  assert.strictEqual(body.hookSpecificOutput.permissionDecision, 'deny');
  console.log('PASS: case-8-missing-session-start-evidence');
  passed += 1;
}

assert.strictEqual(passed, 11);

// Case 9: the production SessionStart hook must stay silent and fail closed
// when invoked from an ordinary test process whose ancestry contains no
// executable matching the signed Claude host certificate.
{
  const sessionId = uniqueSessionId();
  const event = {
    hook_event_name: 'SessionStart', source: 'startup', session_id: sessionId,
    transcript_path: path.join(os.tmpdir(), 'r131-p4-no-persist-transcript-' + crypto.randomBytes(8).toString('hex') + '.jsonl'),
    cwd: REPO_ROOT,
  };
  const result = spawnSync(process.execPath, [SESSION_START_HOOK_PATH], {
    input: JSON.stringify(event), encoding: 'utf8', cwd: REPO_ROOT,
    env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: REPO_ROOT }),
    timeout: 25000,
  });
  assert.strictEqual(result.status, 0, 'case-9-unpinned-session-start: hook exit code');
  assert.strictEqual(result.stdout.trim(), '', 'case-9-unpinned-session-start: hook must stay silent');
  assert.strictEqual(runtimeHostClaude.getProductionSessionIdentity(REPO_ROOT, sessionId).ok, false,
    'case-9-unpinned-session-start: no interactive identity evidence may be minted');
  console.log('PASS: case-9-unpinned-session-start');
  passed += 1;
}

assert.strictEqual(passed, 12);

console.log('12/12 PASS');
