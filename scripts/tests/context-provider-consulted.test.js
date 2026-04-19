#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const HOOK = path.resolve(__dirname, '../../.claude/hooks/context-provider-consulted.js');

function runHook(payload) {
  const input = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return spawnSync('node', [HOOK], { input, encoding: 'utf8' });
}

function sanitize(id) {
  return String(id).replace(/[^a-zA-Z0-9_-]/g, '-');
}

function flagPath(sessionId, agentId) {
  return path.join(os.tmpdir(), `claude-cp-consulted-${sessionId}-${sanitize(agentId)}.flag`);
}

function clearFlag(sessionId, agentId) {
  try { fs.unlinkSync(flagPath(sessionId, agentId)); } catch {}
}

// TC1: SendMessage to context-provider from arch-platform → flag created for arch-platform only
clearFlag('t1', 'arch-platform');
clearFlag('t1', 'arch-testing');
runHook({
  tool_name: 'SendMessage',
  tool_input: { to: 'context-provider', message: 'query' },
  session_id: 't1',
  agent_id: 'arch-platform'
});
assert.ok(fs.existsSync(flagPath('t1', 'arch-platform')), 'TC1: flag must exist for arch-platform');
assert.ok(!fs.existsSync(flagPath('t1', 'arch-testing')), 'TC1: flag must NOT exist for arch-testing (per-agent isolation)');
console.log('TC1 SendMessage to context-provider creates per-sender flag: PASS');

// TC2: SendMessage to context-provider-2 (suffix) → flag created for sender
clearFlag('t2', 'arch-platform');
runHook({
  tool_name: 'SendMessage',
  tool_input: { to: 'context-provider-2', message: 'query' },
  session_id: 't2',
  agent_id: 'arch-platform'
});
assert.ok(fs.existsSync(flagPath('t2', 'arch-platform')), 'TC2: suffix match must create per-sender flag');
console.log('TC2 SendMessage to context-provider-2 creates per-sender flag: PASS');

// TC3: SendMessage to arch-testing → no flag
clearFlag('t3', 'arch-platform');
runHook({
  tool_name: 'SendMessage',
  tool_input: { to: 'arch-testing', message: 'verify' },
  session_id: 't3',
  agent_id: 'arch-platform'
});
assert.ok(!fs.existsSync(flagPath('t3', 'arch-platform')), 'TC3: non-CP message must not create flag');
console.log('TC3 SendMessage to arch-testing does not create flag: PASS');

// TC4: invalid JSON → exit 0, no crash
const r = runHook('bad json');
assert.strictEqual(r.status, 0, 'TC4: fail open on bad JSON');
console.log('TC4 invalid JSON fail-open: PASS');

// TC5: Two different senders in same session → each gets own flag
clearFlag('t5', 'arch-platform');
clearFlag('t5', 'arch-testing');
runHook({
  tool_name: 'SendMessage',
  tool_input: { to: 'context-provider', message: 'q1' },
  session_id: 't5',
  agent_id: 'arch-platform'
});
runHook({
  tool_name: 'SendMessage',
  tool_input: { to: 'context-provider', message: 'q2' },
  session_id: 't5',
  agent_id: 'arch-testing'
});
assert.ok(fs.existsSync(flagPath('t5', 'arch-platform')), 'TC5: arch-platform has flag');
assert.ok(fs.existsSync(flagPath('t5', 'arch-testing')), 'TC5: arch-testing has flag');
console.log('TC5 two senders same session each get own flag: PASS');

// TC6: missing agent_id → fallback to 'unknown' as sender
clearFlag('t6', 'unknown');
runHook({
  tool_name: 'SendMessage',
  tool_input: { to: 'context-provider', message: 'q' },
  session_id: 't6'
  // no agent_id
});
assert.ok(fs.existsSync(flagPath('t6', 'unknown')), 'TC6: missing agent_id falls back to unknown');
console.log('TC6 missing agent_id fallback to unknown: PASS');

// TC7: agent_id with special chars (@, /) is sanitized
clearFlag('t7', 'arch-platform-wave18');
runHook({
  tool_name: 'SendMessage',
  tool_input: { to: 'context-provider', message: 'q' },
  session_id: 't7',
  agent_id: 'arch-platform@wave18'
});
assert.ok(fs.existsSync(flagPath('t7', 'arch-platform-wave18')), 'TC7: special chars in agent_id are sanitized');
console.log('TC7 agent_id sanitization (@ to -): PASS');

console.log('\nAll context-provider-consulted tests passed.');
