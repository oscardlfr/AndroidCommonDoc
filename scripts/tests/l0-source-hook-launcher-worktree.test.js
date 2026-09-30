'use strict';

// Desktop Code-tab sessions run in a managed linked worktree while CLAUDE_PROJECT_DIR names the main checkout. Every
// consumer hook reaches L0 through l0-source-hook-launcher.js, so that one file decides the session root: the event cwd
// when it is a registered linked worktree of the SAME repository, otherwise the declared root, exactly as before.
// Observable effect: the consult launcher form carries an absolute --project-root that the gate compares with its root.

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { installConsumerFixture } = require('./lib/consumer-runtime-fixture.cjs');

const FOREIGN_ROOT = /launcher or project root is missing, foreign or unsafe/;
const NOT_QUALIFIED = /not qualified/;

function git(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.strictEqual(result.status, 0, args.join(' ') + ': ' + result.stderr);
  return result.stdout.trim();
}

function consultCommand(root) {
  return ['node', '.claude/runtime/l0-toolkit-launcher.cjs', 'run', 'runtime-consult', '--project-root', root, '--', 'consult',
    '--coordination-root', path.join(root, '.planning', 'coordination'), '--question', 'root?']
    .map((token) => "'" + token.replace(/'/g, "'\\''") + "'").join(' ');
}

function gateReason(fixture, cwd, projectRootToken) {
  const launcher = path.join(fixture.consumerRoot, '.claude', 'hooks', 'l0-source-hook-launcher.js');
  const event = {
    hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: consultCommand(projectRootToken) },
    session_id: 'launcher-worktree', agent_type: 'arch-testing', agent_id: 'arch-testing', cwd,
  };
  const result = spawnSync(process.execPath, [launcher, 'context-provider-gate.js'], {
    cwd: fixture.consumerRoot, input: JSON.stringify(event), encoding: 'utf8',
    env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: fixture.consumerRoot }),
  });
  assert.strictEqual(result.status, 0, result.stderr);
  const body = JSON.parse(result.stdout);
  assert.strictEqual(body.hookSpecificOutput.permissionDecision, 'deny');
  return body.hookSpecificOutput.permissionDecisionReason;
}

test('a registered linked worktree of the same repository becomes the session root; nothing else does', () => {
  const fixture = installConsumerFixture('L2');
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hook-launcher-wt-')));
  try {
    git(fixture.consumerRoot, 'add', '-A');
    git(fixture.consumerRoot, '-c', 'user.email=t@t.local', '-c', 'user.name=T', 'commit', '-q', '-m', 'consumer install');
    const worktree = path.join(fixture.consumerRoot, '.claude', 'worktrees', 'session');
    git(fixture.consumerRoot, 'worktree', 'add', '-q', '-b', 'feature/session', worktree);
    const linked = fs.realpathSync(worktree);

    // Accepted: the worktree is the root, so the gate no longer sees a foreign --project-root.
    const accepted = gateReason(fixture, linked, linked);
    assert.ok(!FOREIGN_ROOT.test(accepted) && !NOT_QUALIFIED.test(accepted), 'a registered worktree is the session root: ' + accepted);

    // Control: without a worktree cwd the declared root stays and a worktree --project-root is foreign.
    assert.match(gateReason(fixture, fixture.consumerRoot, linked), FOREIGN_ROOT);

    // Rejected: an unrelated repository, an unregistered directory, a symlink to the worktree.
    const unrelated = path.join(scratch, 'unrelated');
    fs.mkdirSync(unrelated);
    git(unrelated, 'init', '-q');
    const unregistered = path.join(scratch, 'unregistered');
    fs.mkdirSync(unregistered);
    const link = path.join(scratch, 'link');
    fs.symlinkSync(linked, link, process.platform === 'win32' ? 'junction' : 'dir');
    for (const [label, cwd, token] of [['unrelated repository', fs.realpathSync(unrelated), fs.realpathSync(unrelated)],
      ['unregistered directory', fs.realpathSync(unregistered), fs.realpathSync(unregistered)], ['symlinked cwd', link, linked]]) {
      assert.match(gateReason(fixture, cwd, token), FOREIGN_ROOT, label + ' must not change the root');
    }

    // A worktree of a different repository is not the same repository.
    git(unrelated, '-c', 'user.email=t@t.local', '-c', 'user.name=T', 'commit', '-q', '--allow-empty', '-m', 'init');
    const foreignWorktree = path.join(scratch, 'foreign-wt');
    git(unrelated, 'worktree', 'add', '-q', '-b', 'other', foreignWorktree);
    const foreignLinked = fs.realpathSync(foreignWorktree);
    assert.match(gateReason(fixture, foreignLinked, foreignLinked), FOREIGN_ROOT, 'another repository\'s worktree must not change the root');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(fixture.consumerRoot, { recursive: true, force: true });
  }
});

test('non-JSON hook input keeps the declared root and does not crash the launcher', () => {
  const fixture = installConsumerFixture('L2');
  try {
    const launcher = path.join(fixture.consumerRoot, '.claude', 'hooks', 'l0-source-hook-launcher.js');
    const result = spawnSync(process.execPath, [launcher, 'tool-use-logger.js'], {
      cwd: fixture.consumerRoot, input: 'not json', encoding: 'utf8',
      env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: fixture.consumerRoot }),
    });
    assert.ok(!/l0-source-hook-launcher\] (consumer project root|hook input)/.test(result.stderr), result.stderr);
  } finally {
    fs.rmSync(fixture.consumerRoot, { recursive: true, force: true });
  }
});
