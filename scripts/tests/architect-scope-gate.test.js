#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const HOOK = path.resolve(__dirname, '../../.claude/hooks/architect-scope-gate.js');

// Assumption: hook reads project root from PROJECT_ROOT env var (same pattern as other hooks).
// Confirmed: arch-* agent detection via agent_type prefix "arch-" (from stdin payload).
// Both assumptions match PLAN.md Wave 4 contract and the context-provider-gate.js harness pattern.

function runHook(payload, env = {}) {
  const input = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const result = spawnSync('node', [HOOK], {
    input,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  return { exit: result.status, stdout: result.stdout, stderr: result.stderr };
}

// Fixture: minimal PLAN.md with two scope-file lines in a tmpdir
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scope-gate-test-'));
const planningDir = path.join(tmpDir, '.planning');
fs.mkdirSync(planningDir, { recursive: true });

const planContent = [
  '# Wave 21 Plan',
  '',
  '## Wave 1 — Registry Rehash Pre-Commit Hook',
  '',
  '### Scope files (machine-readable)',
  '- `scripts/sh/install-git-hooks.sh`',
  '- `scripts/tests/pre-commit-hook.bats`',
  '',
].join('\n');

fs.writeFileSync(path.join(planningDir, 'PLAN.md'), planContent);

const baseEnv = { PROJECT_ROOT: tmpDir };

// ── S1: in-scope file → allow ────────────────────────────────────────────

const s1 = runHook({
  tool_name: 'Write',
  tool_input: { path: 'scripts/sh/install-git-hooks.sh' },
  agent_type: 'arch-platform',
}, baseEnv);
assert.strictEqual(s1.exit, 0, 'S1: in-scope file must be allowed');
console.log('S1 in-scope Write allow: PASS');

// ── S2: out-of-scope file → block ────────────────────────────────────────

const s2 = runHook({
  tool_name: 'Write',
  tool_input: { path: 'some/other/file.ts' },
  agent_type: 'arch-platform',
}, baseEnv);
assert.notStrictEqual(s2.exit, 0, 'S2: out-of-scope file must be blocked');
assert.ok(
  s2.stdout.includes('"decision":"block"') || s2.stdout.includes('"decision": "block"'),
  'S2: block decision in stdout'
);
console.log('S2 out-of-scope Write block: PASS');

// ── S3: SCOPE_GATE_DISABLE=1 → allow + bypass log written ────────────────

const s3 = runHook({
  tool_name: 'Write',
  tool_input: { path: 'some/other/file.ts' },
  agent_type: 'arch-platform',
}, { ...baseEnv, SCOPE_GATE_DISABLE: '1' });
assert.strictEqual(s3.exit, 0, 'S3: SCOPE_GATE_DISABLE=1 must allow');
const bypassLog = path.join(planningDir, 'scope-gate-bypasses.log');
assert.ok(fs.existsSync(bypassLog), 'S3: bypass log must be written at .planning/scope-gate-bypasses.log');
console.log('S3 SCOPE_GATE_DISABLE bypass allow + log written: PASS');

// ── S4: non-arch agent → allow (fail-open) ───────────────────────────────

const s4 = runHook({
  tool_name: 'Write',
  tool_input: { path: 'some/other/file.ts' },
  agent_type: 'test-specialist',
}, baseEnv);
assert.strictEqual(s4.exit, 0, 'S4: non-arch agent must be allowed (fail-open)');
console.log('S4 non-arch agent fail-open allow: PASS');

// Cleanup tmpdir
fs.rmSync(tmpDir, { recursive: true, force: true });

console.log('\nAll 4 scope-gate tests passed.');
