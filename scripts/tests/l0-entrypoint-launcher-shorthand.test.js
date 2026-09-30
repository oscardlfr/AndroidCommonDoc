'use strict';

// The bare `init-session` shorthand is rewritten only by the Claude Code PreToolUse hook. Any other host (Codex, a plain
// shell) reaches the launcher with the shorthand untouched; it must say so instead of the opaque closed-argv error.

const assert = require('node:assert');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

const launcher = path.resolve(__dirname, '..', '..', '.claude', 'runtime', 'l0-entrypoint-launcher.cjs');
const MESSAGE = '/init-session runs only from Claude Code (CLI or desktop app, Sonnet 5.5, effort High); Codex is not a supported entrypoint host';

function run(args) {
  return spawnSync(process.execPath, [launcher, ...args], { encoding: 'utf8', cwd: path.dirname(launcher) });
}

test('the bare shorthand reports that entrypoints run only from Claude Code', () => {
  for (const args of [['init-session'], ['init-session', '--orchestrate', 'some-wave'], ['resume-work']]) {
    const result = run(args);
    assert.strictEqual(result.status, 1, args.join(' '));
    assert.ok(result.stderr.includes(MESSAGE), args.join(' ') + ': ' + result.stderr);
    assert.ok(!result.stderr.includes('expected the closed'), 'the opaque error must not be the message');
  }
});

test('a malformed closed argv and an unknown word keep the original rejection', () => {
  for (const args of [['execute'], ['execute', '--entrypoint', 'init-session'], ['not-an-entrypoint'], []]) {
    const result = run(args);
    assert.strictEqual(result.status, 1, args.join(' '));
    assert.ok(result.stderr.includes('expected the closed execute/entrypoint/project-root/intent argv'), result.stderr);
    assert.ok(!result.stderr.includes('Codex'), 'no Codex guidance for a malformed canonical argv');
  }
});
