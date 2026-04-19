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

function sanitize(id) {
  return String(id).replace(/[^a-zA-Z0-9_-]/g, '-');
}

function flagPath(sessionId, agentId) {
  return path.join(os.tmpdir(), `claude-cp-consulted-${sessionId}-${sanitize(agentId)}.flag`);
}

function clearFlag(sessionId, agentId) {
  try { fs.unlinkSync(flagPath(sessionId, agentId)); } catch {}
}

function writeFlag(sessionId, agentId) {
  fs.writeFileSync(flagPath(sessionId, agentId), new Date().toISOString());
}

// F1: Grep, arch-platform, no flag → BLOCK (exit 2)
clearFlag('s1', 'arch-platform');
const f1 = runHook({
  tool_name: 'Grep',
  tool_input: { pattern: 'test' },
  session_id: 's1',
  agent_id: 'arch-platform'
});
assert.strictEqual(f1.exit, 2, 'F1: should block');
assert.ok(
  f1.stdout.includes('"decision":"block"') || f1.stdout.includes('"decision": "block"'),
  'F1: block decision in stdout'
);
console.log('F1 Grep no-flag block: PASS');

// F2: Grep, arch-platform, flag exists → ALLOW (exit 0)
writeFlag('s2', 'arch-platform');
const f2 = runHook({
  tool_name: 'Grep',
  tool_input: { pattern: 'test' },
  session_id: 's2',
  agent_id: 'arch-platform'
});
assert.strictEqual(f2.exit, 0, 'F2: should allow when flag exists');
clearFlag('s2', 'arch-platform');
console.log('F2 Grep with flag allow: PASS');

// F3: Grep, context-provider agent_type, no flag → ALLOW (exempt via agent_type)
clearFlag('s3', 'context-provider');
const f3 = runHook({
  tool_name: 'Grep',
  tool_input: { pattern: 'test' },
  session_id: 's3',
  agent_type: 'context-provider',
  agent_id: 'context-provider'
});
assert.strictEqual(f3.exit, 0, 'F3: context-provider exempt');
console.log('F3 context-provider exempt: PASS');

// F4: Grep, team-lead agent_type, no flag → ALLOW (exempt via agent_type)
clearFlag('s4', 'team-lead');
const f4 = runHook({
  tool_name: 'Grep',
  tool_input: { pattern: 'test' },
  session_id: 's4',
  agent_type: 'team-lead',
  agent_id: 'team-lead'
});
assert.strictEqual(f4.exit, 0, 'F4: team-lead exempt');
console.log('F4 team-lead exempt: PASS');

// F5: Bash with ./gradlew build, arch-platform, no flag → ALLOW (non-search bash)
clearFlag('s5', 'arch-platform');
const f5 = runHook({
  tool_name: 'Bash',
  tool_input: { command: './gradlew build' },
  session_id: 's5',
  agent_id: 'arch-platform'
});
assert.strictEqual(f5.exit, 0, 'F5: non-search bash should allow');
console.log('F5 non-search Bash allow: PASS');

// F6: Bash with grep, arch-platform, no flag → BLOCK
clearFlag('s6', 'arch-platform');
const f6 = runHook({
  tool_name: 'Bash',
  tool_input: { command: 'grep -r libs.lifecycle .' },
  session_id: 's6',
  agent_id: 'arch-platform'
});
assert.strictEqual(f6.exit, 2, 'F6: search bash should block');
console.log('F6 search Bash block: PASS');

// F7: Invalid JSON → ALLOW (fail open, exit 0)
const f7 = runHook('not valid json');
assert.strictEqual(f7.exit, 0, 'F7: invalid JSON must fail open');
console.log('F7 invalid JSON fail-open: PASS');

// F8: context-provider-2 agent_type suffix → ALLOW (exempt via agent_type prefix match)
clearFlag('s8', 'context-provider-2');
const f8 = runHook({
  tool_name: 'Grep',
  tool_input: { pattern: 'test' },
  session_id: 's8',
  agent_type: 'context-provider-2',
  agent_id: 'context-provider-2'
});
assert.strictEqual(f8.exit, 0, 'F8: context-provider-2 suffix exempt');
console.log('F8 context-provider-2 suffix exempt: PASS');

// F9: NEW — per-agent isolation: arch-platform has flag, arch-testing does NOT → arch-testing blocked
writeFlag('s9', 'arch-platform');
clearFlag('s9', 'arch-testing');
const f9 = runHook({
  tool_name: 'Grep',
  tool_input: { pattern: 'test' },
  session_id: 's9',
  agent_id: 'arch-testing'
});
assert.strictEqual(f9.exit, 2, 'F9: arch-testing blocked even though arch-platform has flag (per-agent isolation)');
clearFlag('s9', 'arch-platform');
console.log('F9 per-agent isolation (session-wide bypass prevented): PASS');

// F10: NEW — two agents same session, each needs own flag
writeFlag('s10', 'arch-platform');
writeFlag('s10', 'arch-testing');
clearFlag('s10', 'domain-model-specialist');
const f10a = runHook({
  tool_name: 'Grep',
  tool_input: { pattern: 'x' },
  session_id: 's10',
  agent_id: 'arch-platform'
});
const f10b = runHook({
  tool_name: 'Grep',
  tool_input: { pattern: 'x' },
  session_id: 's10',
  agent_id: 'arch-testing'
});
const f10c = runHook({
  tool_name: 'Grep',
  tool_input: { pattern: 'x' },
  session_id: 's10',
  agent_id: 'domain-model-specialist'
});
assert.strictEqual(f10a.exit, 0, 'F10: arch-platform allowed (has flag)');
assert.strictEqual(f10b.exit, 0, 'F10: arch-testing allowed (has flag)');
assert.strictEqual(f10c.exit, 2, 'F10: domain-model-specialist blocked (no flag)');
clearFlag('s10', 'arch-platform');
clearFlag('s10', 'arch-testing');
console.log('F10 per-agent flags independent in same session: PASS');

// F11: NEW — agent_id with special chars (@) sanitized in path lookup
const agentRaw = 'arch-platform@wave18';
const agentSanitized = 'arch-platform-wave18';
clearFlag('s11', agentSanitized);
writeFlag('s11', agentSanitized);
const f11 = runHook({
  tool_name: 'Grep',
  tool_input: { pattern: 'x' },
  session_id: 's11',
  agent_id: agentRaw
});
assert.strictEqual(f11.exit, 0, 'F11: sanitized agent_id matches flag');
clearFlag('s11', agentSanitized);
console.log('F11 agent_id sanitization path lookup: PASS');

// F12: NEW — block reason does not reference hardcoded context-provider-2
clearFlag('s12', 'arch-platform');
const f12 = runHook({
  tool_name: 'Grep',
  tool_input: { pattern: 'x' },
  session_id: 's12',
  agent_id: 'arch-platform'
});
assert.strictEqual(f12.exit, 2, 'F12: blocked');
assert.ok(!f12.stdout.includes('context-provider-2'), 'F12: reason must not hardcode context-provider-2 suffix');
assert.ok(f12.stdout.includes('context-provider'), 'F12: reason references context-provider generally');
console.log('F12 block reason generic (no hardcoded -2): PASS');

console.log('\nAll context-provider-gate tests passed.');
