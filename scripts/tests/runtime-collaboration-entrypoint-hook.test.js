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

const assert = require('assert');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '../..');
const HOOK_PATH = path.join(REPO_ROOT, '.claude/hooks/context-provider-gate.js');

const runtimeRoleLifecycle = require('../lib/runtime-role-lifecycle.cjs');
const runtimeHostClaude = require('../lib/runtime-host-claude.cjs');
const runtimeCollaborationEntrypoints = require('../lib/runtime-collaboration-entrypoints.cjs');

const CANONICAL_ENTRYPOINT_CLI_PATH = path.resolve(REPO_ROOT, 'scripts/lib/runtime-collaboration-entrypoints.cjs');
const RELATIVE_ENTRYPOINT_CLI_PATH = 'scripts/lib/runtime-collaboration-entrypoints.cjs';

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

function baseEvent(command, cwd) {
  return {
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    session_id: uniqueSessionId(),
    model: 'claude-sonnet-5',
    cwd: cwd || REPO_ROOT,
    tool_input: { command },
  };
}

function monitorDocsIntent() {
  return Buffer.from(JSON.stringify({ scope: 'all' })).toString('base64url');
}

function extractRewrittenCommand(stdout) {
  const body = JSON.parse(stdout);
  return body.hookSpecificOutput.updatedInput.command;
}

function extractFlag(tokens, flag) {
  const idx = tokens.indexOf(flag);
  return idx === -1 ? undefined : tokens[idx + 1];
}

function assertAdmittedAndConsume(command, cwd, label) {
  const event = baseEvent(command, cwd);
  const result = runHook(event);
  assert.strictEqual(result.status, 0, label + ': hook exit code');
  assert.notStrictEqual(result.stdout.trim(), '', label + ': expected non-empty stdout (injection)');
  const rewritten = extractRewrittenCommand(result.stdout);

  const parsedTokens = runtimeRoleLifecycle.parsePosixDirect(rewritten);
  assert.ok(parsedTokens, label + ': rewritten command must parse with parsePosixDirect');
  assert.strictEqual(parsedTokens[1], CANONICAL_ENTRYPOINT_CLI_PATH, label + ': script token must be exact absolute owner');

  const hostCompositionId = extractFlag(parsedTokens, '--host-composition');
  assert.ok(hostCompositionId && /^[0-9a-f]{32}$/.test(hostCompositionId), label + ': expected real 32-hex --host-composition');
  assert.strictEqual(extractFlag(parsedTokens, '--lifecycle-binding'), undefined, label + ': monitor-docs must not carry --lifecycle-binding');

  const intent = { scope: 'all' };
  const plan = runtimeCollaborationEntrypoints.planEntrypointStep('monitor-docs', intent, REPO_ROOT);
  const consumed = runtimeHostClaude.consumeProductionHostComposition(REPO_ROOT, hostCompositionId, {
    entrypoint: 'monitor-docs',
    argvDigest: plan.argv_digest,
    roleScope: plan.role_scope,
  });
  assert.strictEqual(consumed.ok, true, label + ': composition must be consumable with the exact plan tuple');

  console.log('PASS: ' + label);
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
  const command = 'node ' + RELATIVE_ENTRYPOINT_CLI_PATH + ' execute --entrypoint monitor-docs --project-root '
    + REPO_ROOT + ' --intent ' + monitorDocsIntent();
  assertAdmittedAndConsume(command, REPO_ROOT, 'case-1-relative-bare-command');
  passed += 1;
}

// Case 2: bare absolute owner command is likewise rewritten canonically and admitted.
{
  const command = 'node ' + CANONICAL_ENTRYPOINT_CLI_PATH + ' execute --entrypoint monitor-docs --project-root '
    + REPO_ROOT + ' --intent ' + monitorDocsIntent();
  assertAdmittedAndConsume(command, REPO_ROOT, 'case-2-absolute-bare-command');
  passed += 1;
}

// Case 3: existing canonical renderPosixDirect absolute command still rewrites/admitted.
{
  const command = runtimeRoleLifecycle.renderPosixDirect([
    'node', CANONICAL_ENTRYPOINT_CLI_PATH, 'execute',
    '--entrypoint', 'monitor-docs', '--project-root', REPO_ROOT,
    '--intent', monitorDocsIntent(),
  ]);
  assertAdmittedAndConsume(command, REPO_ROOT, 'case-3-canonical-renderposixdirect-command');
  passed += 1;
}

// Case 4: exact relative token with cwd set to a different absolute directory receives no injection.
{
  const command = 'node ' + RELATIVE_ENTRYPOINT_CLI_PATH + ' execute --entrypoint monitor-docs --project-root '
    + REPO_ROOT + ' --intent ' + monitorDocsIntent();
  assertNoInjection(command, path.resolve(REPO_ROOT, '..'), 'case-4-mismatched-cwd');
  passed += 1;
}

// Case 5: same documented command with two spaces between any words receives no injection.
{
  const command = 'node  ' + RELATIVE_ENTRYPOINT_CLI_PATH + ' execute --entrypoint monitor-docs --project-root '
    + REPO_ROOT + ' --intent ' + monitorDocsIntent();
  assertNoInjection(command, REPO_ROOT, 'case-5-double-space');
  passed += 1;
}

// Case 6: same documented command with `;` plus another command receives no injection.
{
  const command = 'node ' + RELATIVE_ENTRYPOINT_CLI_PATH + ' execute --entrypoint monitor-docs --project-root '
    + REPO_ROOT + ' --intent ' + monitorDocsIntent() + ' ; echo pwned';
  assertNoInjection(command, REPO_ROOT, 'case-6-shell-operator');
  passed += 1;
}

assert.strictEqual(passed, 6);
console.log('6/6 PASS');
