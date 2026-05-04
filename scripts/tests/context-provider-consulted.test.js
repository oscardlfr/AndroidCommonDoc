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

function flagPath(sessionId) {
  return path.join(os.tmpdir(), `claude-cp-consulted-${sessionId}.flag`);
}

function clearFlag(sessionId) {
  try { fs.unlinkSync(flagPath(sessionId)); } catch {}
}

// TC1: SendMessage to context-provider → session flag written (session-scoped, not per-agent)
clearFlag('t1');
runHook({
  tool_name: 'SendMessage',
  tool_input: { to: 'context-provider', message: 'query' },
  session_id: 't1',
  agent_type: 'arch-platform'
});
assert.ok(fs.existsSync(flagPath('t1')), 'TC1: session flag must exist after arch-platform sends to context-provider');
console.log('TC1 SendMessage to context-provider creates session flag: PASS');

// TC2: SendMessage to context-provider-2 (suffix) → session flag created
clearFlag('t2');
runHook({
  tool_name: 'SendMessage',
  tool_input: { to: 'context-provider-2', message: 'query' },
  session_id: 't2',
  agent_type: 'arch-platform'
});
assert.ok(fs.existsSync(flagPath('t2')), 'TC2: suffix match must create session flag');
console.log('TC2 SendMessage to context-provider-2 creates session flag: PASS');

// TC3: SendMessage to arch-testing → no session flag
clearFlag('t3');
runHook({
  tool_name: 'SendMessage',
  tool_input: { to: 'arch-testing', message: 'verify' },
  session_id: 't3',
  agent_type: 'arch-platform'
});
assert.ok(!fs.existsSync(flagPath('t3')), 'TC3: non-CP message must not create session flag');
console.log('TC3 SendMessage to arch-testing does not create flag: PASS');

// TC4: invalid JSON → exit 0, no crash, no stale flag written
const sid4 = 'tc4-malf';
const r = runHook('bad json');
assert.strictEqual(r.status, 0, 'TC4: fail open on bad JSON');
const tc4FlagPath = path.join(os.tmpdir(), `claude-cp-consulted-${sid4}.flag`);
try { fs.unlinkSync(tc4FlagPath); } catch {}
assert.ok(!fs.existsSync(tc4FlagPath), 'TC4: no flag written for malformed JSON');
console.log('TC4 invalid JSON fail-open + no flag written: PASS');

// TC5: Two different senders in same session → ONE shared session flag (session-scoped)
clearFlag('t5');
runHook({
  tool_name: 'SendMessage',
  tool_input: { to: 'context-provider', message: 'q1' },
  session_id: 't5',
  agent_type: 'arch-platform'
});
runHook({
  tool_name: 'SendMessage',
  tool_input: { to: 'context-provider', message: 'q2' },
  session_id: 't5',
  agent_type: 'arch-testing'
});
assert.ok(fs.existsSync(flagPath('t5')), 'TC5: one shared session flag exists after two senders');
console.log('TC5 two senders same session share one session flag: PASS');

// TC6: missing agent_type → session flag still written (session-scoped)
clearFlag('t6');
runHook({
  tool_name: 'SendMessage',
  tool_input: { to: 'context-provider', message: 'q' },
  session_id: 't6'
  // no agent_type
});
assert.ok(fs.existsSync(flagPath('t6')), 'TC6: missing agent_type still writes session flag');
console.log('TC6 missing agent_type still writes session flag: PASS');

// TC7: session_id with special chars — session flag still written
clearFlag('t7');
runHook({
  tool_name: 'SendMessage',
  tool_input: { to: 'context-provider', message: 'q' },
  session_id: 't7',
  agent_type: 'arch-platform@wave18'
});
assert.ok(fs.existsSync(flagPath('t7')), 'TC7: session flag written regardless of agent_type format');
console.log('TC7 session flag written regardless of agent_type format: PASS');

// TC8-TC11: arch-response flag — written when arch → specialist
function archFlagPath(sessionId, to) {
  return path.join(os.tmpdir(), `claude-arch-responded-${sessionId}-${sanitize(to)}.flag`);
}
function clearArchFlag(sessionId, to) {
  try { fs.unlinkSync(archFlagPath(sessionId, to)); } catch {}
}

// TC8: arch-platform → test-specialist → arch-response flag written
clearArchFlag('t8', 'test-specialist');
runHook({
  tool_name: 'SendMessage',
  tool_input: { to: 'test-specialist', message: 'dispatch' },
  session_id: 't8',
  agent_type: 'arch-platform'
});
assert.ok(fs.existsSync(archFlagPath('t8', 'test-specialist')), 'TC8: arch-platform→test-specialist writes arch-response flag');
console.log('TC8 arch-platform→test-specialist writes arch-response flag: PASS');

// TC9: arch-testing → toolkit-specialist → arch-response flag written
clearArchFlag('t9', 'toolkit-specialist');
runHook({
  tool_name: 'SendMessage',
  tool_input: { to: 'toolkit-specialist', message: 'dispatch' },
  session_id: 't9',
  agent_type: 'arch-testing'
});
assert.ok(fs.existsSync(archFlagPath('t9', 'toolkit-specialist')), 'TC9: arch-testing→toolkit-specialist writes arch-response flag');
console.log('TC9 arch-testing→toolkit-specialist writes arch-response flag: PASS');

// TC10: non-arch sender → specialist → NO arch-response flag
clearArchFlag('t10', 'test-specialist');
runHook({
  tool_name: 'SendMessage',
  tool_input: { to: 'test-specialist', message: 'query' },
  session_id: 't10',
  agent_type: 'planner'
});
assert.ok(!fs.existsSync(archFlagPath('t10', 'test-specialist')), 'TC10: non-arch sender does not write arch-response flag');
console.log('TC10 non-arch sender no arch-response flag: PASS');

// TC11: arch → non-specialist (arch-testing) → NO arch-response flag
clearArchFlag('t11', 'arch-testing');
runHook({
  tool_name: 'SendMessage',
  tool_input: { to: 'arch-testing', message: 'query' },
  session_id: 't11',
  agent_type: 'arch-platform'
});
assert.ok(!fs.existsSync(archFlagPath('t11', 'arch-testing')), 'TC11: arch→arch does not write arch-response flag');
console.log('TC11 arch→arch no arch-response flag: PASS');

// TC12: JSON shape assertion — written_by, agent_id, session_id, ts are strings; agent_id matches input
const sid12 = 'tc12-json';
clearFlag(sid12);
runHook({
  tool_name: 'SendMessage',
  tool_input: { to: 'context-provider', message: 'query' },
  session_id: sid12,
  agent_id: 'arch-platform-abc',
  agent_type: 'arch-platform'
});
assert.ok(fs.existsSync(flagPath(sid12)), 'TC12: session flag must exist');
const content12 = fs.readFileSync(flagPath(sid12), 'utf8');
const meta12 = JSON.parse(content12);
assert.strictEqual(typeof meta12.written_by, 'string', 'TC12: written_by must be a string');
assert.strictEqual(typeof meta12.agent_id, 'string', 'TC12: agent_id must be a string');
assert.strictEqual(typeof meta12.session_id, 'string', 'TC12: session_id must be a string');
assert.strictEqual(typeof meta12.ts, 'string', 'TC12: ts must be a string');
assert.strictEqual(meta12.agent_id, 'arch-platform-abc', 'TC12: agent_id must match input payload');
clearFlag(sid12);
console.log('TC12 JSON shape assertion (written_by/agent_id/session_id/ts + agent_id match): PASS');

console.log('\nAll context-provider-consulted tests passed.');
