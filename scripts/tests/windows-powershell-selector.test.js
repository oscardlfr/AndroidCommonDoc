#!/usr/bin/env node
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const rc = require('../lib/runtime-consultation.cjs');
const bridge = require('../lib/runtime-bridge-codex.cjs');

test('Windows PowerShell selector prefers the installed, validated PowerShell 7 host', { skip: process.platform !== 'win32' }, () => {
  const programFiles = process.env.ProgramW6432 || process.env.ProgramFiles;
  assert.ok(path.isAbsolute(programFiles || ''), 'Windows Program Files root must be absolute');
  const expected = fs.realpathSync(path.join(programFiles, 'PowerShell', '7', 'pwsh.exe'));
  const selected = rc.resolvedWindowsPowerShellPath();
  assert.strictEqual(selected, expected, 'ACL operations must not prefer legacy Windows PowerShell 5.1 when the stable PowerShell 7 host is installed');
  assert.strictEqual(bridge.resolvedWindowsPowerShellPath(), expected, 'bridge and ACL code must share one executable selection contract');
});

test('Windows PowerShell 7 selection sustains repeated real ACL ensure probes', { skip: process.platform !== 'win32' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-pwsh7-acl-'));
  try {
    for (let index = 0; index < 25; index += 1) {
      const result = rc.windowsPrivateDirectoryAcl(dir, { mode: 'ensure' });
      assert.strictEqual(result.ok, true, `ACL ensure probe ${index + 1} must succeed through the selected host: ${JSON.stringify(result)}`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Windows ACL ensure retries one failed PowerShell host process and still validates the real DACL', { skip: process.platform !== 'win32' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-pwsh7-retry-'));
  try {
    const script = `
      const cp = require('node:child_process');
      const realExecFileSync = cp.execFileSync;
      let calls = 0;
      cp.execFileSync = function (...args) {
        calls += 1;
        if (calls === 1) throw new Error('synthetic first PowerShell host failure');
        return realExecFileSync.apply(this, args);
      };
      const rc = require(process.argv[1]);
      const result = rc.windowsPrivateDirectoryAcl(process.argv[2], { mode: 'ensure' });
      process.stdout.write(JSON.stringify({ calls, result }));
    `;
    const child = spawnSync(process.execPath, ['-e', script, require.resolve('../lib/runtime-consultation.cjs'), dir], {
      encoding: 'utf8',
      env: { ...process.env },
    });
    assert.strictEqual(child.status, 0, child.stderr);
    const observed = JSON.parse(child.stdout);
    assert.strictEqual(observed.calls, 2, `the failed host process must be retried exactly once: ${child.stdout}`);
    assert.strictEqual(observed.result.ok, true, `the retry must return only a fresh, real ACL validation result: ${child.stdout}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Windows CommonApplicationData discovery retries one failed PowerShell host process', { skip: process.platform !== 'win32' }, () => {
  const script = `
    const cp = require('node:child_process');
    const realExecFileSync = cp.execFileSync;
    let calls = 0;
    cp.execFileSync = function (...args) {
      calls += 1;
      if (calls === 1) throw new Error('synthetic first PowerShell host failure');
      return realExecFileSync.apply(this, args);
    };
    const rll = require(process.argv[1]);
    const result = rll.registryBaseDir();
    process.stdout.write(JSON.stringify({ calls, result }));
  `;
  const child = spawnSync(process.execPath, ['-e', script, require.resolve('../lib/runtime-role-lifecycle.cjs')], {
    encoding: 'utf8',
    env: { ...process.env },
  });
  assert.strictEqual(child.status, 0, child.stderr);
  const observed = JSON.parse(child.stdout);
  assert.strictEqual(observed.calls, 2, `known-folder discovery must retry the failed host exactly once: ${child.stdout}`);
  assert.ok(path.isAbsolute(observed.result || ''), `the retry must return the real absolute CommonApplicationData path: ${child.stdout}`);
});
