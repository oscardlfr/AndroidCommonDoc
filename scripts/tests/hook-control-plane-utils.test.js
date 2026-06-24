#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  isValidSlug,
  slugFromBranch,
  getWaveSlug,
  loadYaml,
} = require('../../.claude/hooks/hook-control-plane-utils');

function mkRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hcpu-'));
  spawnSync('git', ['init', '-q'], { cwd: root });
  spawnSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: root });
  spawnSync('git', ['config', 'user.name', 'Hook Utils Test'], { cwd: root });
  spawnSync('git', ['commit', '--allow-empty', '-q', '-m', 'init'], { cwd: root });
  return root;
}

function checkout(root, branch) {
  const result = spawnSync('git', ['checkout', '-B', branch, '-q'], { cwd: root, encoding: 'utf8' });
  assert.strictEqual(result.status, 0, result.stderr);
}

function withEnv(name, value, fn) {
  const old = process.env[name];
  if (value == null) delete process.env[name];
  else process.env[name] = value;
  try {
    fn();
  } finally {
    if (old == null) delete process.env[name];
    else process.env[name] = old;
  }
}

assert.strictEqual(isValidSlug('bl-w47.test_1'), true);
assert.strictEqual(isValidSlug(''), false);
assert.strictEqual(isValidSlug('.'), false);
assert.strictEqual(isValidSlug('..'), false);
assert.strictEqual(isValidSlug('../evil'), false);
assert.strictEqual(isValidSlug('bad\\slug'), false);

assert.strictEqual(slugFromBranch('feature/bl-w47-demo'), 'bl-w47-demo');
assert.strictEqual(slugFromBranch('codex/bl-w47-demo'), 'bl-w47-demo');
assert.strictEqual(slugFromBranch('wip'), 'wip');
assert.strictEqual(slugFromBranch('develop'), null);
assert.strictEqual(slugFromBranch('feature/bad\\slug'), null);

const repo = mkRepo();
try {
  checkout(repo, 'codex/bl-w47-demo');

  withEnv('CLAUDE_WAVE_SLUG', '../evil', () => {
    assert.strictEqual(getWaveSlug(repo), 'bl-w47-demo');
  });

  withEnv('CLAUDE_WAVE_SLUG', 'develop', () => {
    assert.strictEqual(getWaveSlug(repo), 'bl-w47-demo');
    assert.strictEqual(getWaveSlug(repo, { protectedEnvReturnsNull: true }), null);
  });

  withEnv('CLAUDE_WAVE_SLUG', 'env-slug', () => {
    assert.strictEqual(getWaveSlug(repo), 'env-slug');
    assert.strictEqual(
      getWaveSlug(repo, { useEnv: false, useAlias: false }),
      'bl-w47-demo',
    );
  });
} finally {
  fs.rmSync(repo, { recursive: true, force: true });
}

const aliasRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hcpu-alias-'));
try {
  const waveDir = path.join(aliasRoot, '.planning', 'wave-alias-one');
  fs.mkdirSync(waveDir, { recursive: true });
  fs.writeFileSync(path.join(waveDir, 'PLAN.md'), '# plan\n');
  withEnv('CLAUDE_WAVE_SLUG', null, () => {
    assert.strictEqual(getWaveSlug(aliasRoot), 'alias-one');
  });
} finally {
  fs.rmSync(aliasRoot, { recursive: true, force: true });
}

const yaml = loadYaml(path.resolve(__dirname, '..', '..'));
assert.ok(yaml && typeof yaml.parse === 'function', 'loadYaml should resolve repo-local yaml package');

console.log('hook-control-plane-utils tests passed');
