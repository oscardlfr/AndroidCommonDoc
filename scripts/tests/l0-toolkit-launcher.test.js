'use strict';

const assert = require('node:assert');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');
const launcher = require(path.join(ROOT, '.claude/runtime/l0-toolkit-launcher.cjs'));

test('Windows selects the declared PowerShell implementation instead of Bash', () => {
  const selected = launcher.selectToolInvocation(launcher.TOOL_SPECS['test-full'], 'win32');
  assert.strictEqual(selected.executable, 'pwsh.exe');
  assert.strictEqual(selected.targetRelative, 'scripts/ps1/run-parallel-coverage-suite.ps1');
  assert.deepStrictEqual(selected.prefixArgs, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File']);
  assert.strictEqual(selected.windows, true);
});

test('Windows rejects a shell operation that has no PowerShell implementation', () => {
  assert.throws(
    () => launcher.selectToolInvocation(launcher.TOOL_SPECS['verdict-write'], 'win32'),
    /no Windows implementation/,
  );
});

test('Node operations remain Node operations on Windows', () => {
  const selected = launcher.selectToolInvocation(launcher.TOOL_SPECS['runtime-consumer-qg'], 'win32');
  assert.strictEqual(selected.executable, process.execPath);
  assert.strictEqual(selected.targetRelative, 'scripts/lib/runtime-consumer-quality-gate.cjs');
  assert.strictEqual(selected.windows, false);
});

test('PowerShell arguments translate GNU-style flags without touching values', () => {
  assert.deepStrictEqual(
    launcher.normalizeWindowsArgs(['--fresh-daemon', '--min-lines', '5', '--module-filter=core-domain', 'value']),
    ['-FreshDaemon', '-MinMissedLines', '5', '-ModuleFilter', 'core-domain', 'value'],
  );
});

test('PowerShell bridge wrappers retain GNU arguments for their Bash delegate', () => {
  const spec = launcher.TOOL_SPECS['qg-doc-validators'];
  assert.deepStrictEqual(
    launcher.adaptWindowsArgs(spec, ['--only', 'structure', '--project-root', 'C:\\repo']),
    ['--only', 'structure', '--project-root', 'C:\\repo'],
  );
});

test('commit tokens receive consumer and toolkit roots from the launcher', () => {
  const spec = launcher.TOOL_SPECS['commit-tokens'];
  assert.strictEqual(spec.injectProjectAndToolkitRoots, true);
  assert.strictEqual(spec.injectProjectRoot, undefined);
  const selected = launcher.selectToolInvocation(spec, 'win32');
  assert.strictEqual(selected.targetRelative, 'scripts/ps1/list-valid-commit-tokens.ps1');
  assert.strictEqual(spec.windowsArgumentStyle, 'gnu');
});

test('native PowerShell implementations receive PowerShell parameter names', () => {
  const spec = launcher.TOOL_SPECS['test-full'];
  assert.deepStrictEqual(
    launcher.adaptWindowsArgs(spec, ['--fresh-daemon', '--project-root', 'C:\\repo']),
    ['-FreshDaemon', '-ProjectRoot', 'C:\\repo'],
  );
});

test('signal termination maps to the conventional 128 plus signal exit status', () => {
  assert.strictEqual(launcher.signalExitCode('SIGTERM'), 143);
  assert.strictEqual(launcher.signalExitCode('SIGINT'), 130);
  assert.strictEqual(launcher.signalExitCode('NOT_A_SIGNAL'), 1);
});

test('every launcher operation target belongs to the runtime executable inventory', () => {
  const runtimeContext = require(path.join(ROOT, 'scripts/lib/runtime-project-context.cjs'));
  const inventory = runtimeContext.computeRuntimeToolkitInventory(ROOT);
  assert.strictEqual(inventory.ok, true, JSON.stringify(inventory));
  const paths = new Set(inventory.entries.map((entry) => entry.relative_path));
  for (const [id, spec] of Object.entries(launcher.TOOL_SPECS)) {
    assert.ok(paths.has(spec.relative), `${id} POSIX/Node target missing from runtime inventory: ${spec.relative}`);
    if (spec.windowsRelative) {
      assert.ok(paths.has(spec.windowsRelative), `${id} Windows target missing from runtime inventory: ${spec.windowsRelative}`);
    }
  }
});
