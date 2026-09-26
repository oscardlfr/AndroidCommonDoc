#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const host = require('./runtime-host-claude.cjs');

const QUALIFICATION_SCHEMA = 'androidcommondoc/p1-native-host-contract-qualification/v1';
const DIGEST_RE = /^[0-9a-f]{64}$/;

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function atomicWriteJson(file, value) {
  const parent = path.dirname(file);
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  const temporary = path.join(parent, `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`);
  let fd;
  try {
    fd = fs.openSync(temporary, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
    fs.writeFileSync(fd, JSON.stringify(value, null, 2) + '\n', 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temporary, file);
    if (process.platform !== 'win32') {
      const parentFd = fs.openSync(parent, fs.constants.O_RDONLY);
      try { fs.fsyncSync(parentFd); } finally { fs.closeSync(parentFd); }
    }
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch { /* best effort */ }
    try { fs.unlinkSync(temporary); } catch { /* best effort */ }
  }
}

function captureClaudeCliCapability(executablePath) {
  let realpath;
  try { realpath = fs.realpathSync(executablePath); } catch {
    return { ok: false, reason: 'HOST_CONTRACT_EXECUTABLE_UNAVAILABLE' };
  }
  const version = spawnSync(realpath, ['--version'], { encoding: 'utf8', timeout: 30_000 });
  const match = /^(\d+\.\d+\.\d+) \(Claude Code\)\n$/.exec(version.stdout || '');
  if (version.status !== 0 || version.error || !match) {
    return { ok: false, reason: 'HOST_CONTRACT_CLI_VERSION_UNEXPECTED' };
  }
  return {
    ok: true,
    capability: {
      schema: 'androidcommondoc/claude-cli-capability-capture/v1',
      decision: 'DUPLEX_STREAM_JSON_SUPPORTED',
      executable: { realpath, sha256: sha256File(realpath), version: match[1] },
      commands: [{ argv: [realpath, '--version'], exit_code: version.status, stdout: version.stdout }],
    },
  };
}

function buildQualificationFromEvidence(evidenceRoot) {
  const root = path.resolve(evidenceRoot);
  const state = readJson(path.join(root, 'run-state.json'));
  const record = readJson(path.join(root, 'run-record.json'));
  if (!state || !record || state.operation !== 'host-contract-probe' || record.operation !== 'host-contract-probe'
      || state.status !== 'HOST_CONTRACT_PROBE_COMPLETED' || state.host_capability !== 'HOST_CONTRACT_OBSERVED'
      || record.host_capability !== 'HOST_CONTRACT_OBSERVED' || state.evidence_mode !== 'genuine-pinned'
      || record.evidence_mode !== 'genuine-pinned' || state.exit_code !== 0 || state.source_unchanged !== true
      || state.writers_settled !== true || state.stdin_closed_after_terminal !== true
      || state.stable_actor_resume !== true || state.distinct_same_type_peers !== true
      || state.required_hooks_observed !== true || state.extra_tools_mcp_compatible !== true
      || state.execution_input_exact !== true || typeof state.session_id !== 'string'
      || !state.cli_pin || !state.init || state.init.claude_code_version !== state.cli_pin.version
      || state.init.model !== record.init?.model || !Number.isFinite(Date.parse(state.finished_at))) {
    return { ok: false, reason: 'HOST_CONTRACT_EVIDENCE_NOT_PROMOTABLE' };
  }
  let executableRealpath;
  try { executableRealpath = fs.realpathSync(state.cli_pin.executable_realpath); } catch {
    return { ok: false, reason: 'HOST_CONTRACT_EXECUTABLE_UNAVAILABLE' };
  }
  const executableDigest = sha256File(executableRealpath);
  if (!DIGEST_RE.test(state.cli_pin.executable_sha256) || executableDigest !== state.cli_pin.executable_sha256) {
    return { ok: false, reason: 'HOST_CONTRACT_EXECUTABLE_DRIFT' };
  }
  const observer = path.join(root, 'observer', 'events.jsonl');
  const stream = path.join(root, 'claude-stream.jsonl');
  if (!fs.existsSync(observer) || !fs.existsSync(stream)) {
    return { ok: false, reason: 'HOST_CONTRACT_REQUIRED_EVIDENCE_MISSING' };
  }
  return {
    ok: true,
    qualification: {
      schema: QUALIFICATION_SCHEMA,
      status: 'HOST_CONTRACT_OBSERVED',
      session_id: state.session_id,
      qualified_at: new Date(state.finished_at).toISOString(),
      transport_profile: 'native-claude-cli',
      cli: {
        version: state.cli_pin.version,
        executable_realpath: executableRealpath,
        executable_sha256: executableDigest,
        actual_model: state.init.model,
      },
      evidence_sha256: {
        'observer/events.jsonl': sha256File(observer),
        'claude-stream.jsonl': sha256File(stream),
      },
      observed_contract: {
        same_actor_resume: true,
        different_same_type_peer: true,
        required_tools_present: true,
        additional_tools_allowed: true,
        post_tool_use_exposes_executed_input: true,
        canonical_five_key_input_executed: true,
      },
    },
  };
}

function promoteClaudeHostContract({ projectRoot, evidenceRoot, observerPath, replaceExisting = true }) {
  const project = path.resolve(projectRoot);
  const evidence = path.resolve(evidenceRoot);
  const observer = path.resolve(observerPath || path.join(project, 'scripts', 'tests', 'fixtures', 'claude-host-contract-probe.cjs'));
  if (!fs.existsSync(path.join(project, 'skills', 'registry.json')) || !fs.existsSync(observer)) {
    return { ok: false, reason: 'HOST_CONTRACT_TOOLKIT_ROOT_INVALID' };
  }
  const built = buildQualificationFromEvidence(evidence);
  if (!built.ok) return built;
  const qualificationPath = path.join(evidence, 'qualification.json');
  atomicWriteJson(qualificationPath, built.qualification);
  const published = host.publishClaudeHostContractPackage({
    projectRoot: project,
    evidenceRoot: evidence,
    qualificationPath,
    observerPath: observer,
    replaceExisting,
  });
  if (!published.ok) return published;
  const verified = host.verifyClaudeHostContractPackage(project, {
    executablePath: built.qualification.cli.executable_realpath,
    cliVersion: built.qualification.cli.version,
    observerPath: observer,
    transportProfile: built.qualification.transport_profile,
    os: process.platform,
  });
  if (!verified.ok) return { ok: false, reason: 'HOST_CONTRACT_POST_PUBLISH_VERIFY_FAILED', verification: verified };
  return {
    ok: true,
    qualificationPath,
    packagePath: published.packagePath,
    cliVersion: built.qualification.cli.version,
    executableSha256: built.qualification.cli.executable_sha256,
    replaced: published.replaced === true,
    pinDigest: verified.pinDigest,
  };
}

module.exports = { atomicWriteJson, buildQualificationFromEvidence, captureClaudeCliCapability, promoteClaudeHostContract };
