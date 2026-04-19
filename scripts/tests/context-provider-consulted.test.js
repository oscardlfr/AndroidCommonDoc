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

function flagPath(sid) {
  return path.join(os.tmpdir(), `claude-cp-consulted-${sid}.flag`);
}

// TC1: SendMessage to context-provider → flag created
try { fs.unlinkSync(flagPath('t1')); } catch {}
runHook({ tool_name: 'SendMessage', tool_input: { to: 'context-provider', message: 'query' }, session_id: 't1' });
assert.ok(fs.existsSync(flagPath('t1')), 'TC1: flag must exist after CP message');
console.log('TC1 SendMessage to context-provider creates flag: PASS');

// TC2: SendMessage to context-provider-2 (suffix) → flag created
try { fs.unlinkSync(flagPath('t2')); } catch {}
runHook({ tool_name: 'SendMessage', tool_input: { to: 'context-provider-2', message: 'query' }, session_id: 't2' });
assert.ok(fs.existsSync(flagPath('t2')), 'TC2: suffix match must create flag');
console.log('TC2 SendMessage to context-provider-2 creates flag: PASS');

// TC3: SendMessage to arch-testing → no flag
try { fs.unlinkSync(flagPath('t3')); } catch {}
runHook({ tool_name: 'SendMessage', tool_input: { to: 'arch-testing', message: 'verify' }, session_id: 't3' });
assert.ok(!fs.existsSync(flagPath('t3')), 'TC3: non-CP message must not create flag');
console.log('TC3 SendMessage to arch-testing does not create flag: PASS');

// TC4: invalid JSON → exit 0, no crash
const r = runHook('bad json');
assert.strictEqual(r.status, 0, 'TC4: fail open on bad JSON');
console.log('TC4 invalid JSON fail-open: PASS');

console.log('\nAll context-provider-consulted tests passed.');
