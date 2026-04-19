#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const HOOK = path.resolve(__dirname, '../../.claude/hooks/context-provider-gate.js');

function runHook(payload, env = {}) {
  const input = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const result = spawnSync('node', [HOOK], {
    input,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  return { exit: result.status, stdout: result.stdout, stderr: result.stderr };
}

function flagPath(sessionId) {
  return path.join(os.tmpdir(), `claude-cp-consulted-${sessionId}.flag`);
}

function clearFlag(sessionId) {
  try { fs.unlinkSync(flagPath(sessionId)); } catch {}
}

function writeFlag(sessionId) {
  fs.writeFileSync(flagPath(sessionId), new Date().toISOString());
}

// F1: Grep, arch-platform, no flag → BLOCK (exit 2)
clearFlag('s1');
const f1 = runHook(
  { tool_name: 'Grep', tool_input: { pattern: 'test' }, session_id: 's1' },
  { CLAUDE_AGENT_NAME: 'arch-platform' }
);
assert.strictEqual(f1.exit, 2, 'F1: should block');
assert.ok(
  f1.stdout.includes('"decision":"block"') || f1.stdout.includes('"decision": "block"'),
  'F1: block decision in stdout'
);
console.log('F1 Grep no-flag block: PASS');

// F2: Grep, arch-platform, flag exists → ALLOW (exit 0)
writeFlag('s2');
const f2 = runHook(
  { tool_name: 'Grep', tool_input: { pattern: 'test' }, session_id: 's2' },
  { CLAUDE_AGENT_NAME: 'arch-platform' }
);
assert.strictEqual(f2.exit, 0, 'F2: should allow when flag exists');
clearFlag('s2');
console.log('F2 Grep with flag allow: PASS');

// F3: Grep, context-provider, no flag → ALLOW (exempt via agent_type)
clearFlag('s3');
const f3 = runHook(
  { tool_name: 'Grep', tool_input: { pattern: 'test' }, session_id: 's3', agent_type: 'context-provider' }
);
assert.strictEqual(f3.exit, 0, 'F3: context-provider exempt');
console.log('F3 context-provider exempt: PASS');

// F4: Grep, team-lead, no flag → ALLOW (exempt via agent_type)
clearFlag('s4');
const f4 = runHook(
  { tool_name: 'Grep', tool_input: { pattern: 'test' }, session_id: 's4', agent_type: 'team-lead' }
);
assert.strictEqual(f4.exit, 0, 'F4: team-lead exempt');
console.log('F4 team-lead exempt: PASS');

// F5: Bash with ./gradlew build, arch-platform, no flag → ALLOW (non-search bash)
clearFlag('s5');
const f5 = runHook(
  { tool_name: 'Bash', tool_input: { command: './gradlew build' }, session_id: 's5' },
  { CLAUDE_AGENT_NAME: 'arch-platform' }
);
assert.strictEqual(f5.exit, 0, 'F5: non-search bash should allow');
console.log('F5 non-search Bash allow: PASS');

// F6: Bash with grep, arch-platform, no flag → BLOCK
clearFlag('s6');
const f6 = runHook(
  { tool_name: 'Bash', tool_input: { command: 'grep -r libs.lifecycle .' }, session_id: 's6' },
  { CLAUDE_AGENT_NAME: 'arch-platform' }
);
assert.strictEqual(f6.exit, 2, 'F6: search bash should block');
console.log('F6 search Bash block: PASS');

// F7: Invalid JSON → ALLOW (fail open, exit 0)
const f7 = runHook('not valid json');
assert.strictEqual(f7.exit, 0, 'F7: invalid JSON must fail open');
console.log('F7 invalid JSON fail-open: PASS');

// F8: context-provider-2 suffix → ALLOW (exempt via agent_type prefix match)
clearFlag('s8');
const f8 = runHook(
  { tool_name: 'Grep', tool_input: { pattern: 'test' }, session_id: 's8', agent_type: 'context-provider-2' }
);
assert.strictEqual(f8.exit, 0, 'F8: context-provider-2 suffix exempt');
console.log('F8 context-provider-2 suffix exempt: PASS');

console.log('\nAll context-provider-gate tests passed.');
