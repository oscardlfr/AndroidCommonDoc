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

// T5: cp_bypass_blocked — marker file present, correct agentId suffix
const marker = path.join(os.tmpdir(), 'claude-cp-blocked-sess2-test-agent.flag');
fs.writeFileSync(marker, '1');
const t5 = runHook({ tool_name: 'Grep', tool_input: { pattern: 'test' }, session_id: 'sess2', agent_id: 'test-agent' });
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

// T11: non-blockable tool (SendMessage) with marker present — must NOT consume marker
const t11Marker = path.join(os.tmpdir(), 'claude-cp-blocked-sess5-test-agent.flag');
fs.writeFileSync(t11Marker, '1');
const t11 = runHook({ tool_name: 'SendMessage', tool_input: { to: 'arch-platform', summary: 'query' }, session_id: 'sess5', agent_id: 'test-agent' });
assert.strictEqual(t11.status, 0, 'T11: hook must exit 0');
assert.ok(t11.line, 'T11: log line must exist');
assert.strictEqual(t11.line.cp_bypass_blocked, false, 'T11: cp_bypass_blocked false for non-blockable tool');
assert.ok(fs.existsSync(t11Marker), 'T11: marker STILL PRESENT after non-blockable tool');
try { fs.unlinkSync(t11Marker); } catch {}
console.log('T11 non-blockable tool does not consume marker: PASS');

// T12: Read tool with marker for WRONG agentId — must NOT consume marker
const t12Marker = path.join(os.tmpdir(), 'claude-cp-blocked-sess6-other-agent.flag');
fs.writeFileSync(t12Marker, '1');
const t12 = runHook({ tool_name: 'Read', tool_input: { file_path: '/some/path' }, session_id: 'sess6', agent_id: 'read-agent' });
assert.strictEqual(t12.status, 0, 'T12: hook must exit 0');
assert.ok(t12.line, 'T12: log line must exist');
assert.strictEqual(t12.line.cp_bypass_blocked, false, 'T12: cp_bypass_blocked false for wrong agentId marker');
assert.ok(fs.existsSync(t12Marker), 'T12: wrong-agentId marker STILL PRESENT after hook');
try { fs.unlinkSync(t12Marker); } catch {}
console.log('T12 wrong agentId marker not consumed: PASS');

// T13: Read tool with correct agentId marker — must consume and return true
const t13Marker = path.join(os.tmpdir(), 'claude-cp-blocked-sess3-read-agent.flag');
fs.writeFileSync(t13Marker, '1');
const t13 = runHook({ tool_name: 'Read', tool_input: { file_path: '/some/path' }, session_id: 'sess3', agent_id: 'read-agent' });
assert.strictEqual(t13.status, 0, 'T13: hook must exit 0');
assert.ok(t13.line, 'T13: log line must exist');
assert.strictEqual(t13.line.cp_bypass_blocked, true, 'T13: cp_bypass_blocked true for Read with correct agentId');
assert.ok(!fs.existsSync(t13Marker), 'T13: marker deleted after read');
console.log('T13 Read correct agentId consumed: PASS');

// T14: absent agent_id — fallback to 'unknown' (arch-platform BINDING: data.agent_id || 'unknown')
// Marker: claude-cp-blocked-sess4-unknown.flag (reconciles arch-platform 'unknown' over arch-testing '' assumption)
const t14Marker = path.join(os.tmpdir(), 'claude-cp-blocked-sess4-unknown.flag');
fs.writeFileSync(t14Marker, '1');
const t14 = runHook({ tool_name: 'Bash', tool_input: { command: 'echo t14' }, session_id: 'sess4' });
assert.strictEqual(t14.status, 0, 'T14: hook must exit 0');
assert.ok(t14.line, 'T14: log line must exist');
assert.strictEqual(t14.line.cp_bypass_blocked, true, 'T14: cp_bypass_blocked true when agent_id absent (unknown fallback)');
assert.ok(!fs.existsSync(t14Marker), 'T14: marker deleted after read');
console.log('T14 absent agent_id unknown fallback: PASS');

// T15: non-empty agent_type → agent_name = agent_type, agent_class = "peer"
const t15 = runHook({ tool_name: 'Bash', tool_input: { command: 'echo t15' }, session_id: 'sess15', agent_type: 'toolkit-specialist' });
assert.strictEqual(t15.status, 0, 'T15: hook must exit 0');
assert.ok(t15.line, 'T15: log line must exist');
assert.strictEqual(t15.line.agent_name, 'toolkit-specialist', 'T15: agent_name equals agent_type');
assert.strictEqual(t15.line.agent_class, 'peer', 'T15: agent_class is peer for non-empty agent_type');
console.log('T15 agent_name/agent_class peer: PASS');

// T16: empty agent_type → agent_name = "main", agent_class = "main"
const t16 = runHook({ tool_name: 'Bash', tool_input: { command: 'echo t16' }, session_id: 'sess16', agent_type: '' });
assert.strictEqual(t16.status, 0, 'T16: hook must exit 0');
assert.ok(t16.line, 'T16: log line must exist');
assert.strictEqual(t16.line.agent_name, 'main', 'T16: agent_name is "main" when agent_type is empty');
assert.strictEqual(t16.line.agent_class, 'main', 'T16: agent_class is "main" when agent_type is empty');
console.log('T16 agent_name/agent_class main: PASS');

// T17: rotation — synthetic >20MB log triggers gzip rotation
// Uses its own isolated tmpdir so the shared LOG path is not disturbed.
{
  const rotDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tul-rot-'));
  const logDir = path.join(rotDir, '.androidcommondoc');
  fs.mkdirSync(logDir);
  const logPath = path.join(logDir, 'tool-use-log.jsonl');

  // Write a synthetic file just over 20MB (20971521 bytes = 20MB + 1 byte).
  // Use a 1MB buffer repeated to avoid holding 20MB in a single string allocation.
  const MB = 1024 * 1024;
  const chunk = Buffer.alloc(MB, 0x41); // 'A' x 1MB
  const fd = fs.openSync(logPath, 'w');
  for (let i = 0; i < 21; i++) fs.writeSync(fd, chunk);
  fs.closeSync(fd);
  assert.ok(fs.statSync(logPath).size > 20_971_520, 'T17 pre: synthetic file exceeds 20MB threshold');

  // Run the hook with the synthetic log in place.
  const input17 = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'echo rotate' }, session_id: 'sess17' });
  const result17 = spawnSync('node', [HOOK], {
    input: input17,
    env: { ...process.env, CLAUDE_PROJECT_DIR: rotDir },
    encoding: 'utf8',
  });
  assert.strictEqual(result17.status, 0, 'T17: hook must exit 0 after rotation');

  // The original .jsonl should be gone (renamed+gzipped) and a fresh .jsonl should exist.
  assert.ok(!fs.existsSync(logPath) || fs.statSync(logPath).size < 20_971_520,
    'T17: original oversized .jsonl removed or replaced with small fresh file');

  // At least one .jsonl.gz file must have been created in the log dir.
  const gzFiles = fs.readdirSync(logDir).filter(f => f.endsWith('.jsonl.gz'));
  assert.ok(gzFiles.length > 0, 'T17: at least one .jsonl.gz rotation file created');

  // The fresh .jsonl (if it exists) must contain the new entry from this run.
  if (fs.existsSync(logPath)) {
    const freshContent = fs.readFileSync(logPath, 'utf8').trim();
    const freshLine = freshContent ? JSON.parse(freshContent) : null;
    assert.ok(freshLine, 'T17: fresh .jsonl contains the new entry');
    assert.strictEqual(freshLine.tool_name, 'Bash', 'T17: fresh entry has correct tool_name');
  }

  fs.rmSync(rotDir, { recursive: true, force: true });
  console.log('T17 rotation >20MB: PASS');
}

// T18: CR-4 (b7f18db) — rotation produces unique filename with ms-precision ISO stamp
{
  const rotDir18 = fs.mkdtempSync(path.join(os.tmpdir(), 'tul-cr4a-'));
  const logDir18 = path.join(rotDir18, '.androidcommondoc');
  fs.mkdirSync(logDir18);
  const logPath18 = path.join(logDir18, 'tool-use-log.jsonl');
  // Synthesize a >20MB log file to trigger rotation
  const MB = 1024 * 1024;
  const chunk18 = Buffer.alloc(MB, 0x42);
  const fd18 = fs.openSync(logPath18, 'w');
  for (let i = 0; i < 21; i++) fs.writeSync(fd18, chunk18);
  fs.closeSync(fd18);

  const result18 = spawnSync('node', [HOOK], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'echo cr4a' }, session_id: 'sess18' }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: rotDir18 },
    encoding: 'utf8',
  });
  assert.strictEqual(result18.status, 0, 'T18: hook exits 0 after rotation');

  // The .gz filename must contain a full ms-precision ISO timestamp.
  // b7f18db: toISOString().replace(/[:.]/g, '-') → YYYY-MM-DDTHH-MM-SS-mmmz
  // Stronger assertion: must have the millisecond group (3 digits before trailing 'z').
  const gzFiles18 = fs.readdirSync(logDir18).filter(f => f.endsWith('.jsonl.gz'));
  assert.ok(gzFiles18.length > 0, 'T18: at least one .jsonl.gz created');
  const gzName18 = gzFiles18[0];
  // Full ISO date+time+ms: YYYY-MM-DDTHH-MM-SS-mmmz (e.g. 2026-06-13T08-48-50-092z)
  assert.ok(
    /\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}z/.test(gzName18),
    `T18: .gz filename must have ms-precision ISO timestamp (got: ${gzName18})`
  );

  fs.rmSync(rotDir18, { recursive: true, force: true });
  console.log('T18 CR-4 rotation filename has ms-precision ISO stamp: PASS');
}

// T19: CR-4 (b7f18db) — after rotation, new entries append to fresh logPath (not the .gz)
{
  const rotDir19 = fs.mkdtempSync(path.join(os.tmpdir(), 'tul-cr4b-'));
  const logDir19 = path.join(rotDir19, '.androidcommondoc');
  fs.mkdirSync(logDir19);
  const logPath19 = path.join(logDir19, 'tool-use-log.jsonl');
  // Trigger rotation
  const MB = 1024 * 1024;
  const chunk19 = Buffer.alloc(MB, 0x43);
  const fd19 = fs.openSync(logPath19, 'w');
  for (let i = 0; i < 21; i++) fs.writeSync(fd19, chunk19);
  fs.closeSync(fd19);

  // First run — triggers rotation; assert success so T19 doesn't pass on a broken setup
  const result19a = spawnSync('node', [HOOK], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'echo first' }, session_id: 'sess19a' }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: rotDir19 },
    encoding: 'utf8',
  });
  assert.strictEqual(result19a.status, 0, 'T19: first run (rotation trigger) exits 0');
  const gzFiles19 = fs.readdirSync(logDir19).filter(f => f.endsWith('.jsonl.gz'));
  assert.ok(gzFiles19.length > 0, 'T19: .gz archive created after first run');

  // Second run — should append to the fresh .jsonl, not the archive
  const result19b = spawnSync('node', [HOOK], {
    input: JSON.stringify({ tool_name: 'Read', tool_input: { file_path: 'cr4b.md' }, session_id: 'sess19b' }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: rotDir19 },
    encoding: 'utf8',
  });
  assert.strictEqual(result19b.status, 0, 'T19: second run exits 0');

  // Fresh .jsonl must exist and contain the second-run entry
  assert.ok(fs.existsSync(logPath19), 'T19: fresh tool-use-log.jsonl exists after rotation');
  const lines19 = fs.readFileSync(logPath19, 'utf8').trim().split('\n').filter(Boolean);
  const hasRead = lines19.some(l => { try { return JSON.parse(l).tool_name === 'Read'; } catch { return false; } });
  assert.ok(hasRead, 'T19: fresh .jsonl contains Read entry from second run (not written to .gz archive)');

  // Verify the .gz archive does NOT contain the second-run entry (Read tool)
  const gzPath19 = path.join(logDir19, gzFiles19[0]);
  const gzBuf19 = fs.readFileSync(gzPath19);
  const { gunzipSync } = require('zlib');
  const gzContent19 = gunzipSync(gzBuf19).toString('utf8');
  const gzHasRead = gzContent19.split('\n').filter(Boolean).some(l => {
    try { return JSON.parse(l).tool_name === 'Read'; } catch { return false; }
  });
  assert.ok(!gzHasRead, 'T19: .gz archive must NOT contain the second-run Read entry');

  fs.rmSync(rotDir19, { recursive: true, force: true });
  console.log('T19 CR-4 post-rotation entries go to fresh logPath: PASS');
}

console.log('\nAll tool-use-logger tests passed.');
