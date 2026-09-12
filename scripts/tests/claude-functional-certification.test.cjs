'use strict';

const { privateRoot } = require('./lib/private-registry-tmpdir-preload.cjs');

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { spawn, spawnSync } = require('node:child_process');

const here = __dirname;
const launcher = path.join(here, '..', 'tools', 'claude-functional-certification.cjs');
const fakeChild = path.join(here, 'fixtures', 'fake-claude-functional-child.cjs');
const fakeManagedCommand = path.join(here, 'fixtures', 'fake-managed-conductor-command.cjs');
const probeObserver = path.join(here, 'fixtures', 'claude-host-contract-probe.cjs');
const entrypointObserver = path.join(here, 'fixtures', 'claude-entrypoint-observer.cjs');
const projectRoot = path.resolve(here, '..', '..');

function runScenario(scenario, options = {}) {
  return new Promise((resolve, reject) => {
    const scenarioProjectRoot = options.projectRoot || projectRoot;
    const evidenceRoot = options.evidenceRoot || fs.mkdtempSync(path.join(privateRoot, `cfc-${scenario}-`));
    const launcherArgs = [launcher, scenarioProjectRoot];
    if (options.operation) launcherArgs.push('--operation', options.operation);
    if (options.transportProfile) launcherArgs.push('--transport-profile', options.transportProfile);
    if (Array.isArray(options.launcherArgs)) launcherArgs.push(...options.launcherArgs);
    const child = spawn(process.execPath, launcherArgs, {
      cwd: scenarioProjectRoot,
      env: {
        ...process.env,
        P4_CERT_OFFLINE_TEST: '1',
        P4_CERT_OFFLINE_FAKE_CHILD: fakeChild,
        P4_CERT_FAKE_SCENARIO: scenario,
        P4_CERT_EVIDENCE_ROOT: evidenceRoot,
        ...(options.nativeFixture ? { P4_CERT_NATIVE_TRANSPORT_FAKE_CHILD: fakeChild } : {}),
        ...(options.extraEnv || {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`scenario ${scenario} timed out`));
    }, 20_000);
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      const match = /P4_LIVE_STATE=([^\r\n]+)/.exec(stderr);
      if (!match) return reject(new Error(`state path absent; stderr=${stderr}`));
      const statePath = match[1].trim();
      const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      resolve({ code, signal, stdout, stderr, state, statePath, evidenceRoot });
    });
  });
}

function runProbeScenario(scenario, options = {}) {
  return runScenario(scenario, {
    operation: 'host-contract-probe',
    ...options,
  });
}

const P4_INGEST_REQUEST_REF = `request:${crypto.createHash('sha256').update('p4-full-scenario-request').digest('hex')}`;
const P4_INGEST_APPROVAL_REF = `approval:${crypto.createHash('sha256').update('p4-full-scenario-approval').digest('hex')}`;
const P4_SUPPORT_ROLES = ['arch-platform', 'arch-testing', 'arch-integration', 'context-provider', 'doc-updater'];

function runP4FullScenario(scenario, options = {}) {
  const fullScenarioEnv = {
    P4_CERT_FAKE_INGEST_REQUEST_REF: P4_INGEST_REQUEST_REF,
    P4_CERT_FAKE_INGEST_APPROVAL_REF: P4_INGEST_APPROVAL_REF,
    ...(options.extraEnv || {}),
  };
  // extraLauncherArgs APPENDS to the canonical full-scenario argv instead of replacing
  // it, so a case can add one flag without silently dropping --full-scenario or the
  // ingestion refs.
  const { extraLauncherArgs = [], ...scenarioOptions } = options;
  return runScenario(scenario, {
    operation: 'entrypoint-protocol',
    transportProfile: 'native-claude-cli',
    nativeFixture: true,
    launcherArgs: [
      '--full-scenario',
      '--ingest-request-ref', P4_INGEST_REQUEST_REF,
      '--ingest-approval-ref', P4_INGEST_APPROVAL_REF,
      ...extraLauncherArgs,
    ],
    ...scenarioOptions,
    extraEnv: fullScenarioEnv,
  });
}

function runP5Scenario(scenario = 'p5-full-scenario', options = {}) {
  return runScenario(scenario, {
    operation: 'entrypoint-protocol',
    transportProfile: 'native-claude-cli',
    nativeFixture: true,
    launcherArgs: ['--p5-scenario'],
    ...options,
  });
}

function runP6Scenario(options = {}) {
  return runScenario('p6-managed-consumer', {
    operation: 'entrypoint-protocol',
    transportProfile: 'native-claude-cli',
    nativeFixture: true,
    launcherArgs: ['--p6-managed-consumer'],
    ...options,
  });
}

// A throwaway git repository carrying one wave, one PLAN.md and whichever arch verdict
// binding the case under test needs. Used only as the current-PREP preflight's
// evaluation root, so the preflight's refusal AND its clearance are both provable
// without a genuine Claude session and without depending on this repository's own
// mutable verdict state.
function makePrepFixtureRepo(kind) {
  const root = fs.mkdtempSync(path.join(privateRoot, `cfc-prep-${kind}-`));
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`);
    return String(result.stdout || '').trim();
  };
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'p4-cert@example.invalid');
  git('config', 'user.name', 'p4-cert');
  git('config', 'commit.gpgsign', 'false');
  const waveDir = path.join(root, '.planning', 'wave-prep-fixture');
  fs.mkdirSync(waveDir, { recursive: true });
  const planPath = path.join(waveDir, 'PLAN.md');
  fs.writeFileSync(planPath, `# prep fixture plan\n\n### Spawn Table\n\n| role |\n`);
  git('add', '-A');
  git('commit', '-q', '-m', 'prep fixture');
  const head = git('rev-parse', 'HEAD');
  const planSha256 = crypto.createHash('sha256').update(fs.readFileSync(planPath)).digest('hex');
  git('checkout', '-q', '--orphan', 'sidecar');
  fs.writeFileSync(path.join(root, 'SIDECAR.md'), `unrelated history\n`);
  git('add', '-A');
  git('commit', '-q', '-m', 'sidecar');
  const unrelatedHead = git('rev-parse', 'HEAD');
  git('checkout', '-q', 'main');
  const writeVerdict = (role, boundPlanSha256, boundPrepHead) => {
    fs.writeFileSync(path.join(waveDir, `arch-${role}-verdict.md`), [
      `# arch-${role} verdict -- wave-prep-fixture`,
      '',
      '**Phase**: PREP',
      '**Timestamp**: 2026-09-09T00:00:00Z',
      '**Status**: APPROVED-PREP',
      `**PREP-HEAD**: ${boundPrepHead}`,
      `**PLAN_SHA256**: ${boundPlanSha256}`,
      '',
    ].join('\n'));
  };
  return { root, waveDir, head, unrelatedHead, planSha256, writeVerdict };
}

test('CE-01 managed conductor waits for system/init and owns every protocol command', async () => {
  const run = await runScenario('managed-conductor-basic', {
    operation: 'entrypoint-protocol',
    transportProfile: 'native-claude-cli',
    nativeFixture: true,
    extraEnv: {
      P4_CERT_MANAGED_CONDUCTOR_OFFLINE: '1',
      P4_CERT_MANAGED_COMMAND_FAKE: fakeManagedCommand,
    },
  });
  assert.equal(run.code, 0, `${run.stderr}\n${JSON.stringify(run.state, null, 2)}`);
  assert.equal(run.state.status, 'PROTOCOL_COMPLETED');
  assert.equal(run.state.managed_conductor, true);
  assert.equal(run.state.model_host_command_count, 0);
  const handshake = fs.readFileSync(path.join(run.evidenceRoot, 'sequence-0-input.jsonl'), 'utf8');
  assert.match(handshake, /Open this fresh no-persistence test conversation/);
  assert.match(handshake, /READY_FOR_FIRST_STEP/);
  assert.doesNotMatch(handshake, /runtime-collaboration-entrypoints|runtime-role-lifecycle|--project-root|--intent/,
    'the activation frame must carry no protocol command or authority');
  assert.equal(run.state.managed_handshake, 'COMPLETED');
  assert.deepEqual(run.state.managed_conductor_commands.map((item) => `${item.kind}:${item.name}`), [
    'entrypoint:init-session', 'entrypoint:init-session', 'entrypoint:work',
    'root-consult-requester:publish-request', 'root-consult-requester:dispatch',
    'root-consult-requester:record-delivery', 'root-consult-target:claim',
    'root-consult-target:publish-result', 'root-consult-requester:await-result',
    'root-consult-requester:accept-result', 'root-consult-requester:transaction-ack',
    'entrypoint:work',
  ]);
  assert.ok(run.state.managed_conductor_commands.every((item) =>
    item.origin === 'managed-conductor' && item.evidence_method === 'CONDUCTOR_DIRECT_EXECUTION'
      && item.proposal === null));
  assert.equal(run.state.agent_calls_exact, true);
  assert.equal(run.state.stdin_closed_after_terminal, true);
});

test('CE-02 managed conductor rejects invalid init before executing any host command', async () => {
  const run = await runScenario('bad-init', {
    operation: 'entrypoint-protocol', transportProfile: 'native-claude-cli', nativeFixture: true,
    extraEnv: { P4_CERT_MANAGED_CONDUCTOR_OFFLINE: '1', P4_CERT_MANAGED_COMMAND_FAKE: fakeManagedCommand },
  });
  assert.notEqual(run.code, 0);
  assert.equal(run.state.status, 'INVALID_SYSTEM_INIT_EVIDENCE');
  assert.equal(run.state.managed_conductor_commands, undefined);
});

test('CE-03 managed conductor fails closed when the model attempts a host Bash command', async () => {
  const run = await runScenario('managed-model-bash', {
    operation: 'entrypoint-protocol', transportProfile: 'native-claude-cli', nativeFixture: true,
    extraEnv: { P4_CERT_MANAGED_CONDUCTOR_OFFLINE: '1', P4_CERT_MANAGED_COMMAND_FAKE: fakeManagedCommand },
  });
  assert.notEqual(run.code, 0);
  assert.equal(run.state.status, 'INVALID_MODEL_HOST_COMMAND');
  assert.equal(run.state.model_host_command_count, 1);
});

test('CE-04 managed conductor completes full P4 through ordered restricted direct-role hosts', async () => {
  const run = await runP4FullScenario('managed-conductor-full', {
    extraEnv: {
      P4_CERT_MANAGED_CONDUCTOR_OFFLINE: '1',
      P4_CERT_MANAGED_COMMAND_FAKE: fakeManagedCommand,
    },
  });
  assert.equal(run.code, 0, `${run.stderr}\n${JSON.stringify(run.state, null, 2)}`);
  assert.equal(run.state.status, 'P4_FULL_SCENARIO_COMPLETED');
  assert.equal(run.state.model_host_command_count, 0);
  assert.equal(run.state.p4_steps.length, 8);
  assert.equal(run.state.p4_cleanup.length, 5);
  assert.ok(run.state.managed_conductor_commands.length >= 10);
  assert.ok(run.state.managed_conductor_commands.every((item) => item.proposal === null));
  assert.equal(run.state.sequence, 0, 'the main model receives no workflow action relay');
  assert.equal(fs.existsSync(path.join(run.evidenceRoot, 'sequence-1-actions-1.jsonl')), false);
  assert.equal(run.state.direct_role_hosts.filter((host) => host.persistent).length, 5);
  assert.equal(run.state.direct_role_hosts.filter((host) => !host.persistent).length, 1);
  assert.deepEqual(run.state.direct_role_hosts.slice(0, 5).map((host) => host.role), [
    'arch-integration', 'arch-platform', 'arch-testing', 'context-provider', 'doc-updater',
  ]);
  assert.ok(run.state.direct_role_hosts.every((host) => host.init_validated === true
    && host.tools.includes('Bash') && !host.tools.includes('Agent')
    && !host.tools.includes('Task')));
  const persistentHosts = run.state.direct_role_hosts.filter((host) => host.persistent);
  assert.ok(persistentHosts.every((host) => !host.tools.includes('SendMessage')));
  assert.ok(persistentHosts.filter((host) => host.role !== 'doc-updater')
    .every((host) => host.tools.every((tool) => !tool.startsWith('mcp__'))));
  const docUpdaterHost = persistentHosts.find((host) => host.role === 'doc-updater');
  assert.ok(docUpdaterHost.tools.includes('mcp__androidcommondoc__search-docs'));
  assert.ok(docUpdaterHost.tools.includes('mcp__androidcommondoc__ingest-content'));
  assert.ok(docUpdaterHost.tools.includes('mcp__androidcommondoc__validate-doc-update'));
  assert.ok(run.state.direct_role_hosts.filter((host) => !host.persistent)
    .every((host) => JSON.stringify(host.tools) === JSON.stringify(['Bash', 'SendMessage'])));
  assert.ok(run.state.actions.filter((action) => action.family === 'role-spawn')
    .every((action) => action.accepted === true && action.echoed_exact === true
      && action.first_tool_exact === null && action.startup_mode === 'host-admission'));
  assert.ok(run.state.actions.filter((action) => action.family === 'root-source-spawn')
    .every((action) => action.accepted === true && action.echoed_exact === true
      && action.first_tool_exact === null && action.startup_mode === 'host-orchestration'
      && action.tool_count === 0));
  assert.match(run.state.root_source_host_protocol.request_ref, /fake-root-request\.json$/);
  assert.match(run.state.root_source_host_protocol.result_ref, /fake-root-result\.json$/);
  assert.match(run.state.root_source_host_protocol.accepted_result_ref, /fake-root-accepted-result\.json$/);
  assert.match(run.state.root_source_host_protocol.ack_ref, /fake-root-ack\.json$/);
  assert.match(run.state.root_source_host_protocol.semantic_result_digest, /^[0-9a-f]{64}$/);
  assert.deepEqual(run.state.managed_conductor_commands
    .filter((item) => item.kind.startsWith('root-consult-'))
    .map((item) => item.name), [
      'publish-request', 'dispatch', 'record-delivery', 'claim',
      'publish-result', 'await-result', 'accept-result', 'transaction-ack',
    ]);
  assert.deepEqual(run.state.p4_resume_action_order,
    ['arch-integration', 'arch-platform', 'arch-testing', 'context-provider', 'doc-updater']);
  assert.equal(run.state.direct_role_deliveries.length, 7);
});

test('DRH-OFFLINE activates every direct role before a host that delays system/init until input', async () => {
  const run = await runP4FullScenario('direct-role-init-after-input', {
    extraEnv: {
      P4_CERT_MANAGED_CONDUCTOR_OFFLINE: '1',
      P4_CERT_MANAGED_COMMAND_FAKE: fakeManagedCommand,
    },
  });
  assert.equal(run.code, 0, `${run.stderr}\n${JSON.stringify(run.state, null, 2)}`);
  assert.equal(run.state.status, 'P4_FULL_SCENARIO_COMPLETED');
  assert.equal(run.state.direct_role_hosts.length, 6);
  assert.ok(run.state.actions.filter((action) => action.family === 'role-spawn')
    .every((action) => action.first_tool_exact === null && action.startup_mode === 'host-admission'));
  assert.ok(run.state.actions.filter((action) => action.family === 'root-source-spawn')
    .every((action) => action.first_tool_exact === null
      && action.startup_mode === 'host-orchestration' && action.tool_count === 0));
});

for (const [scenario, expectedStatus] of [
  ['direct-role-forbidden-tool', 'INVALID_DIRECT_ROLE_INIT'],
  ['direct-role-mcp-missing', 'INVALID_DIRECT_ROLE_INIT'],
  ['direct-role-init-drift', 'INVALID_DIRECT_ROLE_INIT_DRIFT'],
  ['direct-role-activation-tool', 'INVALID_DIRECT_ROLE_ACTIVATION'],
  ['direct-role-changed-echo', 'INVALID_DIRECT_ROLE_ECHO'],
  ['direct-role-empty-semantic-result', 'INVALID_ROOT_SOURCE_HOST_PROTOCOL'],
  ['direct-role-foreign-root-activation', 'INVALID_ROOT_SOURCE_HOST_PROTOCOL'],
  ['direct-role-exits-before-ready', 'INVALID_DIRECT_ROLE_EXIT'],
  ['direct-role-duplicate-result', 'INVALID_DIRECT_ROLE_TRANSPORT'],
  ['direct-role-orphan', 'INVALID_DIRECT_ROLE_TEARDOWN'],
]) {
  test(`DRH-OFFLINE fails closed for ${scenario}`, async () => {
    const run = await runP4FullScenario(scenario, {
      extraEnv: {
        P4_CERT_MANAGED_CONDUCTOR_OFFLINE: '1',
        P4_CERT_MANAGED_COMMAND_FAKE: fakeManagedCommand,
        P4_CERT_DIRECT_ROLE_TEARDOWN_MS: '300',
      },
    });
    assert.notEqual(run.code, 0, `${run.stderr}\n${JSON.stringify(run.state, null, 2)}`);
    assert.equal(run.state.status, expectedStatus);
  });
}

test('CE-05 managed conductor completes P5 with direct lifecycle and supervisor authority', async () => {
  const run = await runP5Scenario('managed-conductor-p5', {
    extraEnv: {
      P4_CERT_MANAGED_CONDUCTOR_OFFLINE: '1',
      P4_CERT_MANAGED_COMMAND_FAKE: fakeManagedCommand,
    },
  });
  assert.equal(run.code, 0, `${run.stderr}\n${JSON.stringify(run.state, null, 2)}`);
  assert.equal(run.state.status, 'P5_SCENARIO_COMPLETED');
  assert.equal(run.state.model_host_command_count, 0);
  assert.equal(run.state.managed_supervisor_starts.length, 1);
  assert.equal(run.state.managed_supervisor_starts[0].proposal, null);
  assert.equal(run.state.p5_mixed_review.validation_passed, true);
  assert.equal(run.state.p5_docs_mcp.validated, true);
});

test('P6-OFFLINE permits bounded documentation inspection before the exact consumer entrypoint', async () => {
  const consumerRoot = fs.mkdtempSync(path.join(projectRoot, '.p6-launcher-consumer-'));
  try {
    fs.mkdirSync(path.join(consumerRoot, '.claude', 'agents'), { recursive: true });
    fs.copyFileSync(path.join(projectRoot, '.claude', 'settings.json'),
      path.join(consumerRoot, '.claude', 'settings.json'));
    for (const role of ['arch-platform', 'arch-testing', 'arch-integration',
      'context-provider', 'doc-updater', 'toolkit-specialist']) {
      fs.copyFileSync(path.join(projectRoot, '.claude', 'agents', `${role}.md`),
        path.join(consumerRoot, '.claude', 'agents', `${role}.md`));
    }
    const run = await runP6Scenario({ projectRoot: consumerRoot });
    assert.equal(run.code, 0, `${run.stderr}\n${JSON.stringify(run.state, null, 2)}`);
    assert.equal(run.state.status, 'P6_MANAGED_CONSUMER_COMPLETED');
    assert.equal(run.state.scenario, 'P6_MANAGED_CONSUMER');
    assert.equal(run.state.p6_preflight_reads, 1);
    assert.equal(run.state.first_action_exact, true);
    assert.equal(run.state.completion_result.subject_ref,
      'subject:090b9779a46f94e328cb61bf5e78d5a64a15337a6e9279090837647a87f2ff7a');
    const toolsIndex = run.state.native_argv.indexOf('--tools');
    assert.match(run.state.native_argv[toolsIndex + 1], /Read/);
    assert.match(run.state.native_argv[toolsIndex + 1], /Bash/);
    const runSettings = JSON.parse(fs.readFileSync(run.state.native_settings_path, 'utf8'));
    const observerCommands = Object.values(runSettings.hooks).flatMap((blocks) => blocks)
      .flatMap((block) => block.hooks)
      .map((hook) => hook.command)
      .filter((command) => command.includes('claude-entrypoint-observer.cjs'));
    assert.ok(observerCommands.length > 0);
    assert.ok(observerCommands.every((command) => command.includes(projectRoot)),
      'launcher observers must resolve from toolkitRoot when consumerRoot is distinct');
    assert.ok(observerCommands.every((command) => !command.includes(path.join(consumerRoot, 'scripts'))));
    const sequencePrompts = fs.readdirSync(run.evidenceRoot)
      .filter((name) => /^sequence-\d+-input\.jsonl$/.test(name))
      .map((name) => JSON.parse(fs.readFileSync(path.join(run.evidenceRoot, name), 'utf8'))
        .message.content[0].text);
    const toolkitEntrypoint = path.join(projectRoot, 'scripts', 'lib',
      'runtime-collaboration-entrypoints.cjs');
    assert.ok(sequencePrompts.some((prompt) => prompt.includes(toolkitEntrypoint)),
      'managed-consumer entrypoint prompts must reference the source L0 toolkit');
    assert.ok(sequencePrompts.every((prompt) => !prompt.includes(path.join(consumerRoot, 'scripts', 'lib'))),
      'managed-consumer entrypoint prompts must never invent runtime scripts beneath the consumer');
  } finally {
    fs.rmSync(consumerRoot, { recursive: true, force: true });
  }
});

test('P5-OFFLINE drives mixed review and docs MCP in one bounded same-session flow', async () => {
  const run = await runP5Scenario();
  assert.equal(run.code, 0, run.stderr);
  assert.equal(run.state.status, 'P5_SCENARIO_COMPLETED');
  assert.equal(run.state.scenario, 'P5_U2_DOCS_MCP');
  assert.equal(run.state.p5_mixed_review.validation_passed, true);
  assert.equal(run.state.p5_mixed_review.outcome, 'GO');
  assert.equal(run.state.p5_docs_mcp.validated, true);
  assert.equal(run.state.p5_stage, 'completed');
  assert.equal(run.state.stdin_closed_after_terminal, true);
  const systemPromptIndex = run.state.native_argv.indexOf('--append-system-prompt');
  assert.notEqual(systemPromptIndex, -1);
  const systemPrompt = run.state.native_argv[systemPromptIndex + 1];
  assert.match(systemPrompt, /bounded P5 mixed Claude\/Codex qualification/i);
  assert.match(systemPrompt, /same retained workers/i);
  assert.match(systemPrompt, /repository-local lifecycle CLI/i);
  assert.doesNotMatch(systemPrompt,
    /do not inspect|execute only|obey|blindly|opaque|rewrite|substitute|without confirmation/i,
    'the live driver must describe the bounded verified operation without safety-bypass language');
  const firstInput = JSON.parse(fs.readFileSync(
    path.join(run.evidenceRoot, 'sequence-0-input.jsonl'), 'utf8',
  ).trim());
  const firstPrompt = firstInput.message.content[0].text;
  assert.match(firstPrompt, /initialize the repository runtime session/i);
  assert.match(firstPrompt, /production hooks validate/i);
  assert.doesNotMatch(firstPrompt,
    /do not inspect|execute only|obey|blindly|opaque|no preliminary|no separate|without confirmation/i,
    'the first live request must state purpose and validation rather than suppressing inspection');
  const review = JSON.parse(fs.readFileSync(
    path.join(run.evidenceRoot, 'p5-mixed-review-readback.json'), 'utf8',
  ));
  assert.equal(review.receipt.schema, 'runtime/mixed-review-readback/v1');
  assert.equal(review.receipt.validation_passed, true);
  assert.match(review.immutable_subject.sha256, /^[0-9a-f]{64}$/);
  const docs = JSON.parse(fs.readFileSync(
    path.join(run.evidenceRoot, 'p5-docs-mcp-evidence.json'), 'utf8',
  ));
  assert.equal(docs.schema, 'androidcommondoc/p5-docs-mcp-evidence/v1');
  for (const field of ['result_ref', 'result_digest', 'accepted_result_ref',
    'accepted_result_digest', 'ack_ref', 'ack_digest']) {
    assert.equal(typeof docs.operation[field], 'string');
    assert.ok(docs.operation[field].length > 0);
  }
});

test('P5-OFFLINE rejects a forged readback and an incomplete docs result', async () => {
  const forged = await runP5Scenario('p5-readback-invalid');
  assert.notEqual(forged.code, 0);
  assert.equal(forged.state.status, 'INVALID_P5_READBACK');
  assert.equal(fs.existsSync(path.join(forged.evidenceRoot, 'p5-mixed-review-readback.json')), false);

  const incomplete = await runP5Scenario('p5-docs-incomplete');
  assert.notEqual(incomplete.code, 0);
  assert.equal(incomplete.state.status, 'INVALID_P5_DOCS_MCP');
  assert.equal(fs.existsSync(path.join(incomplete.evidenceRoot, 'p5-docs-mcp-evidence.json')), false);
});

test('CFC-RED-01 host observation accepts split canonical execution while preserving raw model deviation', async () => {
  const evidenceRoot = fs.mkdtempSync(path.join(privateRoot, 'cfc-red-01-'));
  const run = await runScenario('five-role-split-deviation', { evidenceRoot });
  const recordPath = path.join(evidenceRoot, 'run-record.json');
  assert.equal(run.code, 0, run.stderr);
  assert.equal(fs.existsSync(recordPath), true, 'driver must persist its closed run record');
  const record = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
  assert.equal(record.verdict, 'AGENT_ACTIONS_ACCEPTED');
  assert.equal(record.evidence_mode, 'fake-fixture');
  assert.equal(record.host_capability, 'NOT_HOST_EVIDENCE');
  assert.equal(record.actions.length, 5);
  assert.deepEqual(record.actions.map((action) => action.model_deviation), [true, true, true, true, false]);
  for (const action of record.actions) {
    assert.equal(action.start_correlated, true);
    assert.equal(action.background_expected, true);
    assert.equal(action.evidence_method, 'POST_TOOL_INPUT');
    assert.equal(action.execution_input_exact, true);
    assert.equal(action.accepted, true);
  }
  assert.deepEqual(record.parse_errors, []);
  assert.equal(record.stderr_line_count, 1);
  assert.equal(record.stdin_closed_after_terminal, true);
  assert.equal(record.writers_settled, true);
  assert.equal(fs.existsSync(path.join(privateRoot, 'android-common-doc-runtime')), false,
    'offline fake must not invoke a production identity or registry writer');
});

test('CFC-OBSERVER-01 parses and records hook events without production authority imports', () => {
  const root = fs.mkdtempSync(path.join(privateRoot, 'cfc-observer-01-'));
  const canonicalInput = {
    description: 'arch-platform runtime bootstrap',
    subagent_type: 'arch-platform',
    name: 'arch-platform',
    prompt: 'canonical-bootstrap-ñ\r\nsecond-line',
    run_in_background: false,
  };
  fs.writeFileSync(path.join(root, 'probe-manifest.json'), `${JSON.stringify({
    schema: 'runtime/claude-host-contract-probe-manifest/v1',
    actions: { 'arch-platform': canonicalInput },
  }, null, 2)}\n`, { flag: 'wx' });
  const events = [
    { hook_event_name: 'SessionStart', session_id: 'probe-session', source: 'startup' },
    { hook_event_name: 'PreToolUse', session_id: 'probe-session', tool_use_id: 'toolu_probe_01', tool_name: 'Agent', tool_input: { subagent_type: 'arch-platform', name: 'arch-platform', prompt: 'model changed this' } },
    { hook_event_name: 'SubagentStart', session_id: 'probe-session', agent_id: 'agent-probe-01', agent_type: 'arch-platform' },
    { hook_event_name: 'PostToolUse', session_id: 'probe-session', tool_use_id: 'toolu_probe_01', tool_name: 'Agent', tool_input: canonicalInput },
    { hook_event_name: 'SubagentStop', session_id: 'probe-session', agent_id: 'agent-probe-01', agent_type: 'arch-platform' },
  ];
  for (const event of events) {
    const result = spawnSync(process.execPath, [probeObserver, '--root', root, '--evidence-mode', 'fake-fixture'], {
      cwd: projectRoot,
      input: JSON.stringify(event),
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.equal(result.status, 0, result.stderr);
    if (event.hook_event_name === 'PreToolUse') {
      const output = JSON.parse(result.stdout);
      assert.deepEqual(output.hookSpecificOutput.updatedInput, canonicalInput);
      assert.equal(Object.keys(output.hookSpecificOutput.updatedInput).length, 5);
    } else {
      assert.equal(result.stdout, '');
    }
  }
  const rows = fs.readFileSync(path.join(root, 'observer', 'events.jsonl'), 'utf8')
    .split(/\r?\n/).filter(Boolean).map(JSON.parse);
  assert.equal(rows.length, events.length);
  const expectedKeys = [
    'agent_id_digest', 'agent_type', 'evidence_mode', 'hook_event_name', 'observed_at',
    'producer', 'prompt_id_digest', 'raw_event', 'schema', 'session_digest', 'tool_input_digest',
    'tool_name', 'tool_use_digest', 'updated_input_digest',
  ].sort();
  for (const row of rows) {
    assert.deepEqual(Object.keys(row).sort(), expectedKeys);
    assert.equal(row.schema, 'runtime/claude-host-contract-probe-event/v1');
    assert.equal(row.evidence_mode, 'fake-fixture');
    assert.equal(row.producer, 'claude-host-contract-probe');
  }
  const source = fs.readFileSync(probeObserver, 'utf8');
  assert.doesNotMatch(source, /(?:\.\.\/)+lib\//);
  assert.doesNotMatch(source, /scripts[\\/]lib/);
});

test('CFC-OBSERVER-02 entrypoint mode records Agent hooks without requiring or rewriting a probe manifest', () => {
  const root = fs.mkdtempSync(path.join(privateRoot, 'cfc-observer-02-'));
  const event = {
    hook_event_name: 'PreToolUse',
    session_id: 'entrypoint-session',
    tool_use_id: 'toolu_entrypoint_01',
    tool_name: 'Agent',
    tool_input: {
      description: 'arch-integration runtime bootstrap',
      subagent_type: 'arch-integration',
      name: 'arch-integration',
      prompt: 'runtime bootstrap',
      run_in_background: false,
    },
  };
  const result = spawnSync(process.execPath, [
    entrypointObserver, '--root', root, '--evidence-mode', 'fake-fixture',
  ], {
    cwd: projectRoot,
    input: JSON.stringify(event),
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '', 'entrypoint observation must never make or rewrite a permission decision');
  assert.equal(fs.existsSync(path.join(root, 'probe-manifest.json')), false);
  const rows = fs.readFileSync(path.join(root, 'observer', 'events.jsonl'), 'utf8')
    .split(/\r?\n/).filter(Boolean).map(JSON.parse);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].hook_event_name, 'PreToolUse');
  assert.equal(rows[0].tool_name, 'Agent');
  assert.equal(rows[0].updated_input_digest, null);
  const source = fs.readFileSync(entrypointObserver, 'utf8');
  assert.doesNotMatch(source, /(?:\.\.\/)+lib\//);
  assert.doesNotMatch(source, /scripts[\\/]lib/);
});

test('HCP-POSITIVE proves the complete authority-free host contract with extra tools and MCP', async () => {
  const run = await runProbeScenario('hcp-success');
  assert.equal(run.code, 0, run.stderr);
  assert.equal(run.state.operation, 'host-contract-probe');
  assert.equal(run.state.status, 'HOST_CONTRACT_PROBE_COMPLETED');
  assert.equal(run.state.evidence_mode, 'fake-fixture');
  assert.equal(run.state.host_capability, 'NOT_HOST_EVIDENCE');
  assert.equal(run.state.join_method, 'single-outstanding-spawn');
  assert.equal(run.state.actor_attribution_method, 'direct-agent-id');
  assert.equal(run.state.unattributed_coordinator_read_count, 1);
  assert.equal(run.state.stable_actor_resume, true);
  assert.equal(run.state.distinct_same_type_peers, true);
  assert.equal(run.state.context_retained, true);
  assert.equal(run.state.extra_tools_mcp_compatible, true);
  assert.equal(run.state.product_authority_used, false);
  assert.equal(run.state.product_durable_artifact_manufactured_by_probe, false);
  const manifest = JSON.parse(fs.readFileSync(path.join(run.evidenceRoot, 'probe-manifest.json'), 'utf8'));
  const sequenceZero = fs.readFileSync(path.join(run.evidenceRoot, 'sequence-0-input.jsonl'), 'utf8');
  const sequenceZeroText = JSON.parse(sequenceZero).message.content[0].text;
  const aPrompt = manifest.actions['probe-peer-a'].prompt;
  const bPrompt = manifest.actions['probe-peer-b'].prompt;
  assert.match(sequenceZeroText, /to="probe-peer-a"/);
  assert.match(sequenceZeroText, /prove continuity from the unchanged native agent ID/);
  assert.match(sequenceZeroText, /respond exactly HOST_PROBE_COMPLETE/);
  assert.doesNotMatch(sequenceZeroText, /respond with the two native actor IDs/);
  assert.match(aPrompt, new RegExp(path.join(run.evidenceRoot, 'probe-a-one.txt').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(aPrompt, new RegExp(path.join(run.evidenceRoot, 'probe-a-two.txt').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(aPrompt, new RegExp(path.join(run.evidenceRoot, `${run.state.probe_nonce}.txt`).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(bPrompt, new RegExp(path.join(run.evidenceRoot, 'probe-b-one.txt').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('HCP-IDENTITY rejects wrong wake identity, replacement actors, and peer ID collision distinctly', async () => {
  const wrongWake = await runProbeScenario('hcp-wrong-wake-id');
  const replacement = await runProbeScenario('hcp-replacement-child');
  const resumeIdDrift = await runProbeScenario('hcp-resume-id-drift');
  const collision = await runProbeScenario('hcp-peer-id-collision');
  assert.notEqual(wrongWake.code, 0);
  assert.equal(wrongWake.state.status, 'HOST_UNSUPPORTED_NO_STABLE_RESUME');
  assert.notEqual(replacement.code, 0);
  assert.equal(replacement.state.status, 'HOST_REPLACEMENT_CHILD');
  assert.notEqual(resumeIdDrift.code, 0);
  assert.equal(resumeIdDrift.state.status, 'HOST_REPLACEMENT_CHILD');
  assert.notEqual(collision.code, 0);
  assert.equal(collision.state.status, 'HOST_PEER_ID_COLLISION');
});

test('HCP-LIFECYCLE rejects absent stop, absent wake, and lost retained context distinctly', async () => {
  const noStop = await runProbeScenario('hcp-missing-stop');
  const noWake = await runProbeScenario('hcp-missing-wake');
  const rejectedWake = await runProbeScenario('hcp-rejected-wake');
  const rejectedWakeThenPeer = await runProbeScenario('hcp-rejected-wake-then-peer-b');
  const noNonce = await runProbeScenario('hcp-missing-nonce');
  assert.notEqual(noStop.code, 0);
  assert.equal(noStop.state.status, 'HOST_UNSUPPORTED_NO_STOP');
  assert.notEqual(noWake.code, 0);
  assert.equal(noWake.state.status, 'HOST_UNSUPPORTED_NO_STABLE_RESUME');
  assert.notEqual(rejectedWake.code, 0);
  assert.equal(rejectedWake.state.status, 'HOST_UNSUPPORTED_NO_STABLE_RESUME');
  assert.notEqual(rejectedWakeThenPeer.code, 0);
  assert.equal(rejectedWakeThenPeer.state.status, 'HOST_UNSUPPORTED_NO_STABLE_RESUME');
  assert.notEqual(noNonce.code, 0);
  assert.equal(noNonce.state.status, 'HOST_CONTEXT_NOT_RETAINED');
});

test('HCP-EVIDENCE selects the honest executed-input rung and preserves divergent digests', async () => {
  const rung2 = await runProbeScenario('hcp-rung2-success');
  const divergent = await runProbeScenario('hcp-divergent-input');
  const absent = await runProbeScenario('hcp-no-executed-input');
  assert.equal(rung2.code, 0, rung2.stderr);
  assert.equal(rung2.state.evidence_method, 'START_PLUS_FIRST_OBSERVED_COMMAND');
  assert.equal(rung2.state.execution_input_exact, null);
  assert.notEqual(divergent.code, 0);
  assert.equal(divergent.state.status, 'HOST_UNSUPPORTED_NO_EXECUTED_INPUT');
  assert.match(divergent.state.observed_input_digest, /^[a-f0-9]{64}$/);
  assert.notEqual(divergent.state.observed_input_digest, divergent.state.canonical_input_digest);
  assert.notEqual(absent.code, 0);
  assert.equal(absent.state.status, 'HOST_UNSUPPORTED_NO_EXECUTED_INPUT');
});

test('HCP-TRANSPORT reuses chunk-safe JSONL and rejects foreign, malformed, and noisy streams', async () => {
  const chunked = await runProbeScenario('hcp-chunked-success');
  const foreign = await runProbeScenario('hcp-wrong-session');
  const malformed = await runProbeScenario('hcp-malformed-json');
  const noisy = await runProbeScenario('hcp-stderr');
  assert.equal(chunked.code, 0, chunked.stderr);
  assert.deepEqual(chunked.state.parse_errors, []);
  assert.notEqual(foreign.code, 0);
  assert.equal(foreign.state.status, 'INVALID_STREAM_SESSION');
  assert.notEqual(malformed.code, 0);
  assert.equal(malformed.state.status, 'INVALID_STREAM');
  assert.equal(noisy.code, 0, noisy.stderr);
  assert.equal(noisy.state.stderr_line_count, 1);
});

test('HCP-CONTAMINATION rejects cross-mode evidence and isolates offline poll scaling from native profile', async () => {
  const genuineInFake = await runProbeScenario('hcp-genuine-in-offline');
  const fakeInNative = await runProbeScenario('hcp-fake-in-native', {
    transportProfile: 'native-claude-cli',
    nativeFixture: true,
    extraEnv: { P4_CERT_OFFLINE_POLL_SCALE_MS: '1' },
  });
  assert.notEqual(genuineInFake.code, 0);
  assert.equal(genuineInFake.state.status, 'INVALID_EVIDENCE_MODE');
  assert.notEqual(fakeInNative.code, 0);
  assert.equal(fakeInNative.state.status, 'INVALID_EVIDENCE_MODE');
  assert.equal(fakeInNative.state.execution_mode, 'OFFLINE_NATIVE_PROFILE_SIMULATION');
  assert.equal(fakeInNative.state.effective_poll_scale_ms, 1000);
  assert.equal(fakeInNative.state.host_capability, 'NOT_HOST_EVIDENCE');
  assert.ok(fakeInNative.state.native_argv.includes('--verbose'));
  assert.equal(fakeInNative.state.native_argv.includes('--no-session-persistence'), true,
    'the qualified native profile must not persist session state outside the owned run evidence');
  assert.deepEqual(fakeInNative.state.native_argv.slice(0, 5), [
    '-p', '--verbose', '--input-format', 'stream-json', '--output-format',
  ]);
});

test('NATIVE-PRESENTATION uses one canonical Node executable and establishes the closed Agent relay before ACTION_REQUIRED', async () => {
  const run = await runScenario('success', {
    operation: 'entrypoint-protocol',
    transportProfile: 'native-claude-cli',
    nativeFixture: true,
  });
  assert.equal(run.code, 0, run.stderr);

  const preflight = run.state.entrypoint_node_executable_preflight;
  assert.equal(preflight.same_file, true);
  assert.equal(preflight.canonical_realpath, fs.realpathSync(preflight.invoked_path));
  assert.equal(fs.statSync(preflight.canonical_realpath).isFile(), true);

  const firstFrame = JSON.parse(fs.readFileSync(
    path.join(run.evidenceRoot, 'sequence-0-input.jsonl'), 'utf8',
  ).trim());
  const firstPrompt = firstFrame.message.content[0].text;
  const quotedCanonicalNode = `'${preflight.canonical_realpath.replaceAll("'", "'\\''")}'`;
  assert.ok(firstPrompt.includes(quotedCanonicalNode),
    'the first entrypoint command must use the canonical Node realpath later embedded in role actions');
  if (preflight.invoked_path !== preflight.canonical_realpath) {
    const quotedAlias = `'${preflight.invoked_path.replaceAll("'", "'\\''")}'`;
    assert.equal(firstPrompt.includes(quotedAlias), false,
      'a textual Node alias must not create a false mismatch against the canonical action bootstrap');
  }
  assert.match(firstPrompt,
    /If this exact command returns ACTION_REQUIRED, that result is the expected repository-local protocol response for this same test/i);
  assert.match(firstPrompt,
    /Agent proposal contains no bootstrap payload; the production gate derives the canonical bootstrap/i);
  assert.doesNotMatch(firstPrompt, /opaque Agent input data|pass it unchanged/i);
});

test('HCP-PERSISTENCE keeps transcripts only for live resume and removes the exact session files after exit', async () => {
  const transcriptRoot = fs.mkdtempSync(path.join(privateRoot, 'cfc-native-transcripts-'));
  const run = await runProbeScenario('hcp-transient-persistence-cleanup', {
    transportProfile: 'native-claude-cli',
    nativeFixture: true,
    extraEnv: { P4_CERT_NATIVE_TRANSCRIPT_ROOT: transcriptRoot },
  });
  assert.equal(run.code, 0, run.stderr);
  assert.equal(run.state.native_argv.includes('--no-session-persistence'), true,
    'the host-contract probe must use the captured no-persistence capability');
  assert.equal(run.state.session_transcript_policy, 'no-persistence-defensive-cleanup');
  assert.equal(run.state.transcript_cleanup.complete, true);
  assert.equal(run.state.transcript_cleanup.removed.length, 2);
  assert.equal(fs.existsSync(path.join(transcriptRoot, `${run.state.session_id}.jsonl`)), false);
  assert.equal(fs.existsSync(path.join(transcriptRoot, run.state.session_id, 'subagents', 'agent-agent-probe-a.jsonl')), false);
  assert.equal(fs.existsSync(path.join(run.evidenceRoot, 'native-session-transcripts', 'session.jsonl')), true);
  assert.equal(fs.existsSync(path.join(run.evidenceRoot, 'native-session-transcripts', 'subagent-01.jsonl')), true);
});

test('P4-PERSISTENCE uses no-persistence while cleanup remains idempotent for any host transcript artifacts', async () => {
  const transcriptRoot = fs.mkdtempSync(path.join(privateRoot, 'cfc-p4-native-transcripts-'));
  const run = await runScenario('success', {
    operation: 'entrypoint-protocol',
    transportProfile: 'native-claude-cli',
    nativeFixture: true,
    extraEnv: { P4_CERT_NATIVE_TRANSCRIPT_ROOT: transcriptRoot },
  });

  assert.equal(run.code, 0, run.stderr);
  assert.equal(run.state.native_argv.includes('--no-session-persistence'), true,
    'same-run SendMessage continuity must remain in-memory and must not require durable session persistence');
  assert.equal(run.state.session_transcript_policy, 'no-persistence-defensive-cleanup');
  assert.equal(run.state.cli_pin, null, 'offline native fixture must never claim a genuine CLI pin');
  assert.equal(run.state.transcript_cleanup.complete, true);
  assert.equal(run.state.transcript_cleanup.removed.length, 6,
    'the exact top-level transcript and five support-role transcripts must be cleaned');
  assert.equal(fs.existsSync(path.join(transcriptRoot, `${run.state.session_id}.jsonl`)), false);
  for (let index = 1; index <= 5; index += 1) {
    const agentId = `agent_${String(index).padStart(2, '0')}`;
    assert.equal(fs.existsSync(path.join(transcriptRoot, run.state.session_id, 'subagents', `agent-${agentId}.jsonl`)), false);
  }
  assert.equal(fs.existsSync(path.join(run.evidenceRoot, 'native-session-transcripts', 'session.jsonl')), true);
  for (let index = 1; index <= 5; index += 1) {
    assert.equal(fs.existsSync(path.join(run.evidenceRoot, 'native-session-transcripts', `subagent-${String(index).padStart(2, '0')}.jsonl`)), true);
  }
});

test('NATIVE-ENTRYPOINT runs entrypoint-protocol through the pinned native launch profile via the deterministic fixture', async () => {
  const projectSettingsPath = path.join(projectRoot, '.claude', 'settings.json');
  const observedHookEvents = [
    'SessionStart', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'SubagentStart', 'SubagentStop',
  ];
  const projectSettingsBefore = fs.readFileSync(projectSettingsPath, 'utf8');
  const projectSettings = JSON.parse(projectSettingsBefore);

  const run = await runScenario('success', {
    operation: 'entrypoint-protocol',
    transportProfile: 'native-claude-cli',
    nativeFixture: true,
  });

  assert.equal(run.code, 0, run.stderr);
  assert.equal(run.state.status, 'PROTOCOL_COMPLETED');
  assert.equal(run.state.operation, 'entrypoint-protocol');
  assert.equal(run.state.transport_profile, 'native-claude-cli');
  assert.equal(run.state.native_entrypoint_evidence_policy, 'NO_PRODUCTION_AUTHORITY_OFFLINE_SIMULATION',
    'native entrypoint mode must be explicitly recorded in state');

  const transcript = fs.readFileSync(run.state.transcript_path, 'utf8');
  const initEvent = JSON.parse(transcript.split(/\r?\n/).find(Boolean));
  assert.equal(initEvent.type, 'system');
  assert.equal(initEvent.subtype, 'init');
  assert.equal(path.resolve(initEvent.cwd), path.resolve(projectRoot),
    'the real child process cwd must be the exact projectRoot, never runRoot');
  assert.equal(run.state.host_identity_observation, 'system-init-stream',
    'the launcher must have validated system/init cwd against projectRoot to reach this state');

  assert.equal(run.state.native_argv.includes('--no-session-persistence'), true,
    'the final native entrypoint profile must use the probe-qualified no-persistence flag');
  const agentsIndex = run.state.native_argv.indexOf('--agents');
  assert.notEqual(agentsIndex, -1,
    'native entrypoint certification must explicitly register the five support roles and bounded root-source role');
  const nativeAgents = JSON.parse(run.state.native_argv[agentsIndex + 1]);
  assert.ok(Buffer.byteLength(run.state.native_argv[agentsIndex + 1], 'utf16le') < 30000,
    'explicit agent registration must remain safely below the Windows CreateProcess command-line limit');
  assert.deepEqual(Object.keys(nativeAgents).sort(), [
    'arch-integration', 'arch-platform', 'arch-testing', 'context-provider', 'doc-updater', 'toolkit-specialist',
  ]);
  for (const [role, definition] of Object.entries(nativeAgents)) {
    const source = fs.readFileSync(path.join(projectRoot, '.claude', 'agents', `${role}.md`), 'utf8');
    const frontmatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n[\s\S]*$/);
    assert.ok(frontmatter, `${role} must have valid frontmatter and a prompt body`);
    const value = (key) => frontmatter[1].match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))?.[1].trim();
    const expectedDescription = JSON.parse(value('description'));
    const expectedTools = value('tools').split(',').map((item) => item.trim());
    assert.equal(definition.description, expectedDescription);
    assert.deepEqual(definition.tools, expectedTools);
    assert.equal(definition.model, value('model'));
    const sourceSha = crypto.createHash('sha256').update(source).digest('hex');
    if (role === 'toolkit-specialist') {
      assert.doesNotMatch(definition.prompt, /bound to|\.claude[\\/]agents[\\/]toolkit-specialist\.md/i);
      assert.doesNotMatch(definition.prompt, new RegExp(sourceSha));
      assert.match(definition.prompt, /do not read or inspect any agent definition, source file, or repository path/i);
    } else {
      assert.match(definition.prompt, new RegExp(`\\.claude/agents/${role}\\.md`));
      assert.match(definition.prompt, new RegExp(sourceSha));
      assert.match(definition.prompt, /validated ready command returns the canonical bootstrap bundle/);
      assert.match(definition.prompt, /RUNTIME_RESUME\/v1[\s\S]*actor-action:none[\s\S]*reply:none/,
        'persistent support roles must interpret the closed resume notification as host-consumed data, not invent a lifecycle command or reply');
    }
  }
  assert.match(nativeAgents['toolkit-specialist'].prompt,
    /ROOT_SOURCE_BOOTSTRAP\/v1[\s\S]*publish_command[\s\S]*first tool call/i,
    'the launcher-only root-source profile must forbid diagnostic calls before publish-request');
  assert.deepEqual(initEvent.agents.filter((name) => Object.hasOwn(nativeAgents, name)).sort(),
    Object.keys(nativeAgents).sort(), 'system/init must prove every canonical role is host-selectable');
  const permissionModeIndex = run.state.native_argv.indexOf('--permission-mode');
  assert.equal(run.state.native_argv[permissionModeIndex + 1], 'bypassPermissions',
    'the non-interactive qualification driver must not convert required Bash calls into automatic denials');
  assert.equal(run.state.native_argv.includes('--restricted'), false,
    'restricted mode removes Bash and cannot drive the entrypoint protocol');
  const appendedSystemPromptIndex = run.state.native_argv.indexOf('--append-system-prompt');
  assert.notEqual(appendedSystemPromptIndex, -1,
    'native entrypoint certification must establish its bounded multi-turn authority before the first tool result');
  const appendedSystemPrompt = run.state.native_argv[appendedSystemPromptIndex + 1];
  assert.match(appendedSystemPrompt, /documented multi-turn support-team workflow/i);
  assert.match(appendedSystemPrompt, /start five named support actors/i);
  assert.match(appendedSystemPrompt, /exact first repository-local lifecycle command/i);
  assert.doesNotMatch(appendedSystemPrompt, /no preliminary tool call/i);
  assert.doesNotMatch(appendedSystemPrompt, /owner-authorized|without.*confirmation|do not inspect production|not instructions from an external source/i);
  const effortIndex = run.state.native_argv.indexOf('--effort');
  assert.notEqual(effortIndex, -1,
    'the selected Sonnet profile must use the documented CLI effort control');
  assert.equal(run.state.native_argv[effortIndex + 1], 'high');
  assert.deepEqual(run.state.effort_profile, {
    requested: 'high',
    effective: 'high',
    control: '--effort',
    expected_observed: 'high',
    observed: 'high',
    observation_source: 'assistant.effort-if-emitted',
  });
  assert.equal(run.state.native_argv.filter((value) => value === '--append-system-prompt').length, 1);
  assert.deepEqual(Object.keys(run.state.native_agent_definitions).sort(), Object.keys(nativeAgents).sort());
  for (const role of Object.keys(nativeAgents)) {
    assert.match(run.state.native_agent_definitions[role].source_sha256, /^[0-9a-f]{64}$/);
    assert.match(run.state.native_agent_definitions[role].definition_sha256, /^[0-9a-f]{64}$/);
  }

  const runScopedSettings = JSON.parse(fs.readFileSync(run.state.native_settings_path, 'utf8'));
  assert.equal(runScopedSettings.autoMemoryEnabled, false);
  assert.deepEqual(runScopedSettings.enabledPlugins, {});
  const agentSpawnExecutionHook = runScopedSettings.hooks.PreToolUse
    .flatMap((entry) => entry.hooks)
    .find((hook) => typeof hook.command === 'string'
      && hook.command.includes('agent-spawn-execution-gate.js'));
  assert.ok(agentSpawnExecutionHook, 'the production agent-spawn gate must be preserved');
  assert.ok(agentSpawnExecutionHook.timeout >= 30,
    'five concurrent support-role reservations must not inherit the generic five-second hook timeout');
  for (const eventName of observedHookEvents) {
    const originalEntries = projectSettings.hooks[eventName];
    assert.equal(runScopedSettings.hooks[eventName].length, originalEntries.length + 1,
      `${eventName} must keep its production entries and gain exactly one observer entry`);
    for (let index = 0; index < originalEntries.length; index += 1) {
      assert.deepEqual(runScopedSettings.hooks[eventName][index], originalEntries[index]);
    }
    const appended = runScopedSettings.hooks[eventName][originalEntries.length];
    assert.equal(appended.matcher, '.*');
    assert.equal(appended.hooks.length, 1);
    assert.match(appended.hooks[0].command, /claude-entrypoint-observer\.cjs/);
  }
  assert.equal(fs.readFileSync(projectSettingsPath, 'utf8'), projectSettingsBefore,
    'the project .claude/settings.json must never be edited');

  assert.equal(run.state.first_action_exact, true);
  assert.equal(run.state.sequence, 5);
  assert.equal(run.state.action_relay_count, 2);
  assert.equal(run.state.agent_calls_exact, true);
  assert.equal(run.state.agent_call_count, 5);
  assert.deepEqual(run.state.actions.map((item) => item.background_expected), [true, true, true, true, true]);
  assert.deepEqual(run.state.agent_action_order, [
    'arch-integration', 'arch-platform', 'arch-testing', 'context-provider', 'doc-updater',
  ]);
  assert.equal(run.state.source_unchanged, true);

  assert.equal(fs.existsSync(path.join(privateRoot, 'android-common-doc-runtime')), false,
    'native-fixture mode must never create production registry authority');
});

test('NATIVE-ENTRYPOINT retires only its exact terminal session generation', async () => {
  const rll = require('../lib/runtime-role-lifecycle.cjs');
  const forcedSessionId = crypto.randomUUID();
  const identity = { provider: 'claude-hook', runtime_session_key: forcedSessionId };
  const generationPath = rll.sessionGenerationPathFor(projectRoot, identity);
  fs.mkdirSync(path.dirname(generationPath), { recursive: true });
  const createdAt = new Date(Date.now() - 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const expiresAt = new Date(Date.now() + 3_600_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const generationId = crypto.randomBytes(16).toString('hex');
  fs.writeFileSync(generationPath, JSON.stringify({
    schema: 'runtime/session-generation/v1',
    provider: identity.provider,
    runtime_session_key: identity.runtime_session_key,
    generation_id: generationId,
    created_at: createdAt,
    expires_at: expiresAt,
  }), { flag: 'wx' });

  const run = await runScenario('bad-first-tool', {
    operation: 'entrypoint-protocol',
    transportProfile: 'native-claude-cli',
    nativeFixture: true,
    extraEnv: {
      P4_CERT_OFFLINE_SESSION_ID: forcedSessionId,
      P4_CERT_TEST_RETIRE_SESSION_AUTHORITY: '1',
    },
  });

  assert.notEqual(run.code, 0);
  assert.equal(run.state.status, 'INVALID_FIRST_ACTION');
  assert.equal(run.state.native_session_authority_retirement.complete, true);
  assert.equal(run.state.native_session_authority_retirement.status, 'retired');
  assert.equal(run.state.native_session_authority_retirement.generation_id_digest,
    crypto.createHash('sha256').update(generationId).digest('hex'));
  const retired = JSON.parse(fs.readFileSync(generationPath, 'utf8'));
  assert.equal(retired.runtime_session_key, forcedSessionId);
  assert.equal(retired.generation_id, generationId);
  assert.ok(Date.parse(retired.expires_at) <= Date.now());
  assert.deepEqual(rll.peekSessionGeneration(projectRoot, identity), {
    ok: false, reason: 'session-generation-expired',
  });
});

test('P4-FULL-SCENARIO drives bootstrap, idempotent second ensure, resume continuity, work, denied and approved ingestion, monitor, and owned cleanup in one session', async () => {
  const run = await runP4FullScenario('p4-full-scenario');
  assert.equal(run.code, 0, run.stderr);
  assert.equal(run.state.status, 'P4_FULL_SCENARIO_COMPLETED');
  assert.equal(run.state.p4_stage, 'cleanup');

  assert.deepEqual(run.state.p4_steps.map((step) => step.name), [
    'bootstrap', 'second-ensure', 'resume', 'work',
    'ingest-denied', 'ingest-approved', 'monitor', 'cleanup',
  ]);
  const stepsByName = Object.fromEntries(run.state.p4_steps.map((step) => [step.name, step]));
  assert.deepEqual([stepsByName.bootstrap.entrypoint, stepsByName.bootstrap.status], ['init-session', 'READY']);
  assert.deepEqual([stepsByName['second-ensure'].entrypoint, stepsByName['second-ensure'].status], ['init-session', 'READY']);
  assert.deepEqual([stepsByName.resume.entrypoint, stepsByName.resume.status], ['resume-work', 'READY']);
  assert.deepEqual([stepsByName.work.entrypoint, stepsByName.work.status], ['work', 'COMPLETED']);
  assert.deepEqual([stepsByName['ingest-denied'].entrypoint, stepsByName['ingest-denied'].status, stepsByName['ingest-denied'].detail], ['ingest-content', 'BLOCKED', 'approval-required']);
  assert.deepEqual([stepsByName['ingest-approved'].entrypoint, stepsByName['ingest-approved'].status], ['ingest-content', 'COMPLETED']);
  assert.deepEqual([stepsByName.monitor.entrypoint, stepsByName.monitor.status], ['monitor-docs', 'COMPLETED']);
  assert.equal(stepsByName.monitor.observations_count, 1);
  assert.equal(stepsByName.monitor.proposals_count, 0);
  // Strictly increasing sequence across every recorded step -- the same
  // monotonically increasing input-sequence contract as the rest of the run.
  const sequences = run.state.p4_steps.map((step) => step.sequence);
  for (let index = 1; index < sequences.length; index += 1) assert.ok(sequences[index] > sequences[index - 1]);

  const ingestionResult = stepsByName['ingest-approved'].ingestion_result;
  assert.equal(ingestionResult.request_ref, P4_INGEST_REQUEST_REF);
  assert.equal(ingestionResult.approval_ref, P4_INGEST_APPROVAL_REF);
  assert.equal(ingestionResult.request_digest, P4_INGEST_REQUEST_REF.slice('request:'.length));
  assert.equal(ingestionResult.approval_digest, P4_INGEST_APPROVAL_REF.slice('approval:'.length));

  assert.equal(Object.keys(run.state.p4_role_actor_digests).sort().join(','), [...P4_SUPPORT_ROLES].sort().join(','));
  for (const role of P4_SUPPORT_ROLES) {
    assert.equal(run.state.p4_role_actor_digests[role].length, 1, `role ${role} must start with exactly one actor`);
    assert.deepEqual(
      run.state.p4_role_actor_resumed_digests[role],
      [run.state.p4_role_actor_digests[role][0], run.state.p4_role_actor_digests[role][0]],
      `role ${role} must resume once with the identical actor identity`,
    );
  }

  assert.deepEqual(run.state.p4_cleanup.map((entry) => entry.role), P4_SUPPORT_ROLES);
  for (const entry of run.state.p4_cleanup) assert.equal(entry.status, 'STOPPED');

  assert.equal(run.state.first_action_exact, true);
  assert.equal(run.state.action_relay_count, 4,
    'bootstrap, five-role resume, work delivery, and approved-ingestion delivery must each use the real action relay');
  assert.equal(run.state.p4_resume_sendmessage_action_count, 5);
  assert.deepEqual(run.state.p4_resume_action_order, [
    'arch-integration', 'arch-platform', 'arch-testing', 'context-provider', 'doc-updater',
  ]);
  assert.equal(run.state.agent_calls_exact, true);
  assert.equal(run.state.agent_call_count, 5);
  assert.deepEqual(run.state.agent_action_order, [
    'arch-integration', 'arch-platform', 'arch-testing', 'context-provider', 'doc-updater',
  ]);
  assert.equal(run.state.root_source_agent_call_count, 1);
  assert.deepEqual(run.state.root_source_agent_action_order, ['toolkit-specialist']);
  assert.equal(run.state.root_source_actions[0].family, 'root-source-spawn');
  assert.equal(run.state.root_source_actions[0].accepted, true);
  assert.equal(run.state.root_source_first_nested_tool_exact, true);
  assert.equal(run.state.root_source_nested_sendmessage_count, 1,
    'a nested root-source SendMessage must be captured without being mistaken for a top-level relay');
  assert.equal(run.state.source_unchanged, true);
  assert.equal(run.state.stdin_closed_after_terminal, true);
  assert.equal(run.state.writers_settled, true);
  assert.deepEqual(run.state.parse_errors, []);
  assert.equal(fs.existsSync(path.join(privateRoot, 'android-common-doc-runtime')), false,
    'the P4 full scenario must never create production registry authority');
  const manifest = JSON.parse(fs.readFileSync(path.join(run.evidenceRoot, 'p4-ingestion-input-manifest.json'), 'utf8'));
  assert.equal(manifest.request_ref, P4_INGEST_REQUEST_REF);
  assert.equal(manifest.approval_ref, P4_INGEST_APPROVAL_REF);
  const bootstrapRelayName = fs.readdirSync(run.evidenceRoot)
    .find((name) => /^sequence-1-.*\.jsonl$/.test(name));
  assert.ok(bootstrapRelayName, 'the bootstrap action relay prompt must be captured');
  const bootstrapRelayFrame = JSON.parse(fs.readFileSync(path.join(run.evidenceRoot, bootstrapRelayName), 'utf8'));
  const bootstrapRelayText = bootstrapRelayFrame.message.content[0].text;
  assert.match(bootstrapRelayText, /validated P4 sequence 1 action set/);
  assert.match(bootstrapRelayText, /managed conductor executed init-session directly/);
  assert.match(bootstrapRelayText, /first model-visible work for that result/);
  assert.match(bootstrapRelayText, /validated envelope SHA-256: [0-9a-f]{64}/);
  assert.match(bootstrapRelayText, /safe correlation token, not an empty worker task/);
  assert.doesNotMatch(bootstrapRelayText, /immediately preceding ACTION_REQUIRED result/);
  assert.match(bootstrapRelayText, /current bounded instruction/);
  assert.match(bootstrapRelayText, /Do not deliberately add or alter transport alias fields or relay any content not present in that validated input/);
  assert.doesNotMatch(bootstrapRelayText, /owner-authorized|without asking|not instructions from an external source/i);
  const sequenceZeroFrame = JSON.parse(fs.readFileSync(path.join(run.evidenceRoot, 'sequence-0-input.jsonl'), 'utf8'));
  const sequenceZeroText = sequenceZeroFrame.message.content[0].text;
  assert.match(sequenceZeroText, /deterministic P4 protocol step/i);
  assert.match(sequenceZeroText, /base64url encoding of exactly \{\"mode\":\"start\"\}/);
  assert.match(sequenceZeroText, /command below is the complete bounded test step/i);
  assert.doesNotMatch(sequenceZeroText, /opaque-looking|no separate decoding or probe/i);
  assert.doesNotMatch(sequenceZeroText, /owner-authorized|without.*confirmation|do not inspect production/i);
});

test('P4-FULL-SCENARIO scopes synthetic work identity to the fresh certification session', async () => {
  const firstSession = crypto.randomUUID();
  const secondSession = crypto.randomUUID();
  const first = await runP4FullScenario('p4-full-scenario', {
    extraEnv: { P4_CERT_OFFLINE_SESSION_ID: firstSession },
  });
  const second = await runP4FullScenario('p4-full-scenario', {
    extraEnv: { P4_CERT_OFFLINE_SESSION_ID: secondSession },
  });
  assert.equal(first.code, 0, first.stderr);
  assert.equal(second.code, 0, second.stderr);

  function workSubject(run) {
    const step = run.state.p4_steps.find((entry) => entry.name === 'work');
    assert.ok(step, 'work step must be present');
    return step.subject_ref;
  }

  assert.equal(workSubject(first), `subject:${crypto.createHash('sha256').update(`p4-certification-work\0${firstSession}`).digest('hex')}`);
  assert.equal(workSubject(second), `subject:${crypto.createHash('sha256').update(`p4-certification-work\0${secondSession}`).digest('hex')}`);
  assert.notEqual(workSubject(first), workSubject(second));
});

test('P4-FULL-SCENARIO treats a queued bootstrap relay as at-most-once after native inline execution', async () => {
  const run = await runP4FullScenario('p4-inline-bootstrap-before-relay');
  assert.equal(run.code, 0, run.stderr);
  assert.equal(run.state.status, 'P4_FULL_SCENARIO_COMPLETED');
  assert.equal(run.state.agent_call_count, 5,
    'the queued relay must validate the already completed inline batch without emitting a second batch');
  assert.deepEqual(run.state.agent_action_order, [
    'arch-integration', 'arch-platform', 'arch-testing', 'context-provider', 'doc-updater',
  ]);
  const relayFrame = JSON.parse(fs.readFileSync(path.join(run.evidenceRoot, 'sequence-1-actions-1.jsonl'), 'utf8'));
  const relayText = relayFrame.message.content[0].text;
  assert.match(relayText, /Each action_id is at-most-once for this session/);
  assert.match(relayText, /make no tool call and end this turn/);
});

test('P4-FULL-SCENARIO root-source profile cannot invite an agent-definition read before publish_command', async () => {
  const run = await runP4FullScenario('p4-root-minimal-profile');
  assert.equal(run.code, 0, run.stderr);
  assert.equal(run.state.status, 'P4_FULL_SCENARIO_COMPLETED');
  assert.equal(run.state.root_source_first_nested_tool_exact, true);
  const agentsIndex = run.state.native_argv.indexOf('--agents');
  const nativeAgents = JSON.parse(run.state.native_argv[agentsIndex + 1]);
  assert.doesNotMatch(nativeAgents['toolkit-specialist'].prompt,
    /bound to|\.claude[\\/]agents[\\/]toolkit-specialist\.md/i);
  assert.match(run.state.native_agent_definitions['toolkit-specialist'].source_sha256, /^[0-9a-f]{64}$/,
    'canonical source identity remains evidence even though it is not exposed to the model');
});

test('P4-FULL-SCENARIO accepts only the canonicalized executed root-source publish input', async () => {
  const run = await runP4FullScenario('p4-root-canonicalized-first-bash');
  assert.equal(run.code, 0, run.stderr);
  assert.equal(run.state.status, 'P4_FULL_SCENARIO_COMPLETED');
  assert.equal(run.state.root_source_first_nested_tool_exact, true,
    'raw model deviation is acceptable only when PostToolUse proves the action-derived command plus genuine grant executed');
});

test('P4-FULL-SCENARIO rejects any nested root-source tool before the exact publish command', async () => {
  const run = await runP4FullScenario('p4-root-extra-first-tool');
  assert.notEqual(run.code, 0);
  assert.equal(run.state.status, 'INVALID_ROOT_SOURCE_PROTOCOL');
  assert.match(run.state.invalidation_reason, /first nested tool call.*publish_command/i);
  assert.equal(run.state.root_source_first_nested_tool_exact, false);
});

test('P4-FULL-SCENARIO rejects at the Agent boundary when canonical publish execution never appears', async () => {
  const run = await runP4FullScenario('p4-root-second-tool-before-first-execution');
  assert.notEqual(run.code, 0);
  assert.equal(run.state.status, 'INVALID_ROOT_SOURCE_PROTOCOL');
  assert.match(run.state.invalidation_reason, /first nested tool call.*publish_command/i);
  assert.equal(run.state.root_source_first_nested_tool_exact, false);
});

test('P4-FULL-SCENARIO waits for the Agent boundary when a concurrent proposal precedes canonical first-tool observation', async () => {
  const run = await runP4FullScenario('p4-root-concurrent-proposal-first-executes-canonical');
  assert.equal(run.code, 0, run.stderr);
  assert.equal(run.state.status, 'P4_FULL_SCENARIO_COMPLETED');
  assert.equal(run.state.root_source_first_nested_tool_exact, true);
});

test('P4-FULL-SCENARIO ignores a foreground subagent ready result until root cleanup begins', async () => {
  const run = await runP4FullScenario('p4-subagent-ready-result');
  assert.equal(run.code, 0, run.stderr);
  assert.equal(run.state.status, 'P4_FULL_SCENARIO_COMPLETED');
  assert.equal(run.state.agent_call_count, 5);
  assert.deepEqual(run.state.p4_cleanup.map((entry) => entry.status), Array(5).fill('STOPPED'));
});

test('P4-FULL-SCENARIO rejects an idempotent second ensure that spawns again', async () => {
  const run = await runP4FullScenario('p4-second-ensure-spawns-again');
  assert.notEqual(run.code, 0);
  assert.equal(run.state.status, 'INVALID_P4_SEQUENCE');
  assert.match(run.state.invalidation_reason, /second init-session start introduced another Agent start/);
  assert.deepEqual(run.state.p4_steps.map((step) => step.name), ['bootstrap']);
});

test('P4-FULL-SCENARIO rejects a SendMessage action without successful correlated delivery', async () => {
  const run = await runP4FullScenario('p4-sendmessage-fails');
  assert.notEqual(run.code, 0);
  assert.equal(run.state.status, 'INVALID_ACTION_RELAY');
  assert.match(run.state.invalidation_reason, /did not prove successful delivery/);
  assert.deepEqual(run.state.p4_steps.map((step) => step.name), [
    'bootstrap', 'second-ensure', 'resume', 'work', 'ingest-denied',
  ]);
});

test('P4-FULL-SCENARIO accepts the pinned Claude 2.1.261 native SendMessage schema', async () => {
  const run = await runP4FullScenario('p4-native-sendmessage-schema');
  assert.equal(run.code, 0,
    `${run.stderr}\nstatus=${run.state.status}\nreason=${run.state.invalidation_reason || 'none'}`);
  assert.equal(run.state.status, 'P4_FULL_SCENARIO_COMPLETED');
  assert.equal(run.state.p4_resume_sendmessage_action_count, 5);
  assert.ok(run.state.sendmessage_proposals.length >= 5);
  assert.ok(run.state.sendmessage_proposals.slice(0, 5)
    .every((entry) => entry.projection === 'claude-2.1.261-transport-aliases'));
});

test('P4-FULL-SCENARIO rejects contradictory Claude 2.1.261 SendMessage transport aliases', async () => {
  const run = await runP4FullScenario('p4-native-sendmessage-alias-mismatch');
  assert.notEqual(run.code, 0);
  assert.equal(run.state.status, 'INVALID_ACTION_RELAY');
  assert.match(run.state.invalidation_reason, /did not match the pending owning action/);
});

test('P4-FULL-SCENARIO rejects a resume that replaces an owned actor', async () => {
  const run = await runP4FullScenario('p4-resume-replaces-actor');
  assert.notEqual(run.code, 0);
  assert.equal(run.state.status, 'INVALID_P4_SEQUENCE');
  assert.match(run.state.invalidation_reason, /resume-work replaced an owned role actor/);
  assert.deepEqual(run.state.p4_steps.map((step) => step.name), ['bootstrap', 'second-ensure']);
});

test('P4-FULL-SCENARIO rejects an approved ingestion whose result mismatches the supplied refs', async () => {
  const run = await runP4FullScenario('p4-ingest-approved-mismatch');
  assert.notEqual(run.code, 0);
  assert.equal(run.state.status, 'INVALID_P4_SEQUENCE');
  assert.match(run.state.invalidation_reason, /approved ingestion lacked or mismatched/);
  assert.deepEqual(run.state.p4_steps.map((step) => step.name), [
    'bootstrap', 'second-ensure', 'resume', 'work', 'ingest-denied',
  ]);
});

test('P4-FULL-SCENARIO stops instead of redelivering a semantically identical no-progress action', async () => {
  const run = await runP4FullScenario('p4-ingest-action-no-progress', {
    extraEnv: {
      P4_CERT_MANAGED_CONDUCTOR_OFFLINE: '1',
      P4_CERT_MANAGED_COMMAND_FAKE: fakeManagedCommand,
      P4_CERT_REPEAT_INGEST_ACTION: '1',
    },
  });
  assert.notEqual(run.code, 0, JSON.stringify({
    status: run.state.status,
    digests: run.state.managed_action_set_digests,
    commands: run.state.managed_conductor_commands && run.state.managed_conductor_commands.map((item) => item.name),
  }));
  assert.equal(run.state.status, 'INVALID_ACTION_RELAY');
  assert.match(run.state.invalidation_reason, /repeated a semantically identical action set/i);
  assert.deepEqual(run.state.p4_steps.map((step) => step.name), [
    'bootstrap', 'second-ensure', 'resume', 'work', 'ingest-denied',
  ]);
});

test('P4-FULL-SCENARIO stops a re-minted equivalent no-progress delivery whose transient envelope fields all changed', async () => {
  // Live regression: the producer re-minted the SAME approved-ingestion notify (same role,
  // same artifact_ref, same phase, byte-identical message) with a fresh action id, expiry,
  // session generation, binding id and plan/policy digest on every emission. The
  // byte-identical-envelope detector saw N distinct action sets and redelivered forever
  // while the stage stayed `ingest-approved` and no result was ever written.
  const run = await runP4FullScenario('p4-ingest-action-no-progress', {
    extraEnv: {
      P4_CERT_MANAGED_CONDUCTOR_OFFLINE: '1',
      P4_CERT_MANAGED_COMMAND_FAKE: fakeManagedCommand,
      P4_CERT_REPEAT_INGEST_ACTION_VARIED: '1',
    },
  });
  assert.notEqual(run.code, 0, JSON.stringify({
    status: run.state.status,
    steps: run.state.p4_steps && run.state.p4_steps.map((step) => step.name),
    identities: run.state.managed_delivered_identity_digests,
  }));
  assert.equal(run.state.status, 'INVALID_ACTION_RELAY');
  assert.match(run.state.invalidation_reason, /NO_PROGRESS/);
  assert.match(run.state.invalidation_reason, /ingest-content redelivered an equivalent action set for \[doc-updater\]/);
  const evidence = run.state.managed_action_no_progress;
  assert.equal(evidence.detector, 'delivered-identity');
  assert.equal(evidence.entrypoint, 'ingest-content');
  assert.equal(evidence.stage, 'ingest-approved');
  assert.deepEqual(evidence.roles, ['doc-updater']);
  assert.equal(evidence.occurrences, 2);
  assert.match(evidence.identity_digest, /^[a-f0-9]{64}$/);
  // The byte-level detector genuinely could not see this: both re-mints were recorded as
  // DISTINCT exact envelope digests, so only the delivered-identity key caught the repeat.
  const exactDigests = run.state.managed_action_set_digests;
  assert.equal(new Set(exactDigests).size, exactDigests.length);
  assert.equal(exactDigests.length, run.state.managed_delivered_identity_digests.length + 1);
  // Fails closed on the SECOND equivalent delivery: the stage never advanced past
  // ingest-approved and no ingestion result was ever accepted.
  assert.deepEqual(run.state.p4_steps.map((step) => step.name), [
    'bootstrap', 'second-ensure', 'resume', 'work', 'ingest-denied',
  ]);
  assert.equal(run.state.p4_stage, 'ingest-approved');
});

test('CFC-PREP refuses a full P4 launch when every arch verdict binds a stale PLAN', async () => {
  // Live regression: the PLAN advanced after the last APPROVED-PREP publication, so the
  // production premature-execution-gate deterministically blocked the doc-updater's
  // correlated ingestion result. The run discovered that only after consuming a genuine
  // Claude session, then redelivered the same notify until it was killed by hand.
  const fixture = makePrepFixtureRepo('stale-plan');
  fixture.writeVerdict('platform', 'f'.repeat(64), fixture.head);
  const run = await runP4FullScenario('p4-full-scenario', {
    extraLauncherArgs: ['--prep-preflight-root', fixture.root],
  });
  assert.notEqual(run.code, 0, run.stderr);
  assert.equal(run.state.status, 'MISSING_CURRENT_PREP');
  assert.match(run.state.invalidation_reason, /current PREP preflight failed: no-current-prep-verdict/);
  const preflight = run.state.current_prep_preflight;
  assert.equal(preflight.clear, false);
  assert.equal(preflight.evaluated_root, fixture.root);
  assert.equal(preflight.plan_sha256, fixture.planSha256);
  assert.equal(preflight.head, fixture.head);
  assert.deepEqual(preflight.examined, [{
    verdict: 'arch-platform-verdict.md',
    rejected: 'stale-plan-binding',
    bound_plan_sha256: 'f'.repeat(64),
  }]);
  // Nothing was spawned: the refusal costs no Claude session at all.
  assert.equal(run.state.pid, undefined);
  assert.equal(run.state.p4_steps, undefined);
});

test('CFC-PREP refuses a full P4 launch when the current-PLAN verdict binds a PREP-HEAD outside HEAD ancestry', async () => {
  const fixture = makePrepFixtureRepo('foreign-head');
  fixture.writeVerdict('testing', fixture.planSha256, fixture.unrelatedHead);
  const run = await runP4FullScenario('p4-full-scenario', {
    extraLauncherArgs: ['--prep-preflight-root', fixture.root],
  });
  assert.notEqual(run.code, 0, run.stderr);
  assert.equal(run.state.status, 'MISSING_CURRENT_PREP');
  assert.deepEqual(run.state.current_prep_preflight.examined, [{
    verdict: 'arch-testing-verdict.md',
    rejected: 'prep-head-not-ancestor',
    bound_prep_head: fixture.unrelatedHead,
  }]);
  assert.equal(run.state.pid, undefined);
});

test('CFC-PREP clears and runs the full P4 scenario when a current APPROVED-PREP verdict exists', async () => {
  const fixture = makePrepFixtureRepo('current');
  fixture.writeVerdict('platform', 'f'.repeat(64), fixture.head);
  fixture.writeVerdict('testing', fixture.planSha256, fixture.head);
  const run = await runP4FullScenario('p4-full-scenario', {
    extraLauncherArgs: ['--prep-preflight-root', fixture.root],
  });
  assert.equal(run.code, 0, `${run.stderr}\n${JSON.stringify(run.state.current_prep_preflight, null, 2)}`);
  assert.equal(run.state.status, 'P4_FULL_SCENARIO_COMPLETED');
  const preflight = run.state.current_prep_preflight;
  assert.equal(preflight.clear, true);
  assert.equal(preflight.reason, 'current-prep-present');
  assert.equal(preflight.verdict, 'arch-testing-verdict.md');
  assert.equal(preflight.prep_head, fixture.head);
  assert.equal(preflight.plan_sha256, fixture.planSha256);
  // The stale sibling verdict is examined and rejected, never silently accepted.
  assert.deepEqual(preflight.examined, [{
    verdict: 'arch-platform-verdict.md',
    rejected: 'stale-plan-binding',
    bound_plan_sha256: 'f'.repeat(64),
  }]);
});

test('CFC-MCP pins the run-scoped MCP toolkit root for doc-updater instead of inheriting a foreign ANDROID_COMMON_DOC', async () => {
  // Live regression: ANDROID_COMMON_DOC was set in the ambient shell to a DIFFERENT
  // checkout. The run-scoped stdio MCP server resolves its toolkit root from that variable
  // before falling back to its own install location, so doc-updater's search-docs answered
  // out of the other repository, reported the request's expected_existing_doc as absent,
  // and the role correctly refused to attest a result it could not verify. No correlated
  // result was ever written.
  const foreignRoot = fs.mkdtempSync(path.join(privateRoot, 'cfc-foreign-toolkit-'));
  const run = await runP4FullScenario('p4-full-scenario', {
    extraEnv: {
      P4_CERT_MANAGED_CONDUCTOR_OFFLINE: '1',
      P4_CERT_MANAGED_COMMAND_FAKE: fakeManagedCommand,
      ANDROID_COMMON_DOC: foreignRoot,
    },
  });
  assert.equal(run.code, 0, run.stderr);
  assert.equal(run.state.status, 'P4_FULL_SCENARIO_COMPLETED');
  const observed = JSON.parse(fs.readFileSync(
    path.join(run.evidenceRoot, 'direct-role-mcp-env-doc-updater.json'), 'utf8'));
  assert.equal(observed.role, 'doc-updater');
  assert.equal(observed.android_common_doc, projectRoot,
    'the MCP server must resolve the toolkit under certification, never the ambient value');
  assert.notEqual(observed.android_common_doc, foreignRoot);
  // Recorded as admitted-host evidence, and scoped to the one role that gets an MCP server.
  const hosts = run.state.direct_role_hosts.filter((host) => host.persistent === true);
  const docUpdater = hosts.find((host) => host.role === 'doc-updater');
  assert.equal(docUpdater.mcp_toolkit_root, projectRoot);
  for (const host of hosts.filter((h) => h.role !== 'doc-updater')) {
    assert.equal(host.mcp_toolkit_root, null, `${host.role} must receive no MCP server`);
  }
});

test('CFC-P5-OPTIN binds the P5 target roles to the policy Codex worker opt-in', () => {
  // Live regression: mixed-review-request exited RC.UNAVAILABLE (4) because
  // s16ResolveMixedReviewPair could not resolve a retained codex-app-server worker for the
  // target role. ensure() provisions one only for roles in
  // selection.codex_worker_opt_in_roles; the shipped policy listed none, so P5 was
  // unrunnable by construction. Two structurally independent offline fakes -- the managed
  // command fixture and the native fixture child -- both answer WAITING for
  // mixed-review-request unconditionally and never read policy, so nothing else in this
  // suite can see this class of regression.
  //
  // PLAN section 8 scopes the opt-in to the P5 generation: set it to
  // ["context-provider","arch-platform"] BEFORE that generation's first ensure, and
  // "Preserve U1's default no-Codex configuration" otherwise. P4 therefore certifies with
  // the key ABSENT and P5 with it present, so this test must hold in both states: it pins
  // the contents whenever the key exists, and always pins the additive invariants.
  const launcherSource = fs.readFileSync(launcher, 'utf8');
  // Bound each scan to its own statement. An unbounded non-greedy scan would silently
  // run past a hoisted constant into the NEXT target_role literal 13 lines below and
  // validate the wrong role instead of failing closed.
  const targetRoleIn = (declaration) => {
    const statement = new RegExp(`const ${declaration}[^;]*;`).exec(launcherSource);
    assert.ok(statement, `${declaration} must be a single statement in the launcher`);
    const match = /target_role:\s*'([a-z-]+)'/.exec(statement[0]);
    assert.ok(match, `${declaration} must name a literal target_role`);
    return match[1];
  };
  const mixedTarget = targetRoleIn('p5MixedIntentValue');
  const docsTarget = targetRoleIn('p5DocsIntentValue');
  assert.notEqual(mixedTarget, docsTarget, 'the review target and the docs-MCP target must differ');

  const policy = JSON.parse(fs.readFileSync(
    path.join(projectRoot, 'scripts', 'lib', 'runtime-collaboration-policy.json'), 'utf8'));
  const routing = JSON.parse(fs.readFileSync(
    path.join(projectRoot, 'scripts', 'lib', 'runtime-routing.json'), 'utf8'));

  // Additive invariants hold in BOTH configurations: the opt-in may never relax the
  // deny-by-default engine contract.
  assert.equal(policy.selection.requested_host, 'claude');
  assert.equal(policy.selection.requested_role_engine, 'claude');
  assert.equal(policy.selection.fallback.mode, 'deny');
  assert.deepEqual(policy.selection.fallback.allowed, []);

  if (!Object.prototype.hasOwnProperty.call(policy.selection, 'codex_worker_opt_in_roles')) {
    // U1/P4 default: no support role is opted into Codex, which is exactly the
    // configuration P4 certifies ("prove standalone mode with Codex unavailable").
    return;
  }
  // P5 generation configuration: exactly the two roles P5 drives, never a third. An
  // over-broad list would divert another support role away from claude-sendmessage.
  const optInRoles = policy.selection.codex_worker_opt_in_roles;
  assert.deepEqual([...optInRoles].sort(), [docsTarget, mixedTarget].sort(),
    `the P5 opt-in must be exactly the launcher's two P5 targets, saw [${optInRoles.join(', ')}]`
    + ' -- a missing role leaves ensure() with no codex-app-server worker for it and'
    + ' mixed-review-request fails CAPABILITY_UNAVAILABLE before publishing any intent');
  for (const role of optInRoles) {
    assert.ok(Array.isArray(routing.routes[role]) && routing.routes[role].includes('codex-app-server'),
      `${role} must be routed to codex-app-server for its opt-in to be selectable`);
  }
});

// Loads the SHIPPED classifyActivationFailure bytes out of the launcher and evaluates just
// that function, so this exercises the real diagnostic rather than a copy of it. The
// launcher is a script that spawns on load, so it cannot simply be required here.
function loadShippedActivationClassifier() {
  const source = fs.readFileSync(launcher, 'utf8');
  const start = source.indexOf('function classifyActivationFailure(');
  assert.notEqual(start, -1, 'the launcher must ship classifyActivationFailure');
  let depth = 0;
  let end = -1;
  for (let i = source.indexOf('{', start); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  assert.notEqual(end, -1, 'classifyActivationFailure must be brace-balanced');
  const context = { fs, path, Date, Number, Math, JSON, String };
  vm.createContext(context);
  vm.runInContext(`${source.slice(start, end)}; this.__fn = classifyActivationFailure;`, context);
  return context.__fn;
}

function writeActivationFixture(kind, overrides) {
  const root = fs.mkdtempSync(path.join(privateRoot, `cfc-act-${kind}-`));
  const request = {
    request_id: 'e53f0b00e2edf49872a9cae494bae8eec8e7810f9fbc32c68680da5ecd529133',
    target_role_profile_digest: 'a'.repeat(64),
    routing_policy_version: 'runtime-routing/v1',
    routing_policy_digest: 'b'.repeat(64),
  };
  if (overrides.request !== null) {
    fs.writeFileSync(path.join(root, 'request.json'), JSON.stringify(request));
  }
  if (overrides.activation !== null) {
    fs.mkdirSync(path.join(root, 'activations'));
    for (const [name, body] of Object.entries(overrides.activation)) {
      fs.writeFileSync(path.join(root, 'activations', name), JSON.stringify({ ...request, ...body }));
    }
  }
  return path.join(root, 'request.json');
}

test('CFC-ACT names the exact activation branch instead of one opaque reason', () => {
  // Live P6 regression: publish-result failed with "target activation did not resolve", a
  // single reason covering pending/decorrelated/expired/absent. The recorded artifacts showed
  // the real branch was expiry -- a 297s liveness window opened at 21:18:54Z, claim at
  // 21:19:00Z, and the target's turn still running at 21:25:09Z. Six minutes were lost to a
  // reason string that could not distinguish those cases.
  const classify = loadShippedActivationClassifier();

  // The live case, with its recorded window.
  const expired = classify(writeActivationFixture('expired', {
    activation: {
      'act.json': {
        created_at: '2026-09-09T21:18:54Z',
        activation_liveness_expiry: '2026-09-09T21:23:51Z',
      },
    },
  }));
  assert.equal(expired.branch, 'activation-expired');
  assert.equal(expired.liveness_window_seconds, 297);
  assert.ok(expired.overrun_seconds > 0);
  assert.equal(expired.activation_liveness_expiry, '2026-09-09T21:23:51Z');

  const live = classify(writeActivationFixture('live', {
    activation: {
      'act.json': {
        created_at: new Date(Date.now() - 1000).toISOString(),
        activation_liveness_expiry: new Date(Date.now() + 300000).toISOString(),
      },
    },
  }));
  assert.equal(live.branch, 'activation-live-but-rejected');
  assert.ok(live.remaining_seconds > 0);

  const decorrelated = classify(writeActivationFixture('decorrelated', {
    activation: {
      'act.json': {
        request_id: 'f'.repeat(64),
        created_at: new Date().toISOString(),
        activation_liveness_expiry: new Date(Date.now() + 300000).toISOString(),
      },
    },
  }));
  assert.equal(decorrelated.branch, 'activation-decorrelated');

  assert.equal(classify(writeActivationFixture('absent', { activation: null })).branch,
    'activation-absent');

  const unreadable = classify(writeActivationFixture('unreadable', {
    request: null, activation: null,
  }));
  assert.equal(unreadable.branch, 'request-unreadable');

  // Every branch must be distinguishable: an opaque single reason is what failed here.
  const branches = [expired.branch, live.branch, decorrelated.branch, 'activation-absent',
    unreadable.branch];
  assert.equal(new Set(branches).size, branches.length);
});

test('CFC-REJECTREASON keeps the reason a managed command or a P5 stage was refused for', () => {
  // Live P5 attempt N7 finally reached mixed-review-request, which exited 4 (UNAVAILABLE). The
  // evidence recorded that exit code and nothing else, and the launcher's own failure said only
  // "did not publish one correlated WAITING intent". The lifecycle CLI distinguishes seven
  // rejections there -- a self-review, a requester that is not Claude-native, an invalid target
  // topology, an unavailable retained bridge, an unavailable resolver, an unavailable retained
  // worker and an owner mismatch -- and each needs a different fix.
  const source = fs.readFileSync(launcher, 'utf8');

  // A failed managed command keeps a bounded, sanitized tail of what it printed.
  const recordAt = source.indexOf('function recordManagedCommand(');
  const record = source.slice(recordAt, source.indexOf('\nfunction ', recordAt + 1));
  assert.ok(/if \(result\.status !== 0\) \{/.test(record),
    'output must be kept only for a failure, leaving a healthy run\'s evidence unchanged');
  assert.ok(/record\.stderr_tail = stderrTail;/.test(record) && /record\.stdout_tail = stdoutTail;/.test(record),
    'both streams must be recorded when a managed command fails');

  const sanitizeAt = source.indexOf('function sanitizedCommandOutput(');
  assert.ok(sanitizeAt > 0, 'the launcher must sanitize what it records');
  const sanitize = source.slice(sanitizeAt, source.indexOf('\nfunction ', sanitizeAt + 1));
  for (const shape of ['bearer|basic', 'eyJ', 'ghp', 'api|access|secret', '{24,}']) {
    assert.ok(sanitize.includes(shape), 'missing redaction for ' + shape);
  }
  assert.ok(/\[\^\x20-\x7e\]/.test(sanitize), 'control characters must be stripped');
  assert.ok(/cleaned\.slice\(cleaned\.length - limit\)/.test(sanitize),
    'the cap must keep the end, where a refusal names its precondition');

  // The P5 stage failures carry the envelope's own command, ok, status and reason.
  const describeAt = source.indexOf('function describeLifecycleRejection(');
  assert.ok(describeAt > 0, 'the launcher must describe a lifecycle rejection');
  const describe = source.slice(describeAt, source.indexOf('\nfunction ', describeAt + 1));
  for (const field of ['command=', 'ok=', 'status=', 'reason=']) {
    assert.ok(describe.includes(field), 'missing field in the rejection description: ' + field);
  }
  assert.ok(describe.includes("' (no result envelope)'"),
    'a missing envelope must be reported as such, never as an empty reason');
  assert.ok(/describeLifecycleRejection\(result\)/.test(source.slice(source.indexOf('INVALID_P5_MIXED_REVIEW'))),
    'the mixed-review failure must carry it');
  assert.ok(/describeLifecycleRejection\(result\)/.test(source.slice(source.indexOf('INVALID_P5_DOCS_MCP'))),
    'the docs-consult failure must carry it');
});

test('CFC-REASONSURVIVES the sanitizer keeps a kebab-case refusal reason and still redacts real secrets', () => {
  // CFC-REJECTREASON above asserts that the redaction SHAPES exist -- it reads the source. That is
  // not the same as knowing what the sanitizer does to a real line, and the difference cost live
  // attempt N12 its cause: the lifecycle CLI printed
  //   [mixed-review-request] retained pair unresolved: <one of seven reasons>
  // and the recorded evidence read "<redacted>", because every one of those reasons is a
  // hyphenated identifier longer than the 24-character run the catch-all rule treats as a secret.
  // The whole diagnostic vocabulary this wave added is invisible in launcher evidence unless the
  // catch-all can tell an identifier from a credential. Run the REAL shipped function here, not a
  // description of it.
  const source = fs.readFileSync(launcher, 'utf8');
  const at = source.indexOf('function sanitizedCommandOutput(');
  assert.ok(at > 0, 'the launcher must sanitize what it records');
  const body = source.slice(at, source.indexOf('\nfunction ', at + 1));
  // eslint-disable-next-line no-new-func -- deliberately executes the shipped text, not a copy.
  const sanitize = new Function(body + '\nreturn sanitizedCommandOutput;')();

  for (const reason of [
    'mixed-review-self-review-rejected',
    'mixed-review-requester-not-claude-native',
    'root-consult-target-topology-invalid',
    'retained-bridge-unavailable',
    'retained-worker-resolver-unavailable',
    'root-consult-retained-worker-unavailable',
    'root-consult-retained-owner-mismatch',
  ]) {
    const line = '[mixed-review-request] retained pair unresolved: ' + reason;
    assert.strictEqual(sanitize(line), line, 'the refusal reason must survive sanitizing: ' + reason);
  }

  // And every credential shape is still removed -- a lowercase-and-hyphens exemption must not become
  // a hole. Each of these carries digits or uppercase, which no canonical reason does.
  for (const secret of [
    'Authorization: Bearer abc.def.ghi',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
    'ghp_0123456789abcdefghijklmnopqrstuvwxyz',
    'api_key = 0123456789abcdef0123456789abcdef',
    '0123456789abcdef0123456789abcdef0123456789abcdef',
    'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVowMTIzNDU2Nzg5',
  ]) {
    assert.ok(String(sanitize('leaked ' + secret)).includes('<redacted>'),
      'a credential shape must still be redacted: ' + secret);
  }
});

test('CFC-POLLBOUND polls until the relayed action expiry, not for a fixed number of tries', () => {
  // PLAN.md ~L136/L986: "Empty-action polling uses delays 1, 2, 4, 5 and 5 seconds and is bounded
  // by the maximum expires_at of the last relayed action set", and "Recheck init-session until
  // READY... Total polling is bounded by the existing request/operation expiry, not an invented
  // process timer." The launcher treated the ramp's LENGTH as the budget: five polls, 17 seconds
  // total. Live P5 attempts N5 and N6 both died there -- the relayed set's own expiry was more than
  // nine minutes away, and the Codex-backed supervisor start legitimately needs longer than 17
  // seconds to bring one real app-server worker up per role before init-session can report READY.
  const source = fs.readFileSync(launcher, 'utf8');
  const fnAt = source.indexOf('function scheduleEmptyActionPoll(');
  assert.ok(fnAt > 0, 'the empty-action poll scheduler must exist');
  const body = source.slice(fnAt, source.indexOf('\nfunction ', fnAt + 1));

  // The ramp stays exactly the PLAN's, and holds at its cap instead of running out.
  assert.ok(/const pollScheduleSeconds = \[1, 2, 4, 5, 5\];/.test(source),
    'the mandated 1/2/4/5/5 ramp must be unchanged');
  assert.ok(/pollScheduleSeconds\[Math\.min\(emptyPollCount, pollScheduleSeconds\.length - 1\)\]/.test(body),
    'the delay must hold at the 5-second cap rather than exhausting the ramp');
  // The budget is the relayed expiry.
  assert.ok(/Date\.now\(\) \+ \(delaySeconds \* 1000\) >= lastRelayedActionExpiryMs/.test(body),
    'polling must stop at the last relayed action set expiry');
  // ...and with no expiry known, the old bound still applies, so this can never poll unbounded.
  assert.ok(/lastRelayedActionExpiryMs === null/.test(body)
    && /emptyPollCount >= pollScheduleSeconds\.length/.test(body),
    'with no relayed expiry the ramp length must remain the bound');

  // The expiry is taken from the actions themselves, and an empty projection never clears it.
  const handlerAt = source.indexOf('function handleEntrypointEnvelope(');
  const handler = source.slice(handlerAt, source.indexOf('\nfunction ', handlerAt + 1));
  assert.ok(/Date\.parse\(action && action\.expires_at\)/.test(handler),
    'the bound must come from the relayed actions own expires_at');
  assert.ok(/if \(relayedExpiryMs > 0\) \{/.test(handler),
    'an action set with no parsable expiry must leave the previous bound in place');
  assert.ok(handler.indexOf('lastRelayedActionExpiryMs = relayedExpiryMs;')
    < handler.indexOf('return scheduleEmptyActionPoll(envelope.entrypoint);'),
    'the bound must be recorded before any poll is scheduled from the same envelope');
});

test('CFC-TEARDOWN attributes a role owner that outlives the teardown wait', () => {
  // Live P5 attempt N5 ended at P5_OWNED_CLEANUP_FAILED with nothing but
  // {"complete":false,"status":"live-owner-timeout","last":{"ok":true,"found":true,"role":"arch-platform"}}.
  // findExistingRoleOwner is a file-existence scan: "found" says a record is on disk, never whether
  // the supervisor that claimed it is alive. Those two cases need opposite fixes -- wait out a
  // supervisor still working through its bounded shutdown, or reap after one that died holding a
  // claim -- so the finalizer must say which one it saw.
  const source = fs.readFileSync(launcher, 'utf8');
  const finalizerAt = source.indexOf('function settleP5OwnedSupervisor()');
  assert.ok(finalizerAt > 0, 'the owned-teardown finalizer must exist');
  const body = source.slice(finalizerAt, source.indexOf('\nfunction ', finalizerAt + 1));

  assert.ok(/waited_ms: Date\.now\(\) - startedAt/.test(body),
    'both outcomes must report how long the wait actually took');
  assert.ok(/const owner = describeLingeringRoleOwner\(/.test(body)
    && /status: 'live-owner-timeout',[\s\S]{0,120}owner,/.test(body),
    'a timeout must attribute the record that outlived it, and return that attribution');
  assert.ok(/startedAt \+ 45_000/.test(body),
    'the wait itself must stay bounded at its existing 45s ceiling');

  const helperAt = source.indexOf('function describeLingeringRoleOwner(');
  assert.ok(helperAt > 0, 'the attribution helper must exist');
  const helperBody = source.slice(helperAt, source.indexOf('\nfunction ', helperAt + 1));
  // Read-only: this runs during a failure, and must not mutate what a later reader will inspect.
  for (const forbidden of ['unlinkSync', 'rmSync', 'writeFileSync', 'renameSync', 'process.kill']) {
    assert.ok(!helperBody.includes(forbidden),
      'the attribution must never call ' + forbidden);
  }
  // Every branch that cannot answer says so, rather than reporting a confident wrong answer.
  for (const detail of [
    'owner-role-unresolved', 'owner-record-unreadable', 'owner-record-vanished-while-reading',
    'owner-record-read-threw', 'supervisor-liveness-threw',
  ]) {
    assert.ok(helperBody.includes(detail), 'missing honest branch: ' + detail);
  }
  assert.ok(/classifyProcessIdentityLiveness\(record && record\.pid_identity\)/.test(helperBody),
    "liveness must be classified from the record's own pid identity");
  assert.ok(/'supervisor-' \+ liveness\.status\.toLowerCase\(\)/.test(helperBody),
    'the classified liveness must reach the reported detail');
});

test('CFC-SUP launches a re-projected supervisor-start once and waits instead of re-claiming it', async () => {
  // Live P5 regression: ensure() re-emitted the identical supervisor-start action id while
  // the codex bridge was still coming up. The conductor executed it a second time, which
  // re-minted its execution claim and failed execution-claim-already-issued after the first
  // claim's 112s window had already lapsed unconsumed. A second launch would also leave a
  // second detached bridge child behind.
  const run = await runP5Scenario('p5-full-scenario', {
    extraEnv: {
      P4_CERT_MANAGED_CONDUCTOR_OFFLINE: '1',
      P4_CERT_MANAGED_COMMAND_FAKE: fakeManagedCommand,
      P5_CERT_REPEAT_SUPERVISOR_START: '1',
    },
  });
  assert.equal(run.code, 0, `${run.stderr}\n${JSON.stringify(run.state.invalidation_reason)}`);
  // Exactly one launch for the one action id, however many times it is re-projected.
  const starts = run.state.managed_supervisor_starts || [];
  assert.equal(starts.length, 1, `re-projection must not launch a second bridge: ${JSON.stringify(starts)}`);
  assert.equal(new Set(starts.map((s) => s.action_id)).size, 1);
  // The re-projection is accounted for as a WAITING poll, not silently dropped.
  assert.ok((run.state.supervisor_start_inflight_polls || 0) >= 1,
    'the in-flight re-projection must be recorded as a bounded WAITING poll');
});

test('P4-FULL-SCENARIO rejects a failed monitor', async () => {
  const run = await runP4FullScenario('p4-monitor-fails');
  assert.notEqual(run.code, 0);
  assert.equal(run.state.status, 'INVALID_P4_SEQUENCE');
  assert.match(run.state.invalidation_reason, /monitor-docs\/COMPLETED.*saw monitor-docs\/FAILED/);
});

test('P4-FULL-SCENARIO rejects partial owned cleanup', async () => {
  const run = await runP4FullScenario('p4-cleanup-partial');
  assert.notEqual(run.code, 0);
  assert.equal(run.state.status, 'INVALID_P4_SEQUENCE');
  assert.match(run.state.invalidation_reason, /owned cleanup for role doc-updater did not reach a durable STOPPED state/);
  assert.equal(run.state.p4_cleanup.length, 4);
});

test('P4-FULL-SCENARIO rejects absent owned cleanup', async () => {
  const run = await runP4FullScenario('p4-cleanup-absent');
  assert.notEqual(run.code, 0);
  assert.equal(run.state.status, 'UNEXPECTED_EOF');
  assert.equal(run.state.p4_cleanup, undefined);
});

test('CFC-T transport handles chunking and fails closed on malformed, foreign-session, EOF, and abnormal exit', async () => {
  const chunked = await runScenario('chunked-success');
  const malformed = await runScenario('malformed-json');
  const wrongSession = await runScenario('wrong-session-frame');
  const eof = await runScenario('eof-after-turn-one');
  const abnormal = await runScenario('abnormal-exit');
  assert.equal(chunked.code, 0, chunked.stderr);
  assert.deepEqual(chunked.state.parse_errors, []);
  assert.notEqual(malformed.code, 0);
  assert.equal(malformed.state.status, 'INVALID_STREAM');
  assert.equal(malformed.state.parse_errors[0].reason, 'malformed-json');
  assert.notEqual(wrongSession.code, 0);
  assert.equal(wrongSession.state.status, 'INVALID_STREAM_SESSION');
  assert.notEqual(eof.code, 0);
  assert.equal(eof.state.status, 'UNEXPECTED_EOF');
  assert.equal(eof.state.writers_settled, true);
  assert.equal(abnormal.code, 23);
  assert.equal(abnormal.state.status, 'ABNORMAL_CHILD_EXIT');
  assert.equal(abnormal.state.writers_settled, true);
});

test('CFC-NT-01 a text-only Agent turn terminates cleanly without confirmation relay or accepted progress', async () => {
  const run = await runScenario('agent-no-tool-turn', {
    operation: 'entrypoint-protocol',
    transportProfile: 'native-claude-cli',
    nativeFixture: true,
  });
  assert.notEqual(run.code, 0);
  assert.equal(run.state.status, 'MODEL_DECLINED_ACTION_SET');
  assert.equal(run.state.agent_call_count, 0);
  assert.equal(run.state.agent_calls_exact, false);
  assert.deepEqual(run.state.pending_action_ids, [
    'fake-action-01', 'fake-action-02', 'fake-action-03', 'fake-action-04', 'fake-action-05',
  ]);
  assert.match(run.state.model_response_text_digest, /^[0-9a-f]{64}$/);
  assert.equal(run.state.stdin_closed_after_terminal, true);
  assert.equal(run.state.writers_settled, true);
  assert.equal(run.state.transcript_cleanup.complete, true);
  assert.equal(run.state.native_session_authority_retirement.complete, true);
  assert.equal(fs.readdirSync(run.evidenceRoot).some((name) => /^sequence-2-/.test(name)), false,
    'a no-tool model turn must not receive a confirmation or retry message');
});

test('CFC-NT-02 a partial Agent batch remains INVALID_AGENT_ACTIONS', async () => {
  const run = await runScenario('agent-missing-call');
  assert.notEqual(run.code, 0);
  assert.equal(run.state.status, 'INVALID_AGENT_ACTIONS');
  assert.equal(run.state.agent_call_count, 0);
});

test('CFC-PIN rejects observed effort drift before relaying an owning action set', async () => {
  const run = await runScenario('p4-effort-mismatch', {
    operation: 'entrypoint-protocol',
    transportProfile: 'native-claude-cli',
    nativeFixture: true,
  });
  assert.notEqual(run.code, 0);
  assert.equal(run.state.status, 'HOST_PIN_MISMATCH');
  assert.equal(run.state.effort_profile.requested, 'high');
  assert.equal(run.state.effort_profile.effective, 'high');
  assert.equal(run.state.effort_profile.control, '--effort');
  assert.equal(run.state.effort_profile.expected_observed, 'high');
  assert.equal(run.state.effort_profile.observed, 'max');
  assert.equal(run.state.action_relay_count, 0);
});

test('CFC-PIN accepts the exact --effort control when Claude emits no undocumented effort telemetry', async () => {
  const run = await runScenario('p4-effort-telemetry-absent', {
    operation: 'entrypoint-protocol',
    transportProfile: 'native-claude-cli',
    nativeFixture: true,
  });
  assert.equal(run.code, 0, run.stderr);
  const effortIndex = run.state.native_argv.indexOf('--effort');
  assert.notEqual(effortIndex, -1);
  assert.equal(run.state.native_argv[effortIndex + 1], 'high');
  assert.equal(run.state.effort_profile.effective, 'high');
  assert.equal(run.state.effort_profile.observed, null);
});

test('CFC-RELAY keeps bootstrap bytes out of the model proposal while requiring canonical observed execution', async () => {
  const run = await runScenario('success', {
    operation: 'entrypoint-protocol',
    transportProfile: 'native-claude-cli',
    nativeFixture: true,
  });
  assert.equal(run.code, 0, run.stderr);
  const relayName = fs.readdirSync(run.evidenceRoot).find((name) => /^sequence-1-.*\.jsonl$/.test(name));
  assert.ok(relayName);
  const relay = fs.readFileSync(path.join(run.evidenceRoot, relayName), 'utf8');
  assert.doesNotMatch(relay, /fake-bootstrap-/);
  assert.doesNotMatch(relay, /second-line-preserves-crlf/);
  assert.match(relay, /Use the canonical bootstrap derived by the production gate/);
  assert.equal(run.state.actions.every((action) => action.execution_input_exact === true), true);
  assert.equal(run.state.actions.every((action) => action.model_deviation === true), true);
});

test('CFC-O observation distinguishes absent, divergent, duplicate, foreign, and permuted evidence', async () => {
  const permuted = await runScenario('permuted-split');
  const wrongInput = await runScenario('wrong-executed-input');
  const missingStart = await runScenario('missing-start');
  const duplicateStart = await runScenario('duplicate-start');
  const wrongSession = await runScenario('wrong-observation-session');
  assert.equal(permuted.code, 0, permuted.stderr);
  assert.deepEqual(permuted.state.agent_action_order, [
    'arch-integration', 'arch-platform', 'arch-testing', 'context-provider', 'doc-updater',
  ]);
  assert.notEqual(wrongInput.code, 0);
  const divergent = wrongInput.state.actions.find((action) => action.execution_input_exact === false);
  assert.ok(divergent);
  assert.equal(divergent.evidence_method, 'POST_TOOL_INPUT');
  assert.notEqual(divergent.observed_input_digest, divergent.canonical_input_digest);
  assert.notEqual(missingStart.code, 0);
  assert.match(missingStart.state.invalidation_reason, /correlated start/);
  assert.notEqual(duplicateStart.code, 0);
  assert.match(duplicateStart.state.invalidation_reason, /duplicate SubagentStart/);
  assert.notEqual(wrongSession.code, 0);
  assert.match(wrongSession.state.invalidation_reason, /session/);
});

test('CFC-R readiness result cannot finalize before every proposal and start is present', async () => {
  const run = await runScenario('readiness-race');
  assert.equal(run.code, 0, run.stderr);
  assert.equal(run.state.status, 'PROTOCOL_COMPLETED');
  assert.equal(run.state.agent_call_count, 5);
  assert.equal(run.state.premature_result_ignored, 1);
});

test('CFC-C polling and completion distinguish waiting, exhaustion, partial result, and missing ACK', async () => {
  const options = { extraEnv: { P4_CERT_OFFLINE_POLL_SCALE_MS: '1' } };
  const polling = await runScenario('empty-action-polling', options);
  const exhausted = await runScenario('empty-action-exhausted', options);
  const partial = await runScenario('partial-result', options);
  const missingAck = await runScenario('completion-without-ack', options);
  assert.equal(polling.code, 0, polling.stderr);
  assert.equal(polling.state.status, 'PROTOCOL_COMPLETED');
  assert.deepEqual(polling.state.poll_delays_seconds, [1, 2]);
  assert.notEqual(exhausted.code, 0);
  assert.equal(exhausted.state.status, 'UNSTARTED_RETRY_EXHAUSTED');
  assert.deepEqual(exhausted.state.poll_delays_seconds, [1, 2, 4, 5, 5]);
  assert.notEqual(partial.code, 0);
  assert.equal(partial.state.status, 'INVALID_TERMINAL_RESULT');
  assert.notEqual(missingAck.code, 0);
  assert.equal(missingAck.state.status, 'INVALID_TERMINAL_RESULT');
});

test('offline fake proves validated init, exact first tool, five canonical Agent calls, 6-turn stdin, transcript, and clean shutdown', async () => {
  const run = await runScenario('success');
  assert.equal(run.code, 0, run.stderr);
  assert.equal(run.signal, null);
  assert.equal(run.state.execution_mode, 'OFFLINE_FAKE');
  assert.equal(run.state.host_identity_observation, 'system-init-stream');
  assert.equal(run.state.first_action_exact, true);
  assert.equal(run.state.sequence, 5);
  assert.equal(run.state.action_relay_count, 2);
  assert.equal(run.state.action_interrupt_count, 2,
    'each non-empty ACTION_REQUIRED turn must be closed before its relay is queued');
  assert.equal(run.state.action_interrupt_receipt_count, 2);
  assert.equal(run.state.action_relay_after_interrupt_result_count, 2);
  assert.equal(run.state.agent_calls_exact, true);
  assert.equal(run.state.agent_call_count, 5);
  assert.deepEqual(run.state.agent_action_order, [
    'arch-integration',
    'arch-platform',
    'arch-testing',
    'context-provider',
    'doc-updater',
  ]);
  assert.equal(run.state.status, 'PROTOCOL_COMPLETED');
  assert.equal(run.state.source_unchanged, true);
  const transcript = fs.readFileSync(run.state.transcript_path, 'utf8');
  assert.match(transcript, /"subtype":"init"/);
  assert.match(transcript, /"subtype":"fake_action_fanout_delivered"/);
  assert.match(transcript, /"subtype":"fake_sendmessage_delivered"/);
  assert.match(transcript, /"subtype":"fake_three_plus_turns_proven","received_turns":6/);
  for (let index = 0; index <= 5; index += 1) {
    const files = fs.readdirSync(run.state.run_root).filter((name) => name.startsWith(`sequence-${index}-`)
      || (index === 0 && name === 'sequence-0-input.jsonl'));
    assert.equal(files.length, 1, `missing unique sequence ${index}: ${JSON.stringify(files)}`);
  }
});

test('offline fake proves ACTION_REQUIRED interrupt receipt and terminal result precede the exact relay', async () => {
  const run = await runScenario('success');
  assert.equal(run.code, 0, run.stderr);
  const controls = fs.readdirSync(run.state.run_root)
    .filter((name) => /^control-\d+-action-relay-interrupt\.jsonl$/.test(name))
    .sort()
    .map((name) => JSON.parse(fs.readFileSync(path.join(run.state.run_root, name), 'utf8')));
  assert.equal(controls.length, 2);
  for (const frame of controls) {
    assert.equal(frame.type, 'control_request');
    assert.match(frame.request_id, /^p4-action-relay-interrupt-/);
    assert.deepEqual(frame.request, {
      subtype: 'interrupt',
      reason: 'workflow-abort',
      cancel_queued: false,
    });
  }
  assert.deepEqual(run.state.action_interrupts.map((entry) => entry.transition), [
    'ACTION_REQUIRED->INTERRUPT_RECEIPT->INTERRUPTED_RESULT->RELAY',
    'ACTION_REQUIRED->INTERRUPT_RECEIPT->INTERRUPTED_RESULT->RELAY',
  ]);
});

test('P5 conductor relays one supervisor-start action as its exact background Bash launch', async () => {
  const run = await runScenario('p5-supervisor-start-relay');
  assert.equal(run.code, 0, run.stderr);
  assert.equal(run.state.status, 'PROTOCOL_COMPLETED');
  assert.equal(run.state.supervisor_start_calls_exact, true);
  assert.equal(run.state.supervisor_start_call_count, 1);
  assert.deepEqual(run.state.supervisor_start_actions.map((item) => item.accepted), [true]);
});

test('P5 conductor settles one mixed Agent plus supervisor-start action set before re-entry', async () => {
  const run = await runScenario('p5-mixed-host-action-relay');
  assert.equal(run.code, 0, run.stderr);
  assert.equal(run.state.status, 'PROTOCOL_COMPLETED');
  assert.equal(run.state.agent_calls_exact, true);
  assert.equal(run.state.agent_call_count, 1);
  assert.equal(run.state.supervisor_start_calls_exact, true);
  assert.equal(run.state.supervisor_start_call_count, 1);
});

for (const scenario of [
  'p5-supervisor-start-command-mismatch',
  'p5-supervisor-start-foreground',
  'p5-supervisor-start-missing-observation',
]) {
  test(`P5 conductor fails closed for ${scenario}`, async () => {
    const run = await runScenario(scenario);
    assert.notEqual(run.code, 0);
    assert.equal(run.state.status, 'INVALID_SUPERVISOR_START_ACTIONS');
    assert.equal(run.state.supervisor_start_call_count || 0, 0);
  });
}

for (const [scenario, reason] of [
  ['p4-missing-interrupt-capability', /interrupt_receipt_v1/],
  ['p4-interrupt-foreign-receipt', /request_id/],
  ['p4-interrupt-malformed-receipt', /still_queued/],
  ['p4-interrupt-result-before-receipt', /before its correlated interrupt receipt/],
]) {
  test(`offline fake fails closed for ${scenario}`, async () => {
    const run = await runScenario(scenario);
    assert.notEqual(run.code, 0);
    assert.equal(run.state.status, 'INVALID_ACTION_INTERRUPT');
    assert.match(run.state.invalidation_reason, reason);
    assert.equal(run.state.action_relay_count, 0);
    assert.equal(run.state.agent_call_count, 0);
  });
}

// The old prefix/suffix/newline/name/background prompt-rejection matrix is
// superseded by PLAN 6.3/6.5 and folded into CFC-RED-01: uniquely owned input
// is canonicalized and the raw deviation remains visible. Only a wrong subtype
// or an incomplete call remains a denial in this transport-level group.
for (const scenario of ['agent-changed-subagent-type', 'agent-missing-call']) {
  test(`offline fake rejects ${scenario} with zero accepted Agent progress`, async () => {
    const run = await runScenario(scenario);
    assert.notEqual(run.code, 0);
    assert.equal(run.state.status, 'INVALID_AGENT_ACTIONS');
    assert.equal(run.state.agent_calls_exact, false);
    assert.equal(run.state.agent_call_count, 0);
    assert.match(run.state.invalidation_reason, /Agent/);
  });
}

test('offline fake proves system/init mismatch fails closed', async () => {
  const run = await runScenario('bad-init');
  assert.notEqual(run.code, 0);
  assert.equal(run.state.status, 'INVALID_SYSTEM_INIT_EVIDENCE');
  assert.equal(run.state.first_action_exact, undefined);
});

test('native entrypoint profile fails closed when system/init omits a canonical P4 Agent role', async () => {
  const run = await runScenario('p4-missing-native-agent', {
    operation: 'entrypoint-protocol',
    transportProfile: 'native-claude-cli',
    nativeFixture: true,
  });
  assert.notEqual(run.code, 0);
  assert.equal(run.state.status, 'INVALID_SYSTEM_INIT_EVIDENCE');
  assert.match(run.state.invalidation_reason, /canonical P4 Agent type/);
  assert.equal(run.state.first_action_exact, undefined);
});

test('offline fake proves a non-exact first tool call fails closed', async () => {
  const run = await runScenario('bad-first-tool');
  assert.notEqual(run.code, 0);
  assert.equal(run.state.status, 'INVALID_FIRST_ACTION');
  assert.equal(run.state.first_action_exact, undefined);
  assert.match(run.state.invalidation_reason, /first emitted tool call/);
});
