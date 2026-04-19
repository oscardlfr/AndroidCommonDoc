#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const HOOK = path.resolve(__dirname, '../../.claude/hooks/tool-use-logger.js');
const LOG = path.join(os.tmpdir(), '.androidcommondoc', 'tool-use-log.jsonl');

// Ensure log dir exists in tmpdir
fs.mkdirSync(path.join(os.tmpdir(), '.androidcommondoc'), { recursive: true });

function runHook(payload, env = {}) {
  try { fs.unlinkSync(LOG); } catch {}
  const input = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const result = spawnSync('node', [HOOK], {
    input,
    env: { ...process.env, CLAUDE_PROJECT_DIR: os.tmpdir(), ...env },
    encoding: 'utf8',
  });
  let line = null;
  if (fs.existsSync(LOG)) {
    const raw = fs.readFileSync(LOG, 'utf8').trim();
    if (raw) {
      try { line = JSON.parse(raw); } catch {}
    }
  }
  return { line, stderr: result.stderr, status: result.status };
}

// T1: Bash tool
const t1 = runHook({ tool_name: 'Bash', tool_input: { command: 'echo hello' }, session_id: 'sess1' });
assert.strictEqual(t1.status, 0, 'T1: hook must exit 0');
assert.ok(t1.line, 'T1: log line must exist');
assert.strictEqual(t1.line.tool_name, 'Bash', 'T1: tool_name');
assert.strictEqual(t1.line.input_summary, 'echo hello', 'T1: input_summary from command');
assert.strictEqual(t1.line.mcp_server, null, 'T1: mcp_server null for non-mcp');
assert.ok(t1.line.input_summary.length <= 80, 'T1: input_summary <= 80 chars');
assert.strictEqual(t1.line.session_id, 'sess1', 'T1: session_id');
console.log('T1 Bash: PASS');

// T2: Grep tool
const t2 = runHook({ tool_name: 'Grep', tool_input: { pattern: 'libs.lifecycle' }, session_id: 'sess1' });
assert.strictEqual(t2.status, 0, 'T2: hook must exit 0');
assert.ok(t2.line, 'T2: log line must exist');
assert.strictEqual(t2.line.input_summary, 'libs.lifecycle', 'T2: input_summary from pattern');
assert.ok(t2.line.input_summary.length <= 80, 'T2: input_summary <= 80 chars');
console.log('T2 Grep: PASS');

// T3: mcp__ tool — context7
const t3 = runHook({ tool_name: 'mcp__context7__get-library-docs', tool_input: { libraryId: 'react' }, session_id: 'sess1' });
assert.strictEqual(t3.status, 0, 'T3: hook must exit 0');
assert.ok(t3.line, 'T3: log line must exist');
assert.strictEqual(t3.line.mcp_server, 'context7', 'T3: mcp_server');
assert.strictEqual(t3.line.mcp_tool, 'get-library-docs', 'T3: mcp_tool');
assert.ok(t3.line.input_summary.length <= 80, 'T3: input_summary <= 80 chars');
console.log('T3 mcp__context7: PASS');

// T4: SendMessage
const t4 = runHook({ tool_name: 'SendMessage', tool_input: { to: 'context-provider', summary: 'query patterns' }, session_id: 'sess1' });
assert.strictEqual(t4.status, 0, 'T4: hook must exit 0');
assert.ok(t4.line, 'T4: log line must exist');
assert.ok(t4.line.input_summary.startsWith('context-provider:'), 'T4: input_summary starts with to:');
assert.ok(t4.line.input_summary.length <= 80, 'T4: input_summary <= 80 chars');
console.log('T4 SendMessage: PASS');

// T5: cp_bypass_blocked — marker file present
const marker = path.join(os.tmpdir(), 'claude-cp-blocked-sess2.flag');
fs.writeFileSync(marker, '1');
const t5 = runHook({ tool_name: 'Grep', tool_input: { pattern: 'test' }, session_id: 'sess2' });
assert.strictEqual(t5.status, 0, 'T5: hook must exit 0');
assert.ok(t5.line, 'T5: log line must exist');
assert.strictEqual(t5.line.cp_bypass_blocked, true, 'T5: cp_bypass_blocked true when marker present');
assert.ok(!fs.existsSync(marker), 'T5: marker deleted after read');
console.log('T5 cp_bypass_blocked: PASS');

// T6: invalid JSON — fail open
const t6 = runHook('not-json');
assert.strictEqual(t6.status, 0, 'T6: hook must exit 0 on invalid JSON');
console.log('T6 invalid JSON fail-open: PASS');

// T7: Read tool input_summary from file_path
const longPath = 'a'.repeat(100);
const t7 = runHook({ tool_name: 'Read', tool_input: { file_path: longPath }, session_id: 'sess1' });
assert.ok(t7.line, 'T7: log line must exist');
assert.ok(t7.line.input_summary.length <= 80, 'T7: input_summary truncated to 80 chars');
assert.strictEqual(t7.line.input_summary, longPath.slice(0, 80), 'T7: input_summary is truncated file_path');
console.log('T7 Read truncation: PASS');

// T8: Skill tool populates skill_name
const t8 = runHook({ tool_name: 'Skill', tool_input: { name: 'validate-patterns' }, session_id: 'sess1' });
assert.ok(t8.line, 'T8: log line must exist');
assert.strictEqual(t8.line.skill_name, 'validate-patterns', 'T8: skill_name populated');
assert.strictEqual(t8.line.input_summary, 'validate-patterns', 'T8: input_summary from skill name');
console.log('T8 Skill: PASS');

// T9: agent_id field emitted when provided in payload
const t9 = runHook({ tool_name: 'Bash', tool_input: { command: 'echo t9' }, session_id: 'sess9', agent_id: 'some-id@session-xyz' });
assert.ok(t9.line, 'T9: log line must exist');
assert.strictEqual(t9.line.agent_id, 'some-id@session-xyz', 'T9: agent_id field correct');
console.log('T9 agent_id field: PASS');

// T10: agent_type field emitted when provided in payload
const t10 = runHook({ tool_name: 'Bash', tool_input: { command: 'echo t10' }, session_id: 'sess10', agent_type: 'arch-platform' });
assert.ok(t10.line, 'T10: log line must exist');
assert.strictEqual(t10.line.agent_type, 'arch-platform', 'T10: agent_type field correct');
console.log('T10 agent_type field: PASS');

console.log('\nAll tool-use-logger tests passed.');
