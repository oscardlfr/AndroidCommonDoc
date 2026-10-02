'use strict';

// Every runtime command whose authority a hook mints must arrive as the canonical standalone form. A recognizable
// invocation that is chained (`date; node …; date`), placed behind a heredoc or quoted another way would reach the CLI
// without a grant and fail with an opaque AUTHORITY_INVALID. One shared rule denies it with the recovery. This file
// pins the rule for every family, position and quoting, at the helper and at the real hooks.

const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

const rll = require('../lib/runtime-role-lifecycle.cjs');
const { chainedRuntimeInvocation, standaloneRuntimeCommandMessage } = require('../../.claude/hooks/hook-control-plane-utils.js');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CONSULTATION_CLI = path.join(REPO_ROOT, 'scripts', 'lib', 'runtime-consultation.cjs');
const LIFECYCLE_CLI = path.join(REPO_ROOT, 'scripts', 'lib', 'runtime-role-lifecycle.cjs');
const CLIS = [
  { path: CONSULTATION_CLI, subcommands: ['publish-request', 'dispatch', 'accept-result', 'claim', 'lease-heartbeat', 'publish-result'] },
  { path: LIFECYCLE_CLI, subcommands: ['ensure', 'ready'] },
];
const detect = (command) => chainedRuntimeInvocation(command, { parseDirect: rll.parsePosixDirect, canonicalClis: CLIS });

const LAUNCHER = '.claude/runtime/l0-toolkit-launcher.cjs';
const launcherArgv = (operation) => ['node', LAUNCHER, 'run', 'runtime-consult', '--project-root', '/consumer', '--', operation, '--coordination-root', '/consumer/.planning/coordination'];
const cliArgv = (cli, operation) => ['node', cli, operation, '--request', '/consumer/request.json'];

// Each family: the canonical form (must pass untouched) and how its operation is spelled in the three quotings.
const FAMILIES = [
  ...['consult', 'record-delivery', 'await-result', 'accept-result'].map((op) => ({ name: 'launcher ' + op, op, argv: launcherArgv(op) })),
  ...['claim', 'lease-heartbeat', 'publish-result', 'accept-result'].map((op) => ({ name: 'consultation CLI ' + op, op, argv: cliArgv(CONSULTATION_CLI, op) })),
  ...['ensure', 'ready'].map((op) => ({ name: 'lifecycle CLI ' + op, op, argv: cliArgv(LIFECYCLE_CLI, op) })),
];
const quotings = (argv) => ({
  single: rll.renderPosixDirect(argv),
  double: argv.map((token) => '"' + token + '"').join(' '),
  none: argv.join(' '),
});

test('the canonical single-quoted standalone form is never reported', () => {
  for (const family of FAMILIES) assert.strictEqual(detect(quotings(family.argv).single), null, family.name);
});

test('a recognized invocation with a command before, after or both is reported in every quoting', () => {
  for (const family of FAMILIES) {
    for (const [quoting, command] of Object.entries(quotings(family.argv))) {
      const forms = [
        'date -u +%Y-%m-%dT%H:%M:%SZ; ' + command,
        command + '; date -u',
        'date -u; ' + command + '; date -u; stat -f %Sm /tmp/x',
        'cd /consumer && ' + command,
        command + ' | tee /tmp/out',
        "cat > /tmp/f <<'EOF'\nresult\nEOF\n" + command,
        'echo $(' + command + ')',
      ];
      for (const form of forms) {
        const found = detect(form);
        assert.ok(found && found.operation === family.op, `${family.name} (${quoting}): ${JSON.stringify(form)} -> ${JSON.stringify(found)}`);
      }
    }
  }
});

test('the exact accept-result command from the L1 transcript is reported', () => {
  const command = "date -u +%Y-%m-%dT%H:%M:%SZ; 'node' '.claude/runtime/l0-toolkit-launcher.cjs' 'run' 'runtime-consult' '--project-root' '/consumer' '--' 'accept-result' '--coordination-root' '/consumer/.planning/coordination' '--request' '/consumer/.planning/coordination/r/request.json'; date -u +%Y-%m-%dT%H:%M:%SZ; stat -f '%Sm' -t %Y-%m-%dT%H:%M:%S /tmp/x";
  assert.deepStrictEqual(detect(command), { family: 'consult-launcher', operation: 'accept-result' });
});

test('a quoted question that contains shell characters is data, not a chain', () => {
  const command = rll.renderPosixDirect(launcherArgv('consult').concat(['--question', 'does a; b && c | d $(e) hold?']));
  assert.strictEqual(detect(command), null);
});

test('unrelated commands, with or without shell operators, and mere mentions are not reported', () => {
  for (const command of [
    'echo hi; ls', 'git status && git diff | head', 'cat docs/guides/local-ci-validation.md',
    `git commit -m "docs: node ${CONSULTATION_CLI} publish-result"`, `grep -n publish-result ${CONSULTATION_CLI}`,
    `ls ${CONSULTATION_CLI}; echo done`, 'node scripts/tools/wave-control-plane.cjs status --slug demo; echo ok',
    "node .claude/runtime/l0-toolkit-launcher.cjs run wave-control --project-root \"$PWD\" -- status --slug demo",
  ]) assert.strictEqual(detect(command), null, command);
});

test('a family that is not requested is not recognized (the target gate asks for its own CLI only)', () => {
  const chained = 'date; ' + rll.renderPosixDirect(launcherArgv('accept-result'));
  assert.strictEqual(chainedRuntimeInvocation(chained, { parseDirect: rll.parsePosixDirect, launchers: false, canonicalClis: [CLIS[0]] }), null);
  assert.ok(chainedRuntimeInvocation(chained, { parseDirect: rll.parsePosixDirect, canonicalClis: [CLIS[0]] }));
});

test('the recovery names the operation and, for publish-result, how to pass the content', () => {
  assert.match(standaloneRuntimeCommandMessage('accept-result'), /^run accept-result as ONE standalone command \(no heredoc, pipe, &&, ;, \$\(\.\.\.\)\)/);
  assert.match(standaloneRuntimeCommandMessage('publish-result'), /Write tool.*base64url.*--content/);
});

function runGate(hook, command) {
  const result = spawnSync(process.execPath, [path.join(REPO_ROOT, '.claude', 'hooks', hook)], {
    encoding: 'utf8', cwd: REPO_ROOT,
    env: { ...process.env, CLAUDE_PROJECT_DIR: REPO_ROOT, TMPDIR: os.tmpdir() },
    input: JSON.stringify({
      hook_event_name: 'PreToolUse', tool_name: 'Bash', session_id: 'shape-session', agent_id: 'shape-agent',
      agent_type: 'arch-platform', tool_input: { command },
    }),
  });
  assert.strictEqual(result.status, 0, result.stderr);
  return result.stdout ? JSON.parse(result.stdout).hookSpecificOutput : null;
}

test('context-provider-gate denies the chained requester and lifecycle forms with the recovery', () => {
  // `ready` and the target operations belong to the target gate, which is covered below.
  for (const family of FAMILIES.filter((f) => !['claim', 'lease-heartbeat', 'publish-result', 'ready'].includes(f.op) || f.name.startsWith('launcher'))) {
    const out = runGate('context-provider-gate.js', 'date -u; ' + quotings(family.argv).single + '; date -u');
    assert.ok(out && out.permissionDecision === 'deny' && out.permissionDecisionReason.includes('run ' + family.op + ' as ONE standalone command'),
      family.name + ': ' + JSON.stringify(out));
  }
});

test('runtime-consultation-target-gate denies the chained target forms with the recovery', () => {
  for (const op of ['claim', 'lease-heartbeat', 'publish-result']) {
    const out = runGate('runtime-consultation-target-gate.js', "cat > /tmp/f <<'EOF'\nx\nEOF\n" + quotings(cliArgv(CONSULTATION_CLI, op)).single);
    assert.ok(out && out.permissionDecision === 'deny' && out.permissionDecisionReason.includes('run ' + op + ' as ONE standalone command'), op + ': ' + JSON.stringify(out));
  }
});
