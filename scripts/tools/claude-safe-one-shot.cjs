#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

function failUsage(reason) {
  process.stderr.write(JSON.stringify({ ok: false, reason }) + '\n');
  process.exit(64);
}

const VALUE_OPTIONS = new Set([
  '--project-root', '--l0-root', '--claude-executable', '--prompt-file',
  '--evidence-root', '--startup-timeout-ms', '--activity-timeout-ms',
  '--overall-timeout-ms', '--tools', '--model', '--effort', '--max-budget-usd',
]);
const parsedOptions = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  const name = process.argv[index];
  const optionValue = process.argv[index + 1];
  if (!VALUE_OPTIONS.has(name)) failUsage(`UNKNOWN_ARGUMENT:${name}`);
  if (optionValue === undefined || optionValue.startsWith('--')) failUsage(`VALUE_MISSING:${name}`);
  if (parsedOptions.has(name)) failUsage(`DUPLICATE_ARGUMENT:${name}`);
  parsedOptions.set(name, optionValue);
}

function value(name) {
  return parsedOptions.get(name) ?? null;
}

function boundedMilliseconds(name, fallback, minimum, maximum) {
  const raw = value(name);
  if (raw === null) return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    failUsage(`INVALID_ARGUMENT:${name}`);
  }
  return parsed;
}

function boundedDecimal(name, minimum, maximum) {
  const raw = value(name);
  if (raw === null) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    failUsage(`INVALID_ARGUMENT:${name}`);
  }
  return parsed;
}

function realDirectory(name) {
  const candidate = value(name);
  if (!candidate) failUsage(`REQUIRED_ARGUMENT_MISSING:${name}`);
  let resolved;
  try {
    resolved = fs.realpathSync(candidate);
    if (!fs.statSync(resolved).isDirectory()) throw new Error('not a directory');
  } catch (err) {
    failUsage(`INVALID_DIRECTORY:${name}:${err instanceof Error ? err.message : String(err)}`);
  }
  return resolved;
}

function realRegularFile(name, rejectSymlink = false) {
  const candidate = value(name);
  if (!candidate) failUsage(`REQUIRED_ARGUMENT_MISSING:${name}`);
  let resolved;
  try {
    if (rejectSymlink && fs.lstatSync(candidate).isSymbolicLink()) throw new Error('symlink is not allowed');
    resolved = fs.realpathSync(candidate);
    if (!fs.statSync(resolved).isFile()) throw new Error('not a regular file');
  } catch (err) {
    failUsage(`INVALID_FILE:${name}:${err instanceof Error ? err.message : String(err)}`);
  }
  return resolved;
}

function atomicWriteJson(destination, payload) {
  const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(payload, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, destination);
}

const projectRoot = realDirectory('--project-root');
const l0Root = realDirectory('--l0-root');
const claudeExecutable = realRegularFile('--claude-executable');
const promptFile = realRegularFile('--prompt-file', true);
const promptInfo = fs.lstatSync(promptFile);
if (promptInfo.size > 1024 * 1024) failUsage('PROMPT_FILE_UNSAFE');
const prompt = fs.readFileSync(promptFile, 'utf8');
if (prompt.trim() === '') failUsage('PROMPT_FILE_EMPTY');

const requestedTools = value('--tools') ?? 'Read,Glob,Grep';
const toolProfiles = new Map([
  ['', 'none'],
  ['Read,Glob,Grep', 'read'],
  ['Read,Glob,Grep,Bash', 'repair'],
]);
if (!toolProfiles.has(requestedTools)) failUsage('INVALID_ARGUMENT:--tools');
const toolProfile = toolProfiles.get(requestedTools);
const expectedTools = requestedTools === '' ? [] : requestedTools.split(',');
const maxBudgetUsd = boundedDecimal('--max-budget-usd', 0.01, 100);
const model = value('--model');
const effort = value('--effort');
const inheritedEffort = typeof process.env.CLAUDE_CODE_EFFORT_LEVEL === 'string'
  && process.env.CLAUDE_CODE_EFFORT_LEVEL.trim() !== ''
  ? process.env.CLAUDE_CODE_EFFORT_LEVEL.trim() : null;
if (inheritedEffort !== null && effort === null) {
  failUsage('INHERITED_EFFORT_AUTHORITY_REQUIRES_EXPLICIT_EFFORT');
}
if (inheritedEffort !== null && inheritedEffort !== effort) {
  failUsage('CONFLICTING_EFFORT_AUTHORITY');
}

const startupTimeoutMs = boundedMilliseconds('--startup-timeout-ms', 60_000, 25, 10 * 60_000);
const activityTimeoutMs = boundedMilliseconds('--activity-timeout-ms', 120_000, 25, 30 * 60_000);
const overallTimeoutMs = boundedMilliseconds('--overall-timeout-ms', 15 * 60_000, 100, 60 * 60_000);
if (overallTimeoutMs <= startupTimeoutMs) failUsage('INVALID_TIMEOUT_ORDER');

const evidenceRootArg = value('--evidence-root');
const evidenceParent = evidenceRootArg ? path.resolve(evidenceRootArg) : os.tmpdir();
fs.mkdirSync(evidenceParent, { recursive: true });
const evidenceRoot = fs.mkdtempSync(path.join(evidenceParent, 'androidcommondoc-claude-one-shot-'));
const stdoutPath = path.join(evidenceRoot, 'stdout.jsonl');
const stderrPath = path.join(evidenceRoot, 'stderr.log');
const statePath = path.join(evidenceRoot, 'run-state.json');
fs.writeFileSync(stdoutPath, '', { encoding: 'utf8', mode: 0o600 });
fs.writeFileSync(stderrPath, '', { encoding: 'utf8', mode: 0o600 });

const args = [
  '--safe-mode', '--restricted', '-p', '--no-session-persistence',
  '--add-dir', l0Root,
  '--permission-mode', 'dontAsk', '--permission-prompts', 'none',
  '--tools', requestedTools,
  '--output-format', 'stream-json', '--include-partial-messages', '--verbose',
];
if (model) args.push('--model', model);
if (effort) args.push('--effort', effort);
if (maxBudgetUsd !== null) args.push('--max-budget-usd', String(maxBudgetUsd));

const state = {
  schema: 'androidcommondoc/claude-safe-one-shot/v1',
  status: 'STARTING',
  started_at: new Date().toISOString(),
  project_root: projectRoot,
  l0_root: l0Root,
  executable: claudeExecutable,
  launch_contract: {
    safe_mode: true,
    restricted: true,
    bare: false,
    session_persistence: false,
    tool_profile: toolProfile,
    requested_tools: expectedTools,
  },
  requested_effort: effort,
  observed_effort: null,
  effective_effort: null,
  effort_verification: effort ? 'unproven' : 'not-requested',
  effort_environment: {
    inherited: inheritedEffort,
    child: effort,
    policy: effort ? 'explicit-cli-and-environment-match' : 'environment-absent',
  },
  max_budget_usd: maxBudgetUsd,
  timeouts_ms: { startup: startupTimeoutMs, first_activity: activityTimeoutMs, overall: overallTimeoutMs },
  init_observed: false,
  init_projection: null,
  activity_observed: false,
  terminal_receipt_observed: false,
  accounting_complete: false,
  terminal_receipt: null,
  last_usage: null,
  total_cost_usd: null,
  subagent_stats: null,
  stdout_bytes: 0,
  stderr_bytes: 0,
  failure_reason: null,
};
atomicWriteJson(statePath, state);
process.stderr.write(`CLAUDE_ONE_SHOT_EVIDENCE=${evidenceRoot}\n`);

const child = spawn(claudeExecutable, args, {
  cwd: projectRoot,
  env: effort === null
    ? process.env
    : { ...process.env, CLAUDE_CODE_EFFORT_LEVEL: effort },
  stdio: ['pipe', 'pipe', 'pipe'],
  windowsHide: true,
});
state.pid = child.pid ?? null;
state.status = 'ACTIVE';
atomicWriteJson(statePath, state);

let stdoutBuffer = '';
let terminating = false;
let forceKillTimer = null;
let activityTimer = null;

function persistFailure(reason) {
  if (state.failure_reason === null) state.failure_reason = reason;
  state.status = 'TERMINATING';
  atomicWriteJson(statePath, state);
}

function terminate(reason) {
  if (terminating) return;
  terminating = true;
  persistFailure(reason);
  process.stderr.write(`${reason}; terminating Claude one-shot. Evidence: ${evidenceRoot}\n`);
  child.kill('SIGTERM');
  forceKillTimer = setTimeout(() => child.kill('SIGKILL'), 5_000);
}

const startupTimer = setTimeout(() => terminate('HOST_STARTUP_TIMEOUT'), startupTimeoutMs);
const overallTimer = setTimeout(() => terminate('HOST_OVERALL_TIMEOUT'), overallTimeoutMs);

function observeLine(line) {
  if (line.trim() === '') return;
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    terminate('HOST_STREAM_MALFORMED');
    return;
  }
  if (!state.init_observed && event && event.type === 'system' && event.subtype === 'init') {
    const advertisedTools = Array.isArray(event.tools) && event.tools.every((tool) => typeof tool === 'string')
      ? event.tools : null;
    const advertisedSet = advertisedTools === null ? null : new Set(advertisedTools);
    const expectedSet = new Set(expectedTools);
    const toolsMatch = advertisedSet !== null && advertisedSet.size === expectedSet.size &&
      [...expectedSet].every((tool) => advertisedSet.has(tool));
    if (!toolsMatch) {
      terminate('HOST_INIT_TOOL_MISMATCH');
      return;
    }
    if (effort && event.per_turn_effort_active !== true) {
      terminate(event.per_turn_effort_active === false ? 'HOST_EFFORT_INACTIVE' : 'HOST_EFFORT_UNPROVEN');
      return;
    }
    state.init_observed = true;
    state.init_projection = {
      tools: advertisedTools,
      agents: Array.isArray(event.agents) ? event.agents : null,
      capabilities: Array.isArray(event.capabilities) ? event.capabilities : null,
      model: typeof event.model === 'string' ? event.model : null,
      per_turn_effort_active: typeof event.per_turn_effort_active === 'boolean'
        ? event.per_turn_effort_active : null,
    };
    clearTimeout(startupTimer);
    activityTimer = setTimeout(() => terminate('HOST_FIRST_ACTIVITY_TIMEOUT'), activityTimeoutMs);
    atomicWriteJson(statePath, state);
    return;
  }
  if (state.init_observed && !state.activity_observed && event &&
      (event.type === 'assistant' || event.type === 'stream_event' || event.type === 'result')) {
    state.activity_observed = true;
    if (activityTimer !== null) clearTimeout(activityTimer);
    atomicWriteJson(statePath, state);
  }
  if (event && event.type === 'assistant') {
    const observedEffort = typeof event.effort === 'string'
      ? event.effort
      : (typeof event.message?.effort === 'string' ? event.message.effort : null);
    if (observedEffort !== null) {
      state.observed_effort = observedEffort;
      state.effective_effort = observedEffort;
      state.effort_verification = effort && observedEffort === effort ? 'observed' : 'mismatch';
      if (effort && observedEffort !== effort) terminate('HOST_EFFORT_MISMATCH');
    }
    if (event.message && event.message.usage && typeof event.message.usage === 'object') {
      state.last_usage = event.message.usage;
    }
    atomicWriteJson(statePath, state);
  }
  if (event && event.type === 'result') {
    if (state.terminal_receipt_observed) {
      terminate('HOST_MULTIPLE_TERMINAL_RESULTS');
      return;
    }
    state.terminal_receipt_observed = true;
    const terminalUsage = event.usage && typeof event.usage === 'object' ? event.usage : null;
    state.last_usage = terminalUsage ?? state.last_usage;
    state.total_cost_usd = Number.isFinite(event.total_cost_usd) ? event.total_cost_usd : null;
    state.subagent_stats = event.subagent_stats && typeof event.subagent_stats === 'object'
      ? event.subagent_stats : null;
    state.accounting_complete = terminalUsage !== null && state.total_cost_usd !== null;
    state.terminal_receipt = {
      subtype: typeof event.subtype === 'string' ? event.subtype : null,
      is_error: event.is_error === true,
      terminal_reason: typeof event.terminal_reason === 'string' ? event.terminal_reason : null,
      usage_observed: terminalUsage !== null,
      cost_observed: state.total_cost_usd !== null,
    };
    if (!state.accounting_complete) {
      terminate('HOST_ACCOUNTING_INCOMPLETE');
    } else if (state.subagent_stats === null || !Number.isSafeInteger(state.subagent_stats.spawned)) {
      terminate('HOST_SUBAGENT_STATS_MISSING');
    } else if (state.subagent_stats.spawned !== 0) {
      terminate('HOST_UNEXPECTED_SUBAGENTS');
    } else if (effort && state.effort_verification !== 'observed') {
      terminate('HOST_EFFORT_UNPROVEN');
    } else if (event.is_error === true || event.subtype !== 'success') {
      terminate(`HOST_RESULT_ERROR:${typeof event.subtype === 'string' ? event.subtype : 'unknown'}`);
    }
    atomicWriteJson(statePath, state);
  }
}

child.stdout.on('data', (chunk) => {
  fs.appendFileSync(stdoutPath, chunk);
  state.stdout_bytes += chunk.length;
  process.stdout.write(chunk);
  stdoutBuffer += chunk.toString('utf8');
  for (;;) {
    const newline = stdoutBuffer.indexOf('\n');
    if (newline === -1) break;
    const line = stdoutBuffer.slice(0, newline);
    stdoutBuffer = stdoutBuffer.slice(newline + 1);
    observeLine(line);
  }
});

child.stderr.on('data', (chunk) => {
  fs.appendFileSync(stderrPath, chunk);
  state.stderr_bytes += chunk.length;
  process.stderr.write(chunk);
});

child.on('error', (err) => terminate(`HOST_SPAWN_ERROR:${err.message}`));
child.on('close', (code, signal) => {
  clearTimeout(startupTimer);
  clearTimeout(overallTimer);
  if (activityTimer !== null) clearTimeout(activityTimer);
  if (forceKillTimer !== null) clearTimeout(forceKillTimer);
  if (stdoutBuffer !== '') observeLine(stdoutBuffer);
  if (state.failure_reason === null && code !== 0) {
    state.failure_reason = state.init_observed ? 'HOST_EXIT_BEFORE_ACTIVITY' : 'HOST_EXIT_BEFORE_INIT';
  } else if (state.failure_reason === null && !state.init_observed) {
    state.failure_reason = 'HOST_EXIT_BEFORE_INIT';
  } else if (state.failure_reason === null && !state.activity_observed) {
    state.failure_reason = 'HOST_EXIT_BEFORE_ACTIVITY';
  } else if (state.failure_reason === null && !state.terminal_receipt_observed) {
    state.failure_reason = 'HOST_EXIT_BEFORE_RESULT';
  }
  state.finished_at = new Date().toISOString();
  state.exit_code = code;
  state.signal = signal;
  state.status = state.failure_reason === null && code === 0 ? 'COMPLETED' : 'FAILED';
  atomicWriteJson(statePath, state);
  const watchdogFailure = state.failure_reason !== null &&
    (state.failure_reason.endsWith('_TIMEOUT') || state.failure_reason === 'HOST_STREAM_MALFORMED');
  const failedExitCode = typeof code === 'number' && code !== 0 ? code : 1;
  process.exitCode = state.status === 'COMPLETED' ? 0 : (watchdogFailure ? 124 : failedExitCode);
});

child.stdin.end(prompt);
