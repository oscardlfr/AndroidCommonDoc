#!/usr/bin/env node
'use strict';

const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const {
  buildQualificationFromEvidence,
  captureClaudeCliCapability,
  promoteClaudeHostContract,
} = require('../lib/claude-host-contract-promotion.cjs');

function sha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'host-promotion-'));
  const executable = path.join(root, 'claude');
  fs.writeFileSync(executable, 'certified executable');
  fs.mkdirSync(path.join(root, 'observer'));
  const sessionId = 'session-fixture';
  const agentA = 'promotion-agent-a';
  const agentB = 'promotion-agent-b';
  const inputA = { description: 'probe A', subagent_type: 'probe-peer', name: 'probe-peer-a', prompt: 'A', run_in_background: true };
  const inputB = { description: 'probe B', subagent_type: 'probe-peer', name: 'probe-peer-b', prompt: 'B', run_in_background: false };
  const event = (hook, extras = {}) => {
    const raw = { hook_event_name: hook, session_id: sessionId, ...extras };
    return {
      schema: 'runtime/claude-host-contract-probe-event/v1',
      evidence_mode: 'genuine-pinned',
      producer: 'claude-host-contract-probe',
      hook_event_name: hook,
      session_digest: sha256(sessionId),
      tool_use_digest: raw.tool_use_id ? sha256(raw.tool_use_id) : null,
      prompt_id_digest: null,
      agent_id_digest: raw.agent_id ? sha256(raw.agent_id) : null,
      agent_type: raw.agent_type || null,
      tool_name: raw.tool_name || null,
      tool_input_digest: raw.tool_input === undefined ? null : sha256(canonicalJson(raw.tool_input)),
      updated_input_digest: extras.updated_input_digest || null,
      raw_event: raw,
      observed_at: '2026-09-26T15:55:18.629Z',
    };
  };
  const events = [
    event('SessionStart', { source: 'startup' }),
    event('PreToolUse', { tool_name: 'Agent', tool_use_id: 'tool-agent-a', tool_input: inputA,
      updated_input_digest: sha256(canonicalJson(inputA)) }),
    event('SubagentStart', { agent_id: agentA, agent_type: 'probe-peer' }),
    event('PreToolUse', { agent_id: agentA, agent_type: 'probe-peer', tool_name: 'Read', tool_use_id: 'read-a-1', tool_input: { file_path: 'a1' } }),
    event('PostToolUse', { agent_id: agentA, agent_type: 'probe-peer', tool_name: 'Read', tool_use_id: 'read-a-1', tool_input: { file_path: 'a1' } }),
    event('PreToolUse', { agent_id: agentA, agent_type: 'probe-peer', tool_name: 'Read', tool_use_id: 'read-a-2', tool_input: { file_path: 'a2' } }),
    event('PostToolUse', { agent_id: agentA, agent_type: 'probe-peer', tool_name: 'Read', tool_use_id: 'read-a-2', tool_input: { file_path: 'a2' } }),
    event('SubagentStop', { agent_id: agentA, agent_type: 'probe-peer' }),
    event('PostToolUse', { tool_name: 'Agent', tool_use_id: 'tool-agent-a', tool_input: inputA,
      tool_response: { isAsync: true, status: 'async_launched', agentId: agentA } }),
    event('PreToolUse', { tool_name: 'SendMessage', tool_use_id: 'tool-wake-a', tool_input: { recipient: 'probe-peer-a', message: 'wake' } }),
    event('PostToolUse', { tool_name: 'SendMessage', tool_use_id: 'tool-wake-a', tool_input: { recipient: 'probe-peer-a', message: 'wake' },
      tool_response: { success: true, resumedAgentId: agentA } }),
    event('SubagentStart', { agent_id: agentA, agent_type: 'probe-peer' }),
    event('PreToolUse', { agent_id: agentA, agent_type: 'probe-peer', tool_name: 'Read', tool_use_id: 'read-a-3', tool_input: { file_path: 'nonce' } }),
    event('PostToolUse', { agent_id: agentA, agent_type: 'probe-peer', tool_name: 'Read', tool_use_id: 'read-a-3', tool_input: { file_path: 'nonce' } }),
    event('SubagentStop', { agent_id: agentA, agent_type: 'probe-peer' }),
    event('PreToolUse', { tool_name: 'Agent', tool_use_id: 'tool-agent-b', tool_input: inputB,
      updated_input_digest: sha256(canonicalJson(inputB)) }),
    event('SubagentStart', { agent_id: agentB, agent_type: 'probe-peer' }),
    event('PreToolUse', { agent_id: agentB, agent_type: 'probe-peer', tool_name: 'Read', tool_use_id: 'read-b-1', tool_input: { file_path: 'b1' } }),
    event('PostToolUse', { agent_id: agentB, agent_type: 'probe-peer', tool_name: 'Read', tool_use_id: 'read-b-1', tool_input: { file_path: 'b1' } }),
    event('SubagentStop', { agent_id: agentB, agent_type: 'probe-peer' }),
    event('PostToolUse', { tool_name: 'Agent', tool_use_id: 'tool-agent-b', tool_input: inputB,
      tool_response: { status: 'completed', agentId: agentB, totalToolUseCount: 1 } }),
  ];
  fs.writeFileSync(path.join(root, 'observer', 'events.jsonl'), `${events.map(JSON.stringify).join('\n')}\n`);
  fs.writeFileSync(path.join(root, 'claude-stream.jsonl'), `${JSON.stringify({
    type: 'system', subtype: 'init', session_id: sessionId, model: 'claude-sonnet-5',
    claude_code_version: '2.1.283', tools: ['Task', 'Bash', 'Read', 'SendMessage'],
    mcp_servers: [{ name: 'fixture-mcp', status: 'connected' }],
  })}\n`);
  const init = { model: 'claude-sonnet-5', claude_code_version: '2.1.283' };
  fs.writeFileSync(path.join(root, 'run-state.json'), JSON.stringify({
    operation: 'host-contract-probe', status: 'HOST_CONTRACT_PROBE_COMPLETED',
    host_capability: 'HOST_CONTRACT_OBSERVED', evidence_mode: 'genuine-pinned', exit_code: 0,
    source_unchanged: true, writers_settled: true, stdin_closed_after_terminal: true,
    stable_actor_resume: true, distinct_same_type_peers: true, required_hooks_observed: true,
    extra_tools_mcp_compatible: true, execution_input_exact: true, session_id: sessionId,
    finished_at: '2026-09-26T15:55:18.629Z', init,
    cli_pin: { version: '2.1.283', executable_realpath: executable,
      executable_sha256: sha256(fs.readFileSync(executable)) },
  }));
  fs.writeFileSync(path.join(root, 'run-record.json'), JSON.stringify({
    operation: 'host-contract-probe', host_capability: 'HOST_CONTRACT_OBSERVED',
    evidence_mode: 'genuine-pinned', init,
  }));
  return { root, executable };
}

function toolkitFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'host-promotion-toolkit-'));
  const observer = path.join(root, 'scripts', 'tests', 'fixtures', 'claude-host-contract-probe.cjs');
  fs.mkdirSync(path.dirname(observer), { recursive: true });
  fs.mkdirSync(path.join(root, 'skills'), { recursive: true });
  fs.mkdirSync(path.join(root, 'setup'), { recursive: true });
  fs.writeFileSync(path.join(root, 'skills', 'registry.json'), '{}\n');
  fs.copyFileSync(path.join(__dirname, 'fixtures', 'claude-host-contract-probe.cjs'), observer);
  for (const args of [
    ['init', '-q'],
    ['config', 'user.email', 'host-promotion@example.invalid'],
    ['config', 'user.name', 'Host Promotion Test'],
    ['add', '.'],
    ['commit', '-qm', 'fixture'],
  ]) {
    const git = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    assert.strictEqual(git.status, 0, git.stderr);
  }
  return { root, observer };
}

test('completed genuine probe evidence deterministically derives qualification', () => {
  const value = fixture();
  try {
    const built = buildQualificationFromEvidence(value.root);
    assert.strictEqual(built.ok, true, JSON.stringify(built));
    assert.strictEqual(built.qualification.cli.version, '2.1.283');
    assert.strictEqual(built.qualification.cli.executable_sha256, sha256(fs.readFileSync(value.executable)));
    assert.strictEqual(built.qualification.observed_contract.canonical_five_key_input_executed, true);
    assert.match(built.qualification.evidence_sha256['observer/events.jsonl'], /^[0-9a-f]{64}$/);
  } finally { fs.rmSync(value.root, { recursive: true, force: true }); }
});

test('partial evidence and executable drift are never promotable', () => {
  const value = fixture();
  try {
    const statePath = path.join(value.root, 'run-state.json');
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    state.writers_settled = false;
    fs.writeFileSync(statePath, JSON.stringify(state));
    assert.strictEqual(buildQualificationFromEvidence(value.root).reason, 'HOST_CONTRACT_EVIDENCE_NOT_PROMOTABLE');
    state.writers_settled = true;
    fs.writeFileSync(statePath, JSON.stringify(state));
    fs.appendFileSync(value.executable, ' drift');
    assert.strictEqual(buildQualificationFromEvidence(value.root).reason, 'HOST_CONTRACT_EXECUTABLE_DRIFT');
  } finally { fs.rmSync(value.root, { recursive: true, force: true }); }
});

test('CLI capability derives semver from output rather than the executable filename', {
  skip: process.platform === 'win32',
}, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'host-capability-'));
  const executable = path.join(root, 'claude-current');
  try {
    fs.writeFileSync(executable, '#!/bin/sh\nprintf "2.1.999 (Claude Code)\\n"\n', { mode: 0o700 });
    const captured = captureClaudeCliCapability(executable);
    assert.strictEqual(captured.ok, true, JSON.stringify(captured));
    assert.strictEqual(captured.capability.executable.version, '2.1.999');
    assert.strictEqual(path.basename(captured.capability.executable.realpath), 'claude-current');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('promotion API and CLI publish and post-verify an evidence-derived package', () => {
  const directEvidence = fixture();
  const directToolkit = toolkitFixture();
  const cliEvidence = fixture();
  const cliToolkit = toolkitFixture();
  try {
    const promoted = promoteClaudeHostContract({
      projectRoot: directToolkit.root,
      evidenceRoot: directEvidence.root,
      observerPath: directToolkit.observer,
    });
    assert.strictEqual(promoted.ok, true, JSON.stringify(promoted));
    assert.strictEqual(fs.existsSync(promoted.qualificationPath), true);
    assert.strictEqual(fs.existsSync(promoted.packagePath), true);

    const cli = spawnSync(process.execPath, [path.join(__dirname, '..', 'tools', 'promote-claude-host-contract.cjs'),
      '--project-root', cliToolkit.root, '--evidence-root', cliEvidence.root,
      '--observer-path', cliToolkit.observer], { encoding: 'utf8' });
    assert.strictEqual(cli.status, 0, cli.stdout + cli.stderr);
    const output = JSON.parse(cli.stdout);
    assert.strictEqual(output.ok, true, cli.stdout);
    assert.strictEqual(fs.existsSync(output.packagePath), true);
  } finally {
    fs.rmSync(directEvidence.root, { recursive: true, force: true });
    fs.rmSync(directToolkit.root, { recursive: true, force: true });
    fs.rmSync(cliEvidence.root, { recursive: true, force: true });
    fs.rmSync(cliToolkit.root, { recursive: true, force: true });
  }
});

test('promotion rejects semantically invalid raw observations without publishing a package', () => {
  const evidence = fixture();
  const toolkit = toolkitFixture();
  try {
    const eventsPath = path.join(evidence.root, 'observer', 'events.jsonl');
    const events = fs.readFileSync(eventsPath, 'utf8').trim().split('\n');
    fs.writeFileSync(eventsPath, `${events.slice(1).join('\n')}\n`);
    const promoted = promoteClaudeHostContract({
      projectRoot: toolkit.root,
      evidenceRoot: evidence.root,
      observerPath: toolkit.observer,
    });
    assert.strictEqual(promoted.ok, false, JSON.stringify(promoted));
    assert.strictEqual(promoted.reason, 'HOST_PROBE_HOOK_TOPOLOGY_INVALID');
    assert.deepEqual(fs.readdirSync(path.join(toolkit.root, 'setup')), []);
  } finally {
    fs.rmSync(evidence.root, { recursive: true, force: true });
    fs.rmSync(toolkit.root, { recursive: true, force: true });
  }
});

test('recertification CLI fails closed before probing when its executable contract is absent or malformed', () => {
  const toolkit = toolkitFixture();
  const malformed = path.join(toolkit.root, 'claude-malformed');
  try {
    const tool = path.join(__dirname, '..', 'tools', 'recertify-claude-host-contract.cjs');
    const missing = spawnSync(process.execPath, [tool, '--project-root', toolkit.root], { encoding: 'utf8' });
    assert.strictEqual(missing.status, 64, missing.stdout + missing.stderr);
    assert.strictEqual(JSON.parse(missing.stdout).reason, 'REQUIRED_ARGUMENT_MISSING:--claude-executable');

    fs.writeFileSync(malformed, '#!/bin/sh\nprintf "unexpected version\\n"\n', { mode: 0o700 });
    const invalid = spawnSync(process.execPath, [tool, '--project-root', toolkit.root,
      '--claude-executable', malformed], { encoding: 'utf8' });
    assert.strictEqual(invalid.status, 1, invalid.stdout + invalid.stderr);
    assert.strictEqual(JSON.parse(invalid.stdout).reason, 'HOST_CONTRACT_CLI_VERSION_UNEXPECTED');
  } finally { fs.rmSync(toolkit.root, { recursive: true, force: true }); }
});
