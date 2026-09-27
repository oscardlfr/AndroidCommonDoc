'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..', '..');
const launcher = path.join(ROOT, 'scripts', 'tools', 'claude-safe-one-shot.cjs');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-safe-one-shot-test-'));
  const project = path.join(root, 'project');
  const l0 = path.join(root, 'l0');
  const evidence = path.join(root, 'evidence');
  fs.mkdirSync(project);
  fs.mkdirSync(l0);
  fs.mkdirSync(evidence);
  const prompt = path.join(root, 'prompt.txt');
  fs.writeFileSync(prompt, 'Inspect the fixture and stop.\n');
  const capturedArgs = path.join(root, 'claude-argv.json');
  const capturedEnv = path.join(root, 'claude-env.json');
  const fake = path.join(root, 'fake-claude');
  fs.writeFileSync(fake, `#!/usr/bin/env node
const fs = require('node:fs');
const mode = process.env.FAKE_CLAUDE_MODE;
fs.writeFileSync(process.env.FAKE_CLAUDE_ARGS_PATH, JSON.stringify(process.argv.slice(2)) + '\\n');
fs.writeFileSync(process.env.FAKE_CLAUDE_ENV_PATH, JSON.stringify({
  effort:process.env.CLAUDE_CODE_EFFORT_LEVEL || null,
}) + '\\n');
process.stdin.resume();
const argv = process.argv.slice(2);
const toolsAt = argv.indexOf('--tools');
const effortAt = argv.indexOf('--effort');
const requestedEffort = effortAt === -1 ? null : argv[effortAt + 1];
const requestedTools = toolsAt === -1 || argv[toolsAt + 1] === ''
  ? []
  : argv[toolsAt + 1].split(',');
const extraTools = { 'extra-agent':'Agent', 'extra-task':'Task', 'extra-send-message':'SendMessage', 'extra-bash':'Bash' };
const observedTools = extraTools[mode] ? [...requestedTools, extraTools[mode]] : requestedTools;
if (['init-silent', 'success', 'assistant-only', 'budget-error', 'result-error',
  'effort-inactive', 'effort-absent', 'effort-mismatch', 'receipt-missing-usage',
  'receipt-missing-cost', 'receipt-missing-stats', 'receipt-spawned-subagent'].includes(mode) || extraTools[mode]) {
  process.stdout.write(JSON.stringify({
    type:'system', subtype:'init', tools:observedTools,
    ...(requestedEffort === null || mode === 'effort-absent'
      ? {}
      : {per_turn_effort_active:mode !== 'effort-inactive'}),
  }) + '\\n');
}
if (mode === 'success' || mode === 'effort-mismatch' || extraTools[mode]) {
  setTimeout(() => {
    process.stdout.write(JSON.stringify({
      type:'assistant', message:{content:[]},
      ...(requestedEffort === null ? {} : {
        effort:mode === 'effort-mismatch' ? 'max' : requestedEffort,
      }),
    }) + '\\n');
    process.stdout.write(JSON.stringify({
      type:'result', subtype:'success', is_error:false,
      usage:{input_tokens:11, output_tokens:7}, total_cost_usd:0.0123,
      subagent_stats:{spawned:0,total:0},
    }) + '\\n');
    process.exit(0);
  }, 10);
} else if (mode === 'assistant-only') {
  process.stdout.write(JSON.stringify({type:'assistant', message:{content:[]}}) + '\\n');
  process.exit(0);
} else if (mode === 'budget-error') {
  process.stdout.write(JSON.stringify({
    type:'result', subtype:'error_max_budget_usd', is_error:true,
    usage:{input_tokens:3848, cache_read_input_tokens:531, output_tokens:491},
    total_cost_usd:0.10166275, subagent_stats:{spawned:0,total:0},
  }) + '\\n');
  process.exit(0);
} else if (mode === 'result-error') {
  process.stdout.write(JSON.stringify({
    type:'result', subtype:'success', is_error:true,
    usage:{input_tokens:3, output_tokens:1}, total_cost_usd:0.001,
    subagent_stats:{spawned:0,total:0},
  }) + '\\n');
  process.exit(0);
} else if (mode.startsWith('receipt-')) {
  process.stdout.write(JSON.stringify({
    type:'assistant', message:{content:[], usage:{input_tokens:5, output_tokens:2}},
  }) + '\\n');
  const receipt = {
    type:'result', subtype:'success', is_error:false,
    usage:{input_tokens:6, output_tokens:3}, total_cost_usd:0.002,
    subagent_stats:{spawned:0,total:0},
  };
  if (mode === 'receipt-missing-usage') delete receipt.usage;
  if (mode === 'receipt-missing-cost') delete receipt.total_cost_usd;
  if (mode === 'receipt-missing-stats') delete receipt.subagent_stats;
  if (mode === 'receipt-spawned-subagent') receipt.subagent_stats.spawned = 1;
  process.stdout.write(JSON.stringify(receipt) + '\\n');
  process.exit(0);
} else if (mode === 'auth-error') {
  process.stderr.write('authentication failed\\n');
  process.exit(1);
} else if (mode === 'malformed') {
  process.stdout.write('not-json\\n');
} else {
  setInterval(() => {}, 1000);
}
`);
  fs.chmodSync(fake, 0o755);
  return { root, project, l0, evidence, prompt, fake, capturedArgs, capturedEnv };
}

function run(ctx, mode) {
  return runWithExtraArgs(ctx, mode, []);
}

function runWithExtraArgs(ctx, mode, extraArgs, extraEnv = {}) {
  const childEnv = { ...process.env };
  delete childEnv.CLAUDE_CODE_EFFORT_LEVEL;
  Object.assign(childEnv, extraEnv);
  return spawnSync(process.execPath, [launcher,
    '--project-root', ctx.project,
    '--l0-root', ctx.l0,
    '--claude-executable', ctx.fake,
    '--prompt-file', ctx.prompt,
    '--evidence-root', ctx.evidence,
    '--startup-timeout-ms', '200',
    '--activity-timeout-ms', '200',
    '--overall-timeout-ms', '1000',
    ...extraArgs,
  ], {
    encoding: 'utf8',
    timeout: 5_000,
    env: {
      ...childEnv,
      FAKE_CLAUDE_MODE: mode,
      FAKE_CLAUDE_ARGS_PATH: ctx.capturedArgs,
      FAKE_CLAUDE_ENV_PATH: ctx.capturedEnv,
    },
  });
}

function stateFrom(ctx, result) {
  const match = /CLAUDE_ONE_SHOT_EVIDENCE=([^\r\n]+)/.exec(result.stderr);
  assert.ok(match, result.stderr);
  const evidenceRoot = fs.realpathSync(match[1]);
  assert.ok(evidenceRoot.startsWith(fs.realpathSync(ctx.evidence) + path.sep));
  return JSON.parse(fs.readFileSync(path.join(evidenceRoot, 'run-state.json'), 'utf8'));
}

test('silent startup is bounded and leaves diagnostic evidence', () => {
  const ctx = fixture();
  try {
    const result = run(ctx, 'silent');
    assert.strictEqual(result.status, 124);
    const state = stateFrom(ctx, result);
    assert.strictEqual(state.status, 'FAILED');
    assert.strictEqual(state.failure_reason, 'HOST_STARTUP_TIMEOUT');
    assert.strictEqual(state.init_observed, false);
  } finally {
    fs.rmSync(ctx.root, { recursive: true, force: true });
  }
});

test('init followed by silence is bounded independently', () => {
  const ctx = fixture();
  try {
    const result = run(ctx, 'init-silent');
    assert.strictEqual(result.status, 124);
    const state = stateFrom(ctx, result);
    assert.strictEqual(state.failure_reason, 'HOST_FIRST_ACTIVITY_TIMEOUT');
    assert.strictEqual(state.init_observed, true);
    assert.strictEqual(state.activity_observed, false);
    assert.strictEqual(state.terminal_receipt_observed, false);
    assert.strictEqual(state.accounting_complete, false);
  } finally {
    fs.rmSync(ctx.root, { recursive: true, force: true });
  }
});

test('a streamed init and assistant response complete successfully', () => {
  const ctx = fixture();
  try {
    const result = runWithExtraArgs(ctx, 'success', [
      '--model', 'sonnet', '--effort', 'high', '--tools', 'Read,Glob,Grep',
    ]);
    assert.strictEqual(result.status, 0, result.stderr);
    const state = stateFrom(ctx, result);
    assert.strictEqual(state.status, 'COMPLETED');
    assert.strictEqual(state.init_observed, true);
    assert.strictEqual(state.activity_observed, true);
    assert.deepStrictEqual(state.launch_contract, {
      safe_mode: true, restricted: true, bare: false, session_persistence: false,
      tool_profile: 'read', requested_tools: ['Read', 'Glob', 'Grep'],
    });
    assert.strictEqual(state.terminal_receipt_observed, true);
    assert.strictEqual(state.accounting_complete, true);
    assert.deepStrictEqual(state.last_usage, { input_tokens: 11, output_tokens: 7 });
    assert.strictEqual(state.total_cost_usd, 0.0123);
    assert.deepStrictEqual(state.subagent_stats, { spawned: 0, total: 0 });
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(ctx.capturedEnv, 'utf8')), { effort: 'high' });
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(ctx.capturedArgs, 'utf8')), [
      '--safe-mode', '--restricted', '-p', '--no-session-persistence',
      '--add-dir', fs.realpathSync(ctx.l0),
      '--permission-mode', 'dontAsk', '--permission-prompts', 'none',
      '--tools', 'Read,Glob,Grep',
      '--output-format', 'stream-json', '--include-partial-messages', '--verbose',
      '--model', 'sonnet', '--effort', 'high',
    ]);
  } finally {
    fs.rmSync(ctx.root, { recursive: true, force: true });
  }
});

test('matching CLI and environment effort authorities are forwarded deterministically', () => {
  const ctx = fixture();
  try {
    const result = runWithExtraArgs(ctx, 'success', ['--tools', '', '--effort', 'low'], {
      CLAUDE_CODE_EFFORT_LEVEL: 'low',
    });
    assert.strictEqual(result.status, 0, result.stderr);
    const state = stateFrom(ctx, result);
    assert.deepStrictEqual(state.effort_environment, {
      inherited: 'low', child: 'low', policy: 'explicit-cli-and-environment-match',
    });
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(ctx.capturedEnv, 'utf8')), { effort: 'low' });
  } finally {
    fs.rmSync(ctx.root, { recursive: true, force: true });
  }
});

for (const [extraArgs, inherited, expectedReason] of [
  [['--tools', ''], 'max', 'INHERITED_EFFORT_AUTHORITY_REQUIRES_EXPLICIT_EFFORT'],
  [['--tools', '', '--effort', 'low'], 'max', 'CONFLICTING_EFFORT_AUTHORITY'],
]) {
  test(`${expectedReason} rejects ambiguous effort before Claude starts`, () => {
    const ctx = fixture();
    try {
      const result = runWithExtraArgs(ctx, 'success', extraArgs, {
        CLAUDE_CODE_EFFORT_LEVEL: inherited,
      });
      assert.strictEqual(result.status, 64);
      assert.match(result.stderr, new RegExp(expectedReason));
      assert.strictEqual(fs.existsSync(ctx.capturedArgs), false);
      assert.deepStrictEqual(fs.readdirSync(ctx.evidence), []);
    } finally {
      fs.rmSync(ctx.root, { recursive: true, force: true });
    }
  });
}

for (const [profile, tools, expectedTools] of [
  ['none', '', []],
  ['read', 'Read,Glob,Grep', ['Read', 'Glob', 'Grep']],
  ['repair', 'Read,Glob,Grep,Bash', ['Read', 'Glob', 'Grep', 'Bash']],
]) {
  test(`tool profile ${profile} is forwarded exactly and proven by system/init`, () => {
    const ctx = fixture();
    try {
      const result = runWithExtraArgs(ctx, 'success', ['--tools', tools]);
      assert.strictEqual(result.status, 0, result.stderr);
      const state = stateFrom(ctx, result);
      assert.strictEqual(state.launch_contract.tool_profile, profile);
      assert.deepStrictEqual(state.launch_contract.requested_tools, expectedTools);
      assert.deepStrictEqual(state.init_projection.tools, expectedTools);
      const argv = JSON.parse(fs.readFileSync(ctx.capturedArgs, 'utf8'));
      assert.strictEqual(argv[argv.indexOf('--tools') + 1], tools,
        'an explicit empty tool set must not fall back to repair tools');
    } finally {
      fs.rmSync(ctx.root, { recursive: true, force: true });
    }
  });
}

for (const [mode, extraTool] of [
  ['extra-agent', 'Agent'],
  ['extra-task', 'Task'],
  ['extra-send-message', 'SendMessage'],
  ['extra-bash', 'Bash'],
]) {
  test(`system/init rejects unrequested ${extraTool} before accepting a result`, () => {
    const ctx = fixture();
    try {
      const result = runWithExtraArgs(ctx, mode, ['--tools', 'Read,Glob,Grep']);
      assert.notStrictEqual(result.status, 0, result.stderr);
      const state = stateFrom(ctx, result);
      assert.strictEqual(state.status, 'FAILED');
      assert.strictEqual(state.failure_reason, 'HOST_INIT_TOOL_MISMATCH');
      assert.deepStrictEqual(state.launch_contract.requested_tools, ['Read', 'Glob', 'Grep']);
      assert.strictEqual(state.terminal_receipt_observed, false);
    } finally {
      fs.rmSync(ctx.root, { recursive: true, force: true });
    }
  });
}

test('exit zero without a terminal result receipt is not success', () => {
  const ctx = fixture();
  try {
    const result = runWithExtraArgs(ctx, 'assistant-only', ['--tools', '']);
    assert.notStrictEqual(result.status, 0, result.stderr);
    const state = stateFrom(ctx, result);
    assert.strictEqual(state.status, 'FAILED');
    assert.strictEqual(state.failure_reason, 'HOST_EXIT_BEFORE_RESULT');
    assert.strictEqual(state.terminal_receipt_observed, false);
    assert.strictEqual(state.accounting_complete, false);
  } finally {
    fs.rmSync(ctx.root, { recursive: true, force: true });
  }
});

for (const mode of ['budget-error', 'result-error']) {
  test(`${mode} terminal result remains failed even when Claude exits zero`, () => {
    const ctx = fixture();
    try {
      const result = runWithExtraArgs(ctx, mode, ['--tools', '']);
      assert.notStrictEqual(result.status, 0, result.stderr);
      const state = stateFrom(ctx, result);
      assert.strictEqual(state.status, 'FAILED');
      assert.strictEqual(state.failure_reason,
        mode === 'budget-error' ? 'HOST_RESULT_ERROR:error_max_budget_usd' : 'HOST_RESULT_ERROR:success');
      assert.strictEqual(state.terminal_receipt_observed, true);
      assert.strictEqual(state.accounting_complete, true);
      assert.ok(state.last_usage.input_tokens > 0);
      assert.ok(state.total_cost_usd > 0);
      assert.deepStrictEqual(state.subagent_stats, { spawned: 0, total: 0 });
    } finally {
      fs.rmSync(ctx.root, { recursive: true, force: true });
    }
  });
}

for (const [mode, expectedReason] of [
  ['effort-inactive', 'HOST_EFFORT_INACTIVE'],
  ['effort-absent', 'HOST_EFFORT_UNPROVEN'],
  ['effort-mismatch', 'HOST_EFFORT_MISMATCH'],
]) {
  test(`${mode} fails closed instead of treating requested effort as effective effort`, () => {
    const ctx = fixture();
    try {
      const result = runWithExtraArgs(ctx, mode, ['--tools', '', '--effort', 'low']);
      assert.notStrictEqual(result.status, 0, result.stderr);
      const state = stateFrom(ctx, result);
      assert.strictEqual(state.status, 'FAILED');
      assert.strictEqual(state.failure_reason, expectedReason);
      assert.strictEqual(state.requested_effort, 'low');
      assert.notStrictEqual(state.effective_effort, 'low');
    } finally {
      fs.rmSync(ctx.root, { recursive: true, force: true });
    }
  });
}

test('max budget is forwarded and a budget terminal receipt remains a failure', () => {
  const ctx = fixture();
  try {
    const result = runWithExtraArgs(ctx, 'budget-error', [
      '--tools', '', '--max-budget-usd', '0.10',
    ]);
    assert.notStrictEqual(result.status, 0, result.stderr);
    const state = stateFrom(ctx, result);
    assert.strictEqual(state.max_budget_usd, 0.1);
    assert.strictEqual(state.failure_reason, 'HOST_RESULT_ERROR:error_max_budget_usd');
    const argv = JSON.parse(fs.readFileSync(ctx.capturedArgs, 'utf8'));
    assert.deepStrictEqual(argv.slice(-2), ['--max-budget-usd', '0.1']);
  } finally {
    fs.rmSync(ctx.root, { recursive: true, force: true });
  }
});

for (const [mode, expectedReason] of [
  ['receipt-missing-usage', 'HOST_ACCOUNTING_INCOMPLETE'],
  ['receipt-missing-cost', 'HOST_ACCOUNTING_INCOMPLETE'],
  ['receipt-missing-stats', 'HOST_SUBAGENT_STATS_MISSING'],
  ['receipt-spawned-subagent', 'HOST_UNEXPECTED_SUBAGENTS'],
]) {
  test(`${mode} cannot satisfy the terminal accounting and subagent contract`, () => {
    const ctx = fixture();
    try {
      const result = runWithExtraArgs(ctx, mode, ['--tools', '']);
      assert.notStrictEqual(result.status, 0, result.stderr);
      const state = stateFrom(ctx, result);
      assert.strictEqual(state.status, 'FAILED');
      assert.strictEqual(state.failure_reason, expectedReason);
      assert.strictEqual(state.terminal_receipt_observed, true);
      if (mode === 'receipt-missing-usage' || mode === 'receipt-missing-cost') {
        assert.strictEqual(state.accounting_complete, false);
      }
      if (mode === 'receipt-missing-usage') {
        assert.deepStrictEqual(state.last_usage, { input_tokens: 5, output_tokens: 2 },
          'streamed usage may be retained, but it cannot complete terminal accounting');
        assert.strictEqual(state.terminal_receipt.usage_observed, false);
      }
    } finally {
      fs.rmSync(ctx.root, { recursive: true, force: true });
    }
  });
}

test('authentication or host exit before init is classified and retained', () => {
  const ctx = fixture();
  try {
    const result = run(ctx, 'auth-error');
    assert.strictEqual(result.status, 1);
    const state = stateFrom(ctx, result);
    assert.strictEqual(state.failure_reason, 'HOST_EXIT_BEFORE_INIT');
    assert.ok(state.stderr_bytes > 0);
  } finally {
    fs.rmSync(ctx.root, { recursive: true, force: true });
  }
});

test('malformed stream output fails immediately with stable evidence', () => {
  const ctx = fixture();
  try {
    const result = run(ctx, 'malformed');
    assert.strictEqual(result.status, 124);
    const state = stateFrom(ctx, result);
    assert.strictEqual(state.failure_reason, 'HOST_STREAM_MALFORMED');
    assert.ok(state.stdout_bytes > 0);
  } finally {
    fs.rmSync(ctx.root, { recursive: true, force: true });
  }
});

test('unknown, duplicate, and missing-value arguments fail before creating evidence', () => {
  const ctx = fixture();
  try {
    for (const args of [
      ['--unknown', 'value'],
      ['--model', 'sonnet', '--model', 'opus'],
      ['--effort'],
    ]) {
      const result = runWithExtraArgs(ctx, 'success', args);
      assert.strictEqual(result.status, 64, result.stderr);
      assert.ok(!result.stderr.includes('CLAUDE_ONE_SHOT_EVIDENCE='));
    }
    assert.deepStrictEqual(fs.readdirSync(ctx.evidence), []);
  } finally {
    fs.rmSync(ctx.root, { recursive: true, force: true });
  }
});

test('a symlinked prompt is rejected before Claude starts', { skip: process.platform === 'win32' }, () => {
  const ctx = fixture();
  try {
    const promptLink = path.join(ctx.root, 'prompt-link.txt');
    fs.symlinkSync(ctx.prompt, promptLink);
    const result = spawnSync(process.execPath, [launcher,
      '--project-root', ctx.project,
      '--l0-root', ctx.l0,
      '--claude-executable', ctx.fake,
      '--prompt-file', promptLink,
      '--evidence-root', ctx.evidence,
    ], {
      encoding: 'utf8',
      timeout: 5_000,
      env: {
        ...process.env,
        FAKE_CLAUDE_MODE: 'success',
        FAKE_CLAUDE_ARGS_PATH: ctx.capturedArgs,
      },
    });
    assert.strictEqual(result.status, 64, result.stderr);
    assert.match(result.stderr, /INVALID_FILE:--prompt-file:symlink is not allowed/);
    assert.deepStrictEqual(fs.readdirSync(ctx.evidence), []);
  } finally {
    fs.rmSync(ctx.root, { recursive: true, force: true });
  }
});
