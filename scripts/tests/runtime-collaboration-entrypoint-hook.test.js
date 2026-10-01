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
const waveControlPlane = require('../lib/wave-control-plane.cjs');

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
    effort: { level: 'high' },
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
  // mintIsolatedHostContractSession intentionally creates a detached HEAD
  // worktree. Install the files under direct test so this subprocess suite
  // exercises the working-tree implementation, not the pre-change baseline.
  for (const relativePath of [
    '.claude/hooks/context-provider-gate.js',
    'scripts/lib/runtime-collaboration-entrypoints.cjs',
    'scripts/lib/runtime-host-claude.cjs',
    'scripts/lib/runtime-project-context.cjs',
    'scripts/lib/runtime-role-lifecycle/cli-rootsource-handlers.cjs',
    'scripts/lib/runtime-role-lifecycle/consultation-target-recipe.cjs',
    'scripts/lib/runtime-role-lifecycle/ensure-handler.cjs',
    'scripts/lib/runtime-role-lifecycle/lifecycle-action-payloads.cjs',
    'scripts/lib/runtime-role-lifecycle/lifecycle-argv.cjs',
    'scripts/lib/runtime-role-lifecycle/managed-lifecycle-grant.cjs',
    'scripts/lib/runtime-role-lifecycle/runtime-identity.cjs',
    'scripts/lib/wave-control-plane.cjs',
    'skills/sync-l0/retired-artifacts.json',
  ]) {
    fs.mkdirSync(path.dirname(path.join(minted.worktreeRoot, relativePath)), { recursive: true });
    fs.copyFileSync(path.join(REPO_ROOT, relativePath), path.join(minted.worktreeRoot, relativePath));
  }
  assert.ok(runtimeHostClaude.getProductionSessionIdentity(minted.worktreeRoot, sessionId),
    'managed system/init identity must remain verifiable after installing working-tree runtime files');
  return minted;
}

function monitorDocsIntent() {
  return Buffer.from(JSON.stringify({ scope: 'all' })).toString('base64url');
}

function initSessionIntent() {
  return Buffer.from(JSON.stringify({ mode: 'start' })).toString('base64url');
}

function workIntent(waveSlug, overrides) {
  return Buffer.from(JSON.stringify(Object.assign({
    role: 'toolkit-specialist',
    subject_ref: `subject:${'a'.repeat(64)}`,
    task: 'bounded fixture task',
    wave_slug: waveSlug,
  }, overrides || {}))).toString('base64url');
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

function assertDenied(command, cwd, expectedReason, label) {
  const event = baseEvent(command, cwd);
  const result = runHook(event);
  assert.strictEqual(result.status, 0, label + ': hook exit code');
  const body = JSON.parse(result.stdout);
  assert.strictEqual(body.hookSpecificOutput.permissionDecision, 'deny', label + ': permission decision');
  assert.match(body.hookSpecificOutput.permissionDecisionReason, expectedReason, label + ': denial reason');
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

// A human/model-visible init-session call must not require the caller to
// discover Node/root paths or synthesize base64url. The hook owns those values
// and rewrites the closed shorthand through the same canonical admission path.
{
  const sessionId = uniqueSessionId();
  const minted = recordManagedSystemInit(sessionId);
  try {
    const ctx = buildWorktreeContext(minted.worktreeRoot);
    const command = 'node .claude/runtime/l0-entrypoint-launcher.cjs init-session';
    const result = runHookAt(baseEvent(command, ctx.worktreeRoot, sessionId), ctx.hookPath, ctx.worktreeRoot);
    assert.strictEqual(result.status, 0, 'case-3e-init-session-dashboard-shorthand: hook exit code');
    assert.notStrictEqual(result.stdout.trim(), '', 'case-3e-init-session-dashboard-shorthand: expected injection');
    const parsed = runtimeRoleLifecycle.parsePosixDirect(extractRewrittenCommand(result.stdout));
    assert.strictEqual(parsed[0], runtimeRoleLifecycle.resolvedNodePath(),
      'case-3e-init-session-dashboard-shorthand: hook must resolve Node');
    assert.strictEqual(parsed[1], ctx.canonicalEntrypointPath,
      'case-3e-init-session-dashboard-shorthand: hook must resolve the installed runtime target');
    assert.strictEqual(extractFlag(parsed, '--project-root'), ctx.worktreeRoot,
      'case-3e-init-session-dashboard-shorthand: hook must derive the exact consumer root');
    assert.deepStrictEqual(
      JSON.parse(Buffer.from(extractFlag(parsed, '--intent'), 'base64url').toString('utf8')),
      { mode: 'dashboard' },
      'case-3e-init-session-dashboard-shorthand: hook must own the canonical dashboard intent',
    );
    assert.match(extractFlag(parsed, '--host-composition') || '', /^[0-9a-f]{32}$/,
      'case-3e-init-session-dashboard-shorthand: host composition must be injected');
    assert.match(extractFlag(parsed, '--lifecycle-binding') || '', /^[0-9a-f]{32}$/,
      'case-3e-init-session-dashboard-shorthand: dashboard probe lifecycle binding must be injected');
    console.log('PASS: case-3e-init-session-dashboard-shorthand');
    passed += 1;
  } finally {
    minted.cleanup();
  }
}

{
  const sessionId = uniqueSessionId();
  const minted = recordManagedSystemInit(sessionId);
  try {
    const ctx = buildWorktreeContext(minted.worktreeRoot);
    const slug = minted.waveSlug;
    fs.symlinkSync(
      path.join(REPO_ROOT, 'mcp-server', 'node_modules'),
      path.join(ctx.worktreeRoot, 'mcp-server', 'node_modules'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    runtimeCollaborationEntrypoints.planEntrypointStep(
      'init-session', { mode: 'start', wave_slug: slug }, ctx.worktreeRoot,
    );
    const command = 'node .claude/runtime/l0-entrypoint-launcher.cjs init-session --orchestrate ' + slug;
    const result = runHookAt(baseEvent(command, ctx.worktreeRoot, sessionId), ctx.hookPath, ctx.worktreeRoot);
    assert.strictEqual(result.status, 0, 'case-3f-init-session-orchestrate-shorthand: hook exit code');
    assert.notStrictEqual(result.stdout.trim(), '', 'case-3f-init-session-orchestrate-shorthand: expected injection');
    const response = JSON.parse(result.stdout);
    assert.strictEqual(response.hookSpecificOutput.permissionDecision, 'allow',
      'case-3f-init-session-orchestrate-shorthand: expected admission: ' + result.stdout);
    const parsed = runtimeRoleLifecycle.parsePosixDirect(extractRewrittenCommand(result.stdout));
    assert.deepStrictEqual(
      JSON.parse(Buffer.from(extractFlag(parsed, '--intent'), 'base64url').toString('utf8')),
      { mode: 'start', wave_slug: slug },
      'case-3f-init-session-orchestrate-shorthand: hook must own the exact wave intent',
    );
    assert.match(extractFlag(parsed, '--host-composition') || '', /^[0-9a-f]{32}$/,
      'case-3f-init-session-orchestrate-shorthand: host composition must be injected');
    assert.match(extractFlag(parsed, '--lifecycle-binding') || '', /^[0-9a-f]{32}$/,
      'case-3f-init-session-orchestrate-shorthand: lifecycle binding must be injected');
    const execution = spawnSync(parsed[0], parsed.slice(1), {
      cwd: ctx.worktreeRoot, encoding: 'utf8', env: process.env,
    });
    assert.ok([0, 4].includes(execution.status),
      'case-3f-init-session-orchestrate-shorthand: rewritten entrypoint must execute: '
        + execution.stderr + execution.stdout);
    assert.match(JSON.parse(execution.stdout).status, /^(READY|ACTION_REQUIRED)$/,
      'case-3f-init-session-orchestrate-shorthand: exact multi-wave lifecycle must not fail closed');
    console.log('PASS: case-3f-init-session-orchestrate-shorthand');
    passed += 1;
  } finally {
    minted.cleanup();
  }
}

for (const [command, reason, label] of [
  ['node .claude/runtime/l0-entrypoint-launcher.cjs init-session --orchestrate', /closed documented shape/,
    'case-3g-shorthand-missing-slug'],
  ['node .claude/runtime/l0-entrypoint-launcher.cjs init-session --orchestrate ../escape', /closed documented shape/,
    'case-3h-shorthand-traversal-slug'],
  ['node .claude/runtime/l0-entrypoint-launcher.cjs init-session --extra value', /closed documented shape/,
    'case-3i-shorthand-extra-flag'],
  ['node .claude/runtime/l0-entrypoint-launcher.cjs init-session; echo bypass', /closed documented shape/,
    'case-3j-shorthand-shell-chain'],
]) {
  assertDenied(command, REPO_ROOT, reason, label);
  passed += 1;
}

// Case 4: the exact relative token remains recognizable outside its owner cwd
// and is denied fail-closed instead of falling through to ordinary approval.
{
  const command = 'node ' + RELATIVE_ENTRYPOINT_CLI_PATH + ' execute --entrypoint monitor-docs --project-root '
    + PORTABLE_REPO_ROOT + ' --intent ' + monitorDocsIntent();
  assertDenied(
    command,
    path.resolve(REPO_ROOT, '..'),
    /\[R131\/P3\] L0 relative collaboration entrypoint is foreign\./,
    'case-4-mismatched-cwd',
  );
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

// context-provider-gate.js's own ENTRYPOINT_WINDOWS_TOKEN_RE (and its
// docblock: "Claude emits that command with a double-quoted native
// project-root on Windows") only matches a quoted token that begins with a
// Windows drive letter ([A-Za-z]:[\\/]) -- a documented, deliberately
// Windows-only recognition path, not a guess from this case's name. A POSIX
// absolute path never has a drive letter, so the identical double-quoted
// construction can never be recognized on any other platform; asserting that
// is a positive cross-platform boundary proof, not a skip.
{
  if (process.platform === 'win32') {
    assertAdmittedAndConsume('case-7-claude-windows-double-quoted-project-root', (ctx) =>
      'node ' + RELATIVE_ENTRYPOINT_CLI_PATH + ' execute --entrypoint monitor-docs --project-root "'
        + ctx.worktreeRoot + '" --intent ' + monitorDocsIntent());
  } else {
    const command = 'node ' + RELATIVE_ENTRYPOINT_CLI_PATH + ' execute --entrypoint monitor-docs --project-root "'
      + REPO_ROOT + '" --intent ' + monitorDocsIntent();
    assertNoInjection(command, REPO_ROOT, 'case-7-posix-double-quoted-project-root-not-windows-shape');
  }
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

// Case 8b: a recognized /work request in PREP must preserve the stable,
// actionable control-plane reason rather than hiding it behind the generic
// entrypoint error. Unexpected planning failures remain generic.
{
  const sessionId = uniqueSessionId();
  const minted = recordManagedSystemInit(sessionId);
  try {
    const ctx = buildWorktreeContext(minted.worktreeRoot);
    fs.symlinkSync(
      path.join(REPO_ROOT, 'mcp-server', 'node_modules'),
      path.join(ctx.worktreeRoot, 'mcp-server', 'node_modules'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    waveControlPlane.initialize(ctx.worktreeRoot, minted.waveSlug);
    const commandFor = (intent) => runtimeRoleLifecycle.renderPosixDirect([
      process.execPath, ctx.canonicalEntrypointPath, 'execute',
      '--entrypoint', 'work', '--project-root', ctx.worktreeRoot, '--intent', intent,
    ]);
    const phaseResult = runHookAt(
      baseEvent(commandFor(workIntent(minted.waveSlug)), ctx.worktreeRoot, sessionId),
      ctx.hookPath,
      ctx.worktreeRoot,
    );
    const phaseBody = JSON.parse(phaseResult.stdout);
    assert.strictEqual(phaseBody.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(phaseBody.hookSpecificOutput.permissionDecisionReason,
      /wave-control-work-outside-execute: \/work is available only during EXECUTE/);
    console.log('PASS: case-8b-work-prep-preserves-recovery-diagnostic');
    passed += 1;

    const genericResult = runHookAt(
      baseEvent(commandFor(workIntent(minted.waveSlug, { role: null })), ctx.worktreeRoot, sessionId),
      ctx.hookPath,
      ctx.worktreeRoot,
    );
    const genericBody = JSON.parse(genericResult.stdout);
    assert.strictEqual(genericBody.hookSpecificOutput.permissionDecision, 'deny');
    assert.strictEqual(genericBody.hookSpecificOutput.permissionDecisionReason,
      '[R131/P3] collaboration entrypoint intent or scope is invalid.');
    console.log('PASS: case-8c-unexpected-planning-error-remains-generic');
    passed += 1;
  } finally {
    minted.cleanup();
  }
}

assert.strictEqual(passed, 19);

// Case 9: the production SessionStart hook must emit only a bounded reason and fail closed
// when invoked from an ordinary test process whose ancestry contains no
// executable matching the signed Claude host certificate.
{
  const sessionId = uniqueSessionId();
  const event = {
    hook_event_name: 'SessionStart', source: 'startup', session_id: sessionId,
    transcript_path: path.join(os.tmpdir(), 'r131-p4-no-persist-transcript-' + crypto.randomBytes(8).toString('hex') + '.jsonl'),
    cwd: REPO_ROOT, model: 'claude-sonnet-5',
  };
  const result = spawnSync(process.execPath, [SESSION_START_HOOK_PATH], {
    input: JSON.stringify(event), encoding: 'utf8', cwd: REPO_ROOT,
    env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: REPO_ROOT }),
    timeout: 25000,
  });
  assert.strictEqual(result.status, 0, 'case-9-unpinned-session-start: hook exit code');
  assert.strictEqual(result.stdout.trim(), '', 'case-9-unpinned-session-start: hook stdout must stay silent');
  assert.match(result.stderr, /^\[runtime-host-session-start\] [A-Z0-9_]+\n$/,
    'case-9-unpinned-session-start: stderr must expose only the bounded failure code');
  assert.strictEqual(runtimeHostClaude.getProductionSessionIdentity(REPO_ROOT, sessionId).ok, false,
    'case-9-unpinned-session-start: no interactive identity evidence may be minted');
  console.log('PASS: case-9-unpinned-session-start');
  passed += 1;
}

// Desktop Code-tab sessions run in a managed linked worktree while CLAUDE_PROJECT_DIR names the main checkout.
// The consumer root stays cwd; only a registered linked worktree of the SAME repository is additionally admitted.
function runShorthandFrom(cwd, projectDirEnv, hookPath, sessionId) {
  const event = baseEvent('node .claude/runtime/l0-entrypoint-launcher.cjs init-session', cwd, sessionId);
  return spawnSync(process.execPath, [hookPath], {
    input: JSON.stringify(event), encoding: 'utf8', cwd,
    env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: projectDirEnv }),
  });
}

function gitIn(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.strictEqual(result.status, 0, 'git ' + args.join(' ') + ': ' + result.stderr);
  return result.stdout.trim();
}

function makeScratchRepo() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'r131-worktree-repo-')));
  gitIn(dir, ['init', '-q']);
  gitIn(dir, ['config', 'user.email', 'wt@test.local']);
  gitIn(dir, ['config', 'user.name', 'WT']);
  gitIn(dir, ['commit', '-q', '--allow-empty', '-m', 'init']);
  return dir;
}

function assertForeignShorthand(label, cwd, projectDirEnv) {
  const result = runShorthandFrom(cwd, projectDirEnv, HOOK_PATH, uniqueSessionId());
  assert.strictEqual(result.status, 0, label + ': hook exit code');
  const body = JSON.parse(result.stdout);
  assert.strictEqual(body.hookSpecificOutput.permissionDecision, 'deny', label + ': must be denied: ' + result.stdout);
  assert.match(body.hookSpecificOutput.permissionDecisionReason, /project root is unresolved or foreign/, label);
  console.log('PASS: ' + label);
}

{
  const sessionId = uniqueSessionId();
  const minted = recordManagedSystemInit(sessionId);
  try {
    const ctx = buildWorktreeContext(minted.worktreeRoot);
    const result = runShorthandFrom(ctx.worktreeRoot, REPO_ROOT, ctx.hookPath, sessionId);
    assert.strictEqual(result.status, 0, 'case-10-managed-worktree-shorthand: hook exit code');
    const body = JSON.parse(result.stdout);
    assert.strictEqual(body.hookSpecificOutput.permissionDecision, 'allow',
      'case-10-managed-worktree-shorthand: a registered linked worktree of the same repository is admitted: ' + result.stdout);
    const parsed = runtimeRoleLifecycle.parsePosixDirect(extractRewrittenCommand(result.stdout));
    assert.strictEqual(extractFlag(parsed, '--project-root'), ctx.worktreeRoot,
      'case-10-managed-worktree-shorthand: the consumer root stays cwd, never CLAUDE_PROJECT_DIR');
    console.log('PASS: case-10-managed-worktree-shorthand');
    passed += 1;
  } finally {
    minted.cleanup();
  }
}

{
  const other = makeScratchRepo();
  const unregistered = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'r131-unregistered-')));
  const foreignWorktree = path.join(other + '-wt');
  try {
    assertForeignShorthand('case-11-unrelated-repo-cwd-is-rejected', other, REPO_ROOT);
    passed += 1;
    assertForeignShorthand('case-12-unregistered-directory-is-rejected', unregistered, REPO_ROOT);
    passed += 1;
    gitIn(other, ['worktree', 'add', '-q', '--detach', foreignWorktree]);
    assertForeignShorthand('case-13-worktree-of-a-different-repository-is-rejected', fs.realpathSync(foreignWorktree), REPO_ROOT);
    passed += 1;
    const link = path.join(os.tmpdir(), 'r131-symlinked-cwd-' + crypto.randomBytes(4).toString('hex'));
    fs.symlinkSync(REPO_ROOT, link, process.platform === 'win32' ? 'junction' : 'dir');
    try {
      assertForeignShorthand('case-14-symlinked-cwd-is-rejected', link, REPO_ROOT);
      passed += 1;
    } finally { fs.rmSync(link, { force: true }); }
  } finally {
    fs.rmSync(unregistered, { recursive: true, force: true });
    try { gitIn(other, ['worktree', 'remove', '--force', foreignWorktree]); } catch { /* best effort */ }
    fs.rmSync(other, { recursive: true, force: true });
  }
}

// A class/sentinel defect in the wave must tell the operator what to fix instead of the generic scope error, while every
// other exception stays generic (no paths or host details).
function orchestrateDenialAfter(label, mutate, { initialize = false, entrypoint = 'init-session' } = {}) {
  const sessionId = uniqueSessionId();
  const minted = recordManagedSystemInit(sessionId);
  try {
    const ctx = buildWorktreeContext(minted.worktreeRoot);
    const slug = minted.waveSlug;
    if (initialize || entrypoint !== 'init-session') {
      fs.symlinkSync(
        path.join(REPO_ROOT, 'mcp-server', 'node_modules'),
        path.join(ctx.worktreeRoot, 'mcp-server', 'node_modules'),
        process.platform === 'win32' ? 'junction' : 'dir',
      );
    }
    if (initialize) waveControlPlane.initialize(ctx.worktreeRoot, slug);
    const waveDir = path.join(ctx.worktreeRoot, '.planning', 'wave-' + slug);
    mutate({ waveDir, plan: path.join(waveDir, 'PLAN.md'), sentinel: path.join(waveDir, 'CLASS') });
    const command = entrypoint === 'init-session'
      ? 'node .claude/runtime/l0-entrypoint-launcher.cjs init-session --orchestrate ' + slug
      : runtimeRoleLifecycle.renderPosixDirect([
        process.execPath, ctx.canonicalEntrypointPath, 'execute',
        '--entrypoint', entrypoint, '--project-root', ctx.worktreeRoot, '--intent', workIntent(slug),
      ]);
    const result = runHookAt(baseEvent(command, ctx.worktreeRoot, sessionId), ctx.hookPath, ctx.worktreeRoot);
    assert.strictEqual(result.status, 0, label + ': hook exit code');
    const body = JSON.parse(result.stdout);
    assert.strictEqual(body.hookSpecificOutput.permissionDecision, 'deny', label + ': ' + result.stdout);
    return body.hookSpecificOutput.permissionDecisionReason;
  } finally {
    minted.cleanup();
  }
}

const rewritePlan = (transform) => ({ plan }) => fs.writeFileSync(plan, transform(fs.readFileSync(plan, 'utf8')));
const CLASS_LINE = /^[ \t]*(?:-[ \t]+)?\*\*Class\*\*:.*$/m;
const CLASS_DENIALS = [
  ['WAVE_CLASS_SECTION_MISSING', rewritePlan((t) => t.replace(/^#{2,3}[ \t]+Wave[ \t]+Class[ \t]*$/m, '### Wave Klass')), /Wave Class.*section/i],
  ['WAVE_CLASS_SECTION_AMBIGUOUS', rewritePlan((t) => t + '\n### Wave Class\n- **Class**: HARNESS\n'), /more than one.*Wave Class/i],
  ['PLAN_WAVE_CLASS_MISSING', rewritePlan((t) => t.replace(CLASS_LINE, '')), /\*\*Class\*\*/],
  ['PLAN_WAVE_CLASS_AMBIGUOUS', rewritePlan((t) => t.replace(CLASS_LINE, (m) => m + '\n' + m)), /more than one.*\*\*Class\*\*/i],
  ['INVALID_WAVE_CLASS', rewritePlan((t) => t.replace(CLASS_LINE, '- **Class**: BOGUS')), /HARNESS, DOC or FAST-PATH/],
  ['WAVE_CLASS_SENTINEL_MISSING', ({ sentinel }) => fs.rmSync(sentinel), /write \.planning\/wave-<slug>\/CLASS/],
  ['INVALID_WAVE_CLASS_SENTINEL', ({ sentinel }) => fs.writeFileSync(sentinel, 'BOGUS\n'), /CLASS must contain/],
];
for (const [code, mutate, guidance] of CLASS_DENIALS) {
  const reason = orchestrateDenialAfter('case-15-' + code, mutate);
  assert.ok(reason.includes(code), code + ' must be named: ' + reason);
  assert.match(reason, guidance, code + ' must say how to recover: ' + reason);
  assert.ok(!reason.includes('intent or scope is invalid'), code + ' must not be the generic message: ' + reason);
  console.log('PASS: case-15-' + code);
  passed += 1;
}
{
  const reason = orchestrateDenialAfter('case-16-unknown-exception-stays-generic', ({ plan }) => {
    fs.rmSync(plan);
    fs.mkdirSync(plan); // reading a directory throws EISDIR, which is not an allowlisted code
  });
  assert.match(reason, /collaboration entrypoint intent or scope is invalid/, reason);
  assert.ok(!/EISDIR|illegal operation|\.planning|\/tmp|\/private/.test(reason), 'no host detail may leak: ' + reason);
  console.log('PASS: case-16-unknown-exception-stays-generic');
  passed += 1;
}

// A wave whose HEAD, PLAN or state moved after it was bound must say how to recover, not hit the generic scope error.
{
  const DRIFT_DENIALS = [
    ['wave-control-state-drift', { initialize: true }, ({ plan }) => gitIn(path.dirname(path.dirname(path.dirname(plan))), ['commit', '-q', '--allow-empty', '-m', 'test: move head']), /start a new wave slug/],
    ['wave-control-plan-drift', { initialize: true }, ({ plan }) => fs.appendFileSync(plan, '\nA line added after the wave was initialized.\n'), /start a new wave slug for the changed PLAN/],
    ['wave-control-state-missing', { entrypoint: 'work' }, () => {}, /wave-control init command/],
  ];
  for (const [code, options, mutate, guidance] of DRIFT_DENIALS) {
    const reason = orchestrateDenialAfter('case-17-' + code, mutate, options);
    assert.ok(reason.includes(code), code + ' must be named: ' + reason);
    assert.match(reason, guidance, code + ' must say how to recover: ' + reason);
    assert.ok(!reason.includes('intent or scope is invalid'), code + ' must not be the generic message: ' + reason);
    console.log('PASS: case-17-' + code);
    passed += 1;
  }
}

assert.strictEqual(passed, 36);

console.log('36/36 PASS');
