#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  atomicWriteJson,
  captureClaudeCliCapability,
  promoteClaudeHostContract,
} = require('../lib/claude-host-contract-promotion.cjs');

function value(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

const projectRoot = path.resolve(value('--project-root') || path.join(__dirname, '..', '..'));
const executableArg = value('--claude-executable');
if (!executableArg) {
  process.stdout.write(JSON.stringify({ ok: false, reason: 'REQUIRED_ARGUMENT_MISSING:--claude-executable' }) + '\n');
  process.exit(64);
}
const captured = captureClaudeCliCapability(path.resolve(executableArg));
if (!captured.ok) {
  process.stdout.write(JSON.stringify(captured) + '\n');
  process.exit(1);
}
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'androidcommondoc-claude-recert-'));
try {
  const capabilityPath = path.join(temporaryRoot, 'cli-capability.json');
  atomicWriteJson(capabilityPath, captured.capability);
  const launcher = path.join(projectRoot, 'scripts', 'tools', 'claude-functional-certification.cjs');
  const probe = spawnSync(process.execPath, [
    launcher, projectRoot,
    '--operation', 'host-contract-probe',
    '--transport-profile', 'native-claude-cli',
    '--claude-executable', captured.capability.executable.realpath,
    '--cli-capability', capabilityPath,
  ], { cwd: projectRoot, encoding: 'utf8', timeout: 15 * 60_000, maxBuffer: 32 * 1024 * 1024 });
  const stateMatch = /P4_LIVE_STATE=([^\r\n]+)/.exec(probe.stderr || '');
  if (probe.status !== 0 || !stateMatch) {
    process.stdout.write(JSON.stringify({
      ok: false, reason: probe.error?.code === 'ETIMEDOUT' ? 'HOST_CONTRACT_PROBE_TIMEOUT' : 'HOST_CONTRACT_PROBE_FAILED',
      exitCode: probe.status, statePath: stateMatch ? stateMatch[1].trim() : null,
    }, null, 2) + '\n');
    process.exitCode = 1;
  } else {
    const evidenceRoot = path.dirname(stateMatch[1].trim());
    const promoted = promoteClaudeHostContract({ projectRoot, evidenceRoot, replaceExisting: true });
    process.stdout.write(JSON.stringify({ ...promoted, evidenceRoot }, null, 2) + '\n');
    if (!promoted.ok) process.exitCode = 1;
  }
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
