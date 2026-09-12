#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createJsonlFrameFeeder, writeJsonlFrame } = require('../lib/runtime-bridge-codex.cjs');

function arg(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

const projectRoot = path.resolve(arg('--project-root') || process.cwd());
const executable = path.resolve(arg('--claude-executable') || '');
const evidenceRoot = path.resolve(arg('--evidence-root') || '');
const role = arg('--role') || 'context-provider';
if (!fs.existsSync(projectRoot) || !fs.existsSync(executable) || !evidenceRoot || !/^[a-z][a-z0-9-]+$/.test(role)) {
  process.stderr.write('usage: claude-direct-role-host-probe.cjs --project-root ROOT --claude-executable FILE --evidence-root DIR [--role ROLE]\n');
  process.exit(64);
}
fs.mkdirSync(evidenceRoot, { recursive: true });
const sessionId = crypto.randomUUID();
const nonce = crypto.randomBytes(16).toString('hex');
const transcriptPath = path.join(evidenceRoot, 'direct-role-probe-stream.jsonl');
const stderrPath = path.join(evidenceRoot, 'direct-role-probe-stderr.log');
const resultPath = path.join(evidenceRoot, 'direct-role-probe-result.json');
fs.writeFileSync(transcriptPath, '', { flag: 'wx' });
fs.writeFileSync(stderrPath, '', { flag: 'wx' });

const definition = {
  [role]: {
    description: 'Authority-free direct role host transport probe.',
    prompt: 'Follow each probe frame exactly. Do not use tools. Reply with only the requested marker and remain available for the next frame.',
    tools: ['Read'],
    model: 'sonnet',
  },
};
const argv = [
  '-p', '--verbose', '--input-format', 'stream-json', '--output-format', 'stream-json',
  '--include-hook-events', '--replay-user-messages', '--no-session-persistence',
  '--session-id', sessionId, '--model', 'sonnet', '--effort', 'high',
  '--agent', role, '--agents', JSON.stringify(definition),
  '--setting-sources', '', '--strict-mcp-config', '--permission-mode', 'dontAsk',
  '--permission-prompts', 'none', '--tools', 'Read',
];
const env = { ...process.env, CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1', TEMP: evidenceRoot, TMP: evidenceRoot, TMPDIR: evidenceRoot };
delete env.ANTHROPIC_API_KEY;
delete env.ANTHROPIC_AUTH_TOKEN;
delete env.CLAUDE_CONFIG_DIR;
const child = spawn(executable, argv, {
  cwd: projectRoot, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
});

const prompts = [
  'DIRECT_ROLE_HOST_PROBE/v1 turn=1. Use no tools. Reply exactly DRH_TURN_1_READY.',
  `DIRECT_ROLE_HOST_PROBE/v1 turn=2 nonce=${nonce}. Use no tools. Reply exactly DRH_TURN_2_${nonce}.`,
];
const expectedMarkers = ['DRH_TURN_1_READY', `DRH_TURN_2_${nonce}`];
const sentDigests = [];
const echoedDigests = [];
const assistantText = [];
let init = null;
let resultCount = 0;
let toolUseCount = 0;
let foreignFrame = false;
let parentToolFrameCount = 0;
let finished = false;

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function persist(status, detail) {
  fs.writeFileSync(resultPath, `${JSON.stringify({
    schema: 'runtime/claude-direct-role-host-probe/v1', status, detail,
    project_root: projectRoot, executable: fs.realpathSync(executable), role,
    session_id: sessionId, session_digest: digest(sessionId), nonce_digest: digest(nonce),
    argv, init, result_count: resultCount, tool_use_count: toolUseCount,
    parent_tool_frame_count: parentToolFrameCount, foreign_frame: foreignFrame,
    sent_message_digests: sentDigests, echoed_message_digests: echoedDigests,
    assistant_text_digests: assistantText.map(digest), transcript_path: transcriptPath,
    stderr_path: stderrPath, completed_at: new Date().toISOString(),
  }, null, 2)}\n`);
}
function stopFailure(detail) {
  if (finished) return;
  finished = true;
  persist('FAILED', detail);
  child.kill();
}
function sendTurn(index) {
  const frame = { type: 'user', message: { role: 'user', content: [{ type: 'text', text: prompts[index] }] } };
  sentDigests.push(digest(frame.message));
  writeJsonlFrame(child.stdin, frame, (error) => {
    if (error) stopFailure(`stdin:${error.message}`);
  });
}
function onFrame(event) {
  if (event && typeof event.session_id === 'string' && event.session_id !== sessionId) foreignFrame = true;
  if (event && typeof event.parent_tool_use_id === 'string') parentToolFrameCount += 1;
  if (event.type === 'system' && event.subtype === 'init' && init === null) {
    init = {
      cwd: event.cwd, model: event.model, tools: event.tools, agents: event.agents,
      claude_code_version: event.claude_code_version,
    };
    const tools = Array.isArray(event.tools) ? event.tools : [];
    if (event.session_id !== sessionId || path.resolve(event.cwd || '') !== projectRoot
        || !Array.isArray(event.agents) || !event.agents.includes(role)
        || !tools.includes('Read') || tools.includes('Agent') || tools.includes('Task')
        || tools.includes('SendMessage')) return stopFailure('invalid-system-init');
    return;
  }
  if (event.type === 'user' && event.message && Array.isArray(event.message.content)
      && event.message.content.some((block) => block && block.type === 'text')) {
    echoedDigests.push(digest(event.message));
  }
  if (event.type === 'assistant' && event.message && Array.isArray(event.message.content)) {
    for (const block of event.message.content) {
      if (block && block.type === 'tool_use') toolUseCount += 1;
      if (block && block.type === 'text' && typeof block.text === 'string') assistantText.push(block.text.trim());
    }
  }
  if (event.type === 'result') {
    resultCount += 1;
    const index = resultCount - 1;
    if (event.is_error === true || !assistantText.some((text) => text === expectedMarkers[index])) {
      return stopFailure(`invalid-result-${resultCount}`);
    }
    if (resultCount === 1) return sendTurn(1);
    if (resultCount === 2) {
      const valid = init !== null && toolUseCount === 0 && !foreignFrame && parentToolFrameCount === 0
        && sentDigests.length === 2 && echoedDigests.length === 2
        && sentDigests.every((value, indexValue) => value === echoedDigests[indexValue]);
      if (!valid) return stopFailure('transport-invariants-failed');
      finished = true;
      persist('PASSED', 'two-turn-direct-role-host-stable');
      child.stdin.end();
    }
  }
}

const feed = createJsonlFrameFeeder(onFrame, (reason) => stopFailure(`stream:${reason}`), () => finished && resultCount < 2);
child.stdout.on('data', (chunk) => {
  fs.appendFileSync(transcriptPath, chunk);
  feed(chunk);
});
child.stderr.on('data', (chunk) => fs.appendFileSync(stderrPath, chunk));
child.on('error', (error) => stopFailure(`spawn:${error.message}`));
const timeout = setTimeout(() => stopFailure('timeout'), 180000);
sendTurn(0);
child.on('exit', (code, signal) => {
  clearTimeout(timeout);
  if (!finished) persist('FAILED', `exit-before-complete:${code}:${signal || ''}`);
  process.exit(finished && resultCount === 2 && code === 0 ? 0 : 1);
});
