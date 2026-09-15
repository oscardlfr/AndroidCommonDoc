'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

const sessionId = argValue('--session-id');
const operation = argValue('--operation') || process.env.P4_CERT_FAKE_OPERATION || 'entrypoint-protocol';
const probeNonce = argValue('--probe-nonce') || process.env.P4_CERT_FAKE_PROBE_NONCE;
const scenario = process.env.P4_CERT_FAKE_SCENARIO || 'success';
const directRole = argValue('--agent');
// process.cwd() is realpath-resolved by the OS, exactly like the real CLI's
// reported cwd -- that fidelity is what makes the canonicalization fence real.
// The override exists only so a negative test can present a genuinely foreign
// cwd; it is never used to make a positive case pass.
const projectRoot = process.env.P4_CERT_TEST_FORCE_CHILD_CWD || process.cwd();
let turn = 0;
let awaitingActionInterrupt = false;
let deferredInterruptedResult = null;
const hostProbe = operation === 'host-contract-probe';
const p5Scenario = process.env.P5_CERT_FAKE_SCENARIO === '1';
const p6Scenario = process.env.P6_CERT_FAKE_SCENARIO === '1';
const nativeAgentDefinitions = (() => {
  const raw = argValue('--agents');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
})();
const declaredAgents = Object.keys(nativeAgentDefinitions);

function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeysDeep(value[key])]));
  }
  return value;
}

function digestString(value) {
  return crypto.createHash('sha256').update(Buffer.from(value, 'utf8')).digest('hex');
}

const workSubjectRef = process.env.P6_CERT_FAKE_SCENARIO === '1'
  ? 'subject:090b9779a46f94e328cb61bf5e78d5a64a15337a6e9279090837647a87f2ff7a'
  : `subject:${digestString(`p4-certification-work\0${sessionId}`)}`;

function digestObject(value) {
  return digestString(JSON.stringify(sortKeysDeep(value)));
}
// P4-U1 full-scenario names (positive + closed negative coverage): all share
// the identical turns 1-3 bootstrap below, diverging only from turn 4 onward
// inside handleP4Turn.
const P4_FULL_SCENARIOS = new Set([
  'p4-full-scenario',
  'p4-sendmessage-fails',
  'p4-second-ensure-spawns-again',
  'p4-resume-replaces-actor',
  'p4-ingest-approved-mismatch',
  'p4-monitor-fails',
  'p4-cleanup-partial',
  'p4-cleanup-absent',
  'p4-subagent-ready-result',
  'p4-root-extra-first-tool',
  'p4-root-second-tool-before-first-execution',
  'p4-root-concurrent-proposal-first-executes-canonical',
  'p4-root-minimal-profile',
  'p4-root-canonicalized-first-bash',
  'p4-inline-bootstrap-before-relay',
  'p4-native-sendmessage-schema',
  'p4-native-sendmessage-alias-mismatch',
]);

const observedAgentScenarios = new Set([
  'success',
  'p4-effort-telemetry-absent',
  'chunked-success',
  'five-role-split-deviation',
  'permuted-split',
  'wrong-executed-input',
  'missing-start',
  'duplicate-start',
  'wrong-observation-session',
  'readiness-race',
  'empty-action-polling',
  'empty-action-exhausted',
  'completion-without-ack',
  'partial-result',
  ...P4_FULL_SCENARIOS,
  'p5-full-scenario',
  'p6-managed-consumer',
]);

const agentActions = [
  { action_id: 'fake-action-01', kind: 'role-spawn', runtime: 'claude-native', operation: 'Agent', payload: { team_name: 'fake-team', agent_type: 'arch-integration', teammate_name: 'arch-integration', bootstrap_artifact_ref: 'bootstrap:01', bootstrap_message: 'fake-bootstrap-integration' } },
  { action_id: 'fake-action-02', kind: 'role-spawn', runtime: 'claude-native', operation: 'Agent', payload: { team_name: 'fake-team', agent_type: 'arch-platform', teammate_name: 'arch-platform', bootstrap_artifact_ref: 'bootstrap:02', bootstrap_message: 'fake-bootstrap-platform\r\nsecond-line-preserves-crlf' } },
  { action_id: 'fake-action-03', kind: 'role-spawn', runtime: 'claude-native', operation: 'Agent', payload: { team_name: 'fake-team', agent_type: 'arch-testing', teammate_name: 'arch-testing', bootstrap_artifact_ref: 'bootstrap:03', bootstrap_message: 'fake-bootstrap-testing-ñ' } },
  { action_id: 'fake-action-04', kind: 'role-spawn', runtime: 'claude-native', operation: 'Agent', payload: { team_name: 'fake-team', agent_type: 'context-provider', teammate_name: 'context-provider', bootstrap_artifact_ref: 'bootstrap:04', bootstrap_message: 'fake-bootstrap-context-provider' } },
  { action_id: 'fake-action-05', kind: 'role-spawn', runtime: 'claude-native', operation: 'Agent', payload: { team_name: 'fake-team', agent_type: 'doc-updater', teammate_name: 'doc-updater', bootstrap_artifact_ref: 'bootstrap:05', bootstrap_message: 'fake-bootstrap-doc-updater' } },
];

const AGENT_PROPOSAL_PROMPT = 'Use the canonical bootstrap derived by the production gate from the unique pending owning action.';

const supervisorStartAction = {
  action_id: 'fake-supervisor-start-action-01',
  kind: 'supervisor-start',
  runtime: 'host-process',
  operation: 'bash-tool-launch',
  role: null,
  payload: {
    bridge: 'codex-app-server',
    bridge_argv: ['fake-node', 'fake-runtime-bridge-codex', '--action', 'fake-supervisor-start-action-01'],
    bridge_command: "'fake-node' 'fake-runtime-bridge-codex' '--action' 'fake-supervisor-start-action-01'",
  },
};

function exactSupervisorStartInput() {
  return {
    command: supervisorStartAction.payload.bridge_command,
    run_in_background: true,
  };
}

function writeSupervisorStartObservation(input) {
  const evidenceRoot = process.env.P4_CERT_EVIDENCE_ROOT;
  if (!evidenceRoot) throw new Error('P4_CERT_EVIDENCE_ROOT is required for supervisor-start observation');
  const observerRoot = path.join(evidenceRoot, 'observer');
  fs.mkdirSync(observerRoot, { recursive: true });
  const rows = [
    { evidence_mode: 'fake-fixture', producer: 'fake-claude-functional-child', hook_event_name: 'PreToolUse', session_id: sessionId, tool_use_id: 'toolu_supervisor_start', tool_name: 'Bash', tool_input: input },
    { evidence_mode: 'fake-fixture', producer: 'fake-claude-functional-child', hook_event_name: 'PostToolUse', session_id: sessionId, tool_use_id: 'toolu_supervisor_start', tool_name: 'Bash', tool_input: input },
  ];
  const eventsPath = path.join(observerRoot, 'events.jsonl');
  fs.writeFileSync(eventsPath, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, {
    flag: fs.existsSync(eventsPath) ? 'a' : 'wx',
  });
}

const resumeActions = agentActions.map((action, index) => {
  const actionId = `${index + 11}`.padStart(32, '0');
  const handleId = `${index + 21}`.padStart(32, '0');
  const checkpointRef = `checkpoint:${digestString('p4-full-scenario-checkpoint-v1')}`;
  return {
    action_id: actionId,
    kind: 'role-notify',
    runtime: 'claude-native',
    operation: 'SendMessage',
    role: action.payload.agent_type,
    payload: {
      binding_id: `${index + 31}`.padStart(32, '0'),
      teammate_name: action.payload.teammate_name,
      artifact_ref: checkpointRef,
      artifact_kind: 'session-control',
      message: `Resume the parked actor for ${checkpointRef} using resume-handle:${handleId}; runtime-action:${actionId}.`,
    },
  };
});

// Genuine `work` returns the persisted root-source action envelope directly.
// Unlike support-plane role-spawn presentations, that durable action does not
// carry a launcher-only `operation` field; the driver must derive Agent from
// the closed kind/runtime mapping.
const ROOT_SOURCE_PUBLISH_COMMAND = "'fake-node' 'fake-runtime-consultation' 'publish-request'";
const ROOT_SOURCE_BOOTSTRAP = [
  'ROOT_SOURCE_BOOTSTRAP/v1',
  'plan_ref=fake-plan-ref',
  'subject_bundle_ref=fake-subject-bundle-ref',
  `publish_command=${ROOT_SOURCE_PUBLISH_COMMAND}`,
  'Execute publish_command exactly once as the first tool action.',
].join('\n');
const rootSourceAction = {
  action_id: 'fake-root-source-action-01',
  kind: 'root-source-spawn',
  runtime: 'claude-native',
  payload: {
    agent_type: 'toolkit-specialist',
    name: 'toolkit-specialist',
    bootstrap_message: ROOT_SOURCE_BOOTSTRAP,
  },
};

function exactRootSourceInput() {
  return {
    description: 'toolkit-specialist runtime bootstrap',
    subagent_type: 'toolkit-specialist',
    name: 'toolkit-specialist',
    prompt: ROOT_SOURCE_BOOTSTRAP,
    run_in_background: false,
  };
}

function proposedRootSourceInput() {
  return {
    ...exactRootSourceInput(),
    prompt: AGENT_PROPOSAL_PROMPT,
  };
}

function exactAgentInputs() {
  return agentActions.map((action) => ({
    description: `${action.payload.agent_type} runtime bootstrap`,
    subagent_type: action.payload.agent_type,
    name: action.payload.teammate_name,
    prompt: action.payload.bootstrap_message,
    run_in_background: true,
  }));
}

function proposedAgentInputs() {
  return exactAgentInputs().map((input) => ({
    ...input,
    prompt: AGENT_PROPOSAL_PROMPT,
  }));
}

function observedAgentInputs() {
  const inputs = proposedAgentInputs();
  if (scenario === 'agent-prefix') inputs[0].prompt = `PREFIX:${inputs[0].prompt}`;
  if (scenario === 'agent-suffix') inputs[0].prompt = `${inputs[0].prompt}:SUFFIX`;
  if (scenario === 'agent-newline-normalization') inputs[1].prompt = inputs[1].prompt.replaceAll('\r\n', '\n');
  if (scenario === 'agent-additional-explanation') inputs[2].prompt = `Please follow these instructions:\n${inputs[2].prompt}`;
  if (scenario === 'agent-reordered-roles') [inputs[0], inputs[1]] = [inputs[1], inputs[0]];
  if (scenario === 'agent-changed-bootstrap-byte') inputs[3].prompt = `${inputs[3].prompt.slice(0, -1)}X`;
  if (scenario === 'agent-changed-subagent-type') inputs[0].subagent_type = 'arch-platform';
  if (scenario === 'agent-changed-name') inputs[0].name = 'arch-platform';
  if (scenario === 'agent-changed-background') inputs[0].run_in_background = false;
  if (scenario === 'agent-missing-call') inputs.pop();
  return inputs;
}

function canonicalHostInputs() {
  return agentActions.map((action) => ({
    description: `${action.payload.agent_type} runtime bootstrap`,
    subagent_type: action.payload.agent_type,
    name: action.payload.teammate_name,
    prompt: action.payload.bootstrap_message,
    run_in_background: true,
  }));
}

function writeAgentObservations(rawInputs, canonicalInputs, options = {}) {
  const evidenceRoot = process.env.P4_CERT_EVIDENCE_ROOT;
  if (!evidenceRoot) throw new Error('P4_CERT_EVIDENCE_ROOT is required for observed Agent scenarios');
  const observerRoot = path.join(evidenceRoot, 'observer');
  fs.mkdirSync(observerRoot, { recursive: true });
  const rows = [];
  const transcriptRoot = process.env.P4_CERT_NATIVE_TRANSCRIPT_ROOT || null;
  if (transcriptRoot) {
    const sessionTranscript = path.join(transcriptRoot, `${sessionId}.jsonl`);
    fs.mkdirSync(path.dirname(sessionTranscript), { recursive: true });
    fs.writeFileSync(sessionTranscript, '{"transient":"p4-session"}\n', { flag: 'wx' });
    rows.push({
      evidence_mode: 'fake-fixture', producer: 'fake-claude-functional-child',
      hook_event_name: 'SessionStart', session_id: sessionId, transcript_path: sessionTranscript,
    });
  }
  for (let index = 0; index < canonicalInputs.length; index += 1) {
    const toolUseId = `toolu_${String(index + 1).padStart(2, '0')}`;
    const agentId = `agent_${String(index + 1).padStart(2, '0')}`;
    const observedSession = options.wrongSession ? 'foreign-session' : sessionId;
    const executedInput = options.wrongExecutedIndex === index
      ? { ...canonicalInputs[index], prompt: `${canonicalInputs[index].prompt}-executed-wrong` }
      : canonicalInputs[index];
    rows.push({ evidence_mode: 'fake-fixture', producer: 'fake-claude-functional-child', hook_event_name: 'PreToolUse', session_id: observedSession, tool_use_id: toolUseId, tool_name: 'Agent', tool_input: rawInputs[index], updated_input: canonicalInputs[index] });
    if (options.missingStartIndex !== index) {
      rows.push({ evidence_mode: 'fake-fixture', producer: 'fake-claude-functional-child', hook_event_name: 'SubagentStart', session_id: observedSession, agent_id: agentId, agent_type: canonicalInputs[index].name });
      if (options.duplicateStartIndex === index) {
        rows.push({ evidence_mode: 'fake-fixture', producer: 'fake-claude-functional-child', hook_event_name: 'SubagentStart', session_id: observedSession, agent_id: `${agentId}-duplicate`, agent_type: canonicalInputs[index].name });
      }
    }
    rows.push({ evidence_mode: 'fake-fixture', producer: 'fake-claude-functional-child', hook_event_name: 'PostToolUse', session_id: observedSession, tool_use_id: toolUseId, tool_name: 'Agent', tool_input: executedInput });
    if (transcriptRoot) {
      const agentTranscript = path.join(transcriptRoot, sessionId, 'subagents', `agent-${agentId}.jsonl`);
      fs.mkdirSync(path.dirname(agentTranscript), { recursive: true });
      fs.writeFileSync(agentTranscript, `{"transient":"${agentId}"}\n`, { flag: 'wx' });
      rows.push({
        evidence_mode: 'fake-fixture', producer: 'fake-claude-functional-child',
        hook_event_name: 'SubagentStop', session_id: observedSession,
        agent_id: agentId, agent_type: canonicalInputs[index].name,
        agent_transcript_path: agentTranscript,
      });
    }
  }
  const persistedRows = options.wrapRows
    ? rows.map((row) => ({
      schema: 'runtime/claude-entrypoint-observer-event/v1',
      evidence_mode: row.evidence_mode,
      producer: 'claude-entrypoint-observer',
      hook_event_name: row.hook_event_name,
      raw_event: row,
    }))
    : rows;
  fs.writeFileSync(path.join(observerRoot, 'events.jsonl'), `${persistedRows.map((row) => JSON.stringify(row)).join('\n')}\n`, { flag: 'wx' });
}

// P4-U1 negative coverage only (second-ensure-spawns-again/resume-replaces-
// actor): appends one extra SubagentStart row so the launcher's role-actor
// snapshot diff observes an unexpected/replacement actor for an owned role.
function appendObserverRow(row) {
  const evidenceRoot = process.env.P4_CERT_EVIDENCE_ROOT;
  const observerRoot = path.join(evidenceRoot, 'observer');
  fs.mkdirSync(observerRoot, { recursive: true });
  fs.appendFileSync(path.join(observerRoot, 'events.jsonl'), `${JSON.stringify(row)}\n`);
}

function writeHostProbeObservations() {
  const evidenceRoot = process.env.P4_CERT_EVIDENCE_ROOT;
  const manifest = JSON.parse(fs.readFileSync(path.join(evidenceRoot, 'probe-manifest.json'), 'utf8'));
  const a = manifest.actions['probe-peer-a'];
  const b = manifest.actions['probe-peer-b'];
  const observedSession = scenario === 'hcp-wrong-session' ? 'foreign-session' : sessionId;
  const evidenceMode = ['hcp-genuine-in-offline', 'hcp-transient-persistence-cleanup'].includes(scenario)
    ? 'genuine-pinned'
    : 'fake-fixture';
  const rows = [];
  let transientTranscripts = null;
  if (scenario === 'hcp-transient-persistence-cleanup') {
    const transcriptRoot = process.env.P4_CERT_NATIVE_TRANSCRIPT_ROOT;
    if (!transcriptRoot) throw new Error('P4_CERT_NATIVE_TRANSCRIPT_ROOT is required for cleanup simulation');
    transientTranscripts = {
      session: path.join(transcriptRoot, `${sessionId}.jsonl`),
      actor: path.join(transcriptRoot, sessionId, 'subagents', 'agent-agent-probe-a.jsonl'),
    };
    fs.mkdirSync(path.dirname(transientTranscripts.actor), { recursive: true });
    fs.writeFileSync(transientTranscripts.session, '{"transient":"session"}\n', { flag: 'wx' });
    fs.writeFileSync(transientTranscripts.actor, '{"transient":"actor"}\n', { flag: 'wx' });
  }
  function add(event, updatedInput = null) {
    rows.push({
      schema: 'runtime/claude-host-contract-probe-event/v1',
      evidence_mode: evidenceMode,
      producer: 'claude-host-contract-probe',
      hook_event_name: event.hook_event_name,
      session_digest: digestString(event.session_id),
      tool_use_digest: typeof event.tool_use_id === 'string' ? digestString(event.tool_use_id) : null,
      prompt_id_digest: typeof event.prompt_id === 'string' ? digestString(event.prompt_id) : null,
      agent_id_digest: typeof event.agent_id === 'string' ? digestString(event.agent_id) : null,
      agent_type: typeof event.agent_type === 'string' ? event.agent_type : null,
      tool_name: typeof event.tool_name === 'string' ? event.tool_name : null,
      tool_input_digest: event.tool_input === undefined ? null : digestObject(event.tool_input),
      updated_input_digest: updatedInput === null ? null : digestObject(updatedInput),
      raw_event: event,
      observed_at: new Date().toISOString(),
    });
  }
  const base = { session_id: observedSession };
  add({
    ...base,
    hook_event_name: 'SessionStart',
    source: 'startup',
    ...(transientTranscripts ? { transcript_path: transientTranscripts.session } : {}),
  });
  add({ ...base, hook_event_name: 'PreToolUse', tool_use_id: 'toolu-probe-a', tool_name: 'Agent', tool_input: a }, a);
  if (!['hcp-rung2-success', 'hcp-no-executed-input'].includes(scenario)) {
    const executedA = scenario === 'hcp-divergent-input' ? { ...a, prompt: `${a.prompt}-divergent` } : a;
    add({ ...base, hook_event_name: 'PostToolUse', tool_use_id: 'toolu-probe-a', tool_name: 'Agent', tool_input: executedA });
  }
  add({ ...base, hook_event_name: 'SubagentStart', agent_id: 'agent-probe-a', agent_type: 'probe-peer-a', prompt_id: 'prompt-probe-a' });
  add({ ...base, hook_event_name: 'PreToolUse', tool_use_id: 'toolu-read-a1', tool_name: 'Read', agent_id: 'agent-probe-a', tool_input: { file_path: path.join(evidenceRoot, scenario === 'hcp-no-executed-input' ? 'unknown-first.txt' : 'probe-a-one.txt') } });
  add({ ...base, hook_event_name: 'PreToolUse', tool_use_id: 'toolu-read-a2', tool_name: 'Read', agent_id: 'agent-probe-a', tool_input: { file_path: path.join(evidenceRoot, 'probe-a-two.txt') } });
  if (scenario !== 'hcp-missing-stop') {
    add({
      ...base,
      hook_event_name: 'SubagentStop',
      agent_id: 'agent-probe-a',
      agent_type: 'probe-peer-a',
      prompt_id: 'prompt-probe-a',
      ...(transientTranscripts ? { agent_transcript_path: transientTranscripts.actor } : {}),
    });
  }
  if (scenario !== 'hcp-missing-wake') {
    const wakeRecipient = scenario === 'hcp-wrong-wake-id' ? 'probe-peer-foreign' : 'probe-peer-a';
    add({ ...base, hook_event_name: 'PreToolUse', tool_use_id: 'toolu-wake-a', tool_name: 'SendMessage', tool_input: { to: wakeRecipient, summary: 'Resume probe actor with retained context', message: 'resume probe' } });
    add({
      ...base,
      hook_event_name: 'PostToolUse',
      tool_use_id: 'toolu-wake-a',
      tool_name: 'SendMessage',
      tool_input: { to: wakeRecipient, summary: 'Resume probe actor with retained context', message: 'resume probe' },
      tool_response: ['hcp-rejected-wake', 'hcp-rejected-wake-then-peer-b'].includes(scenario)
        ? { success: false, message: 'delivery rejected' }
        : { success: true, message: 'delivery accepted' },
    });
    if (!['hcp-rejected-wake', 'hcp-rejected-wake-then-peer-b'].includes(scenario)) {
      add({
        ...base,
        hook_event_name: 'SubagentStart',
        agent_id: scenario === 'hcp-resume-id-drift' ? 'agent-probe-a-replacement' : 'agent-probe-a',
        agent_type: 'probe-peer-a',
        prompt_id: 'prompt-probe-a',
      });
    }
  }
  add({
    ...base,
    hook_event_name: 'PreToolUse',
    tool_use_id: 'toolu-read-a3',
    tool_name: 'Read',
    agent_id: ['hcp-replacement-child', 'hcp-rejected-wake-then-peer-b'].includes(scenario)
      ? (scenario === 'hcp-rejected-wake-then-peer-b' ? 'agent-probe-b' : 'agent-probe-a-replacement')
      : 'agent-probe-a',
    tool_input: { file_path: path.join(evidenceRoot, scenario === 'hcp-missing-nonce' ? 'probe-after-wake.txt' : `${probeNonce}.txt`) },
  });
  if (!['hcp-missing-wake', 'hcp-rejected-wake', 'hcp-rejected-wake-then-peer-b'].includes(scenario)) {
    add({
      ...base,
      hook_event_name: 'SubagentStop',
      agent_id: scenario === 'hcp-resume-id-drift' ? 'agent-probe-a-replacement' : 'agent-probe-a',
      agent_type: 'probe-peer-a',
      prompt_id: 'prompt-probe-a',
      ...(transientTranscripts ? { agent_transcript_path: transientTranscripts.actor } : {}),
    });
  }
  add({
    ...base,
    hook_event_name: 'PreToolUse',
    tool_use_id: 'toolu-coordinator-read',
    tool_name: 'Read',
    tool_input: { file_path: evidenceRoot },
  });
  add({ ...base, hook_event_name: 'PreToolUse', tool_use_id: 'toolu-probe-b', tool_name: 'Agent', tool_input: b }, b);
  add({ ...base, hook_event_name: 'PostToolUse', tool_use_id: 'toolu-probe-b', tool_name: 'Agent', tool_input: b });
  add({ ...base, hook_event_name: 'SubagentStart', agent_id: scenario === 'hcp-peer-id-collision' ? 'agent-probe-a' : 'agent-probe-b', agent_type: 'probe-peer-b', prompt_id: 'prompt-probe-b' });
  add({
    ...base,
    hook_event_name: 'PreToolUse',
    tool_use_id: 'toolu-read-b1',
    tool_name: 'Read',
    agent_id: scenario === 'hcp-peer-id-collision' ? 'agent-probe-a' : 'agent-probe-b',
    tool_input: { file_path: path.join(evidenceRoot, 'probe-b-one.txt') },
  });
  const observerRoot = path.join(evidenceRoot, 'observer');
  fs.mkdirSync(observerRoot, { recursive: true });
  fs.writeFileSync(path.join(observerRoot, 'events.jsonl'), `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, { flag: 'wx' });
}

function emitRaw(value) {
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`, 'utf8');
  if (!['chunked-success', 'hcp-chunked-success'].includes(scenario)) {
    process.stdout.write(bytes);
    return;
  }
  const unicode = bytes.indexOf(Buffer.from('ñ', 'utf8'));
  const cuts = unicode >= 0 ? [Math.max(1, unicode + 1)] : [1, Math.min(7, bytes.length)];
  let offset = 0;
  for (const cut of cuts) {
    if (cut > offset && cut < bytes.length) {
      process.stdout.write(bytes.subarray(offset, cut));
      offset = cut;
    }
  }
  process.stdout.write(bytes.subarray(offset));
}

function emit(value) {
  if (value && value.type === 'assistant' && value.effort === undefined
      && scenario !== 'p4-effort-telemetry-absent') {
    value.effort = scenario === 'p4-effort-mismatch' ? 'max' : 'high';
  }
  if (value && value.type === 'result' && awaitingActionInterrupt) {
    deferredInterruptedResult = value;
    return;
  }
  emitRaw(value);
}

function envelope(entrypoint, status, actions = [], result = null, detailOverride = null) {
  return {
    schema: 'runtime/collaboration-entrypoint-result/v1',
    entrypoint,
    status,
    detail: detailOverride || `fake-${entrypoint}-${status.toLowerCase()}`,
    selection: {
      actual_host: 'claude', actual_model: 'claude-sonnet-5',
      actual_role_engine: 'claude', continuity: 'session-persistent',
      fallback_reason: null, fallback_used: false,
    },
    actions,
    result,
  };
}

// P4-U1 owned-cleanup-only: runtime-role-lifecycle.cjs's own
// coordination/lifecycle-cli-result/v1 schema (distinct from the
// collaboration-entrypoint-result/v1 envelope() above).
function lifecycleCliResult(command, status, detailCode, actions) {
  return {
    schema: 'coordination/lifecycle-cli-result/v1',
    command,
    ok: status === 'STOPPED',
    status,
    code: status === 'STOPPED' ? 0 : 4,
    detail_code: detailCode,
    bindings: [],
    actions,
    operation: null,
  };
}

function p5LifecycleResult(command, status, operationRecord) {
  return {
    schema: 'coordination/lifecycle-cli-result/v1',
    command,
    ok: true,
    status,
    code: 0,
    detail_code: 'NONE',
    bindings: [],
    actions: [],
    operation: operationRecord,
  };
}

const P5_MIXED_INTENT_ID = '11111111111111111111111111111111';
const P5_DOCS_INTENT_ID = '22222222222222222222222222222222';
function p5WaitingOperation(kind, intentId) {
  return {
    kind, operation_id: intentId, state: 'WAITING',
    request_id: kind === 'mixed-review-request'
      ? '33333333333333333333333333333333'
      : '44444444444444444444444444444444',
    request_ref: null, request_digest: null, result_ref: null, result_digest: null,
    accepted_result_ref: null, accepted_result_digest: null,
    ack_ref: null, ack_digest: null, cancel_ref: null, cancel_digest: null,
  };
}

function p5ReadyDocsOperation() {
  return {
    ...p5WaitingOperation('root-consult', P5_DOCS_INTENT_ID), state: 'READY',
    result_ref: 'result:p5-docs', result_digest: digestString('p5-docs-result'),
    accepted_result_ref: 'accepted-result:p5-docs', accepted_result_digest: digestString('p5-docs-accepted'),
    ack_ref: 'ack:p5-docs', ack_digest: digestString('p5-docs-ack'),
  };
}

function handleP5Turn(turn, text) {
  const command = text.trim().split(/\r?\n/).at(-1);
  emit({
    type: 'assistant', session_id: sessionId,
    message: { content: [{ type: 'tool_use', id: `fake-tool-${turn}`, name: 'Bash', input: { command } }] },
  });
  if (turn === 4) {
    if (!command.includes("'mixed-review-request'") || !command.includes("'--subject-text-file'")) process.exit(97);
    toolResult(p5LifecycleResult(
      'mixed-review-request', 'WAITING', p5WaitingOperation('mixed-review-request', P5_MIXED_INTENT_ID),
    ), 0);
  } else if (turn === 5) {
    if (!command.includes("'consult-root'")) process.exit(97);
    toolResult(p5LifecycleResult(
      'consult-root', 'WAITING', p5WaitingOperation('root-consult', P5_DOCS_INTENT_ID),
    ), 0);
  } else if (turn === 6) {
    if (!command.includes("'consult-root-status'") || !command.includes(P5_DOCS_INTENT_ID)) process.exit(97);
    if (scenario === 'p5-docs-incomplete') {
      toolResult({
        ...p5LifecycleResult('consult-root-status', 'FAILED', null),
        ok: false, code: 7, detail_code: 'INTERNAL_ERROR',
      }, 7);
    } else {
      toolResult(p5LifecycleResult('consult-root-status', 'READY', p5ReadyDocsOperation()), 0);
    }
  } else {
    process.exit(97);
  }
  emit({ type: 'result', subtype: 'success', session_id: sessionId });
}

function stopOwnedActionFor(role) {
  return {
    schema: 'runtime/role-lifecycle-action/v2',
    action_id: digestString(`p4-stop-owned:${role}:${sessionId}`),
    kind: 'role-stop-owned',
    runtime: 'claude-native',
    repo_id: digestString('p4-full-scenario-repo'),
    worktree_id: digestString('p4-full-scenario-worktree'),
    plan_digest: digestString('p4-full-scenario-plan'),
    policy_digest: digestString('p4-full-scenario-policy'),
    session_generation_id: digestString(`p4-full-scenario-generation:${sessionId}`),
    role,
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    payload: { kind: 'role-stop-owned', role, reason: 'session-close', instruction: 'Stop your owned role binding and exit cleanly.' },
  };
}

function extractFlagValue(command, flag) {
  const match = new RegExp(`'${flag}'\\s+'([^']*)'`).exec(command);
  return match ? match[1] : null;
}

function ingestApprovedResult(mismatch) {
  const requestRef = process.env.P4_CERT_FAKE_INGEST_REQUEST_REF;
  const approvalRef = process.env.P4_CERT_FAKE_INGEST_APPROVAL_REF;
  const usedApprovalRef = mismatch ? `approval:${digestString('p4-full-scenario-wrong-approval')}` : approvalRef;
  return {
    request_ref: requestRef,
    request_digest: requestRef.slice('request:'.length),
    approval_ref: usedApprovalRef,
    approval_digest: usedApprovalRef.slice('approval:'.length),
    result_ref: 'fake/p4-full-scenario/ingestion-result.json',
    result_digest: digestString(`${requestRef}:${approvalRef}:result`),
    disposition: 'written',
    audit_status: 'ok',
  };
}

function monitorResult() {
  return {
    observations: [{ path: 'docs/example.md', status: 'reviewed' }],
    proposals: [],
  };
}

// P4-U1 full-scenario turns 4+ (turns 1-3 -- bootstrap -- are the identical,
// unmodified generic ladder below). One deterministic same-session
// continuation: idempotent second ensure, resume, work, denied+approved
// ingestion, monitor, five owned stop-owned cleanups.
function handleP4Turn(turn, text) {
  const command = text.trim().split(/\r?\n/).at(-1);
  const emitBash = () => emit({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', id: `fake-tool-${turn}`, name: 'Bash', input: { command } }] },
    session_id: sessionId,
  });
  const emitSendMessageDelivery = (recipient, content, success = true, index = 0) => {
    const toolUseId = `fake-sendmessage-${turn}-${index}`;
    const nativeInput = {
      to: recipient,
      summary: `Deliver validated runtime message to ${recipient}`,
      message: content,
    };
    if (['p4-native-sendmessage-schema', 'p4-native-sendmessage-alias-mismatch'].includes(scenario)) {
      nativeInput.type = 'message';
      nativeInput.recipient = scenario === 'p4-native-sendmessage-alias-mismatch' && index === 0
        ? 'foreign-recipient'
        : recipient;
      nativeInput.content = content.length > 50 ? `${content.slice(0, 50)}…` : content;
    }
    emit({
      type: 'assistant',
      message: { content: [{
        type: 'tool_use', id: toolUseId, name: 'SendMessage',
        input: nativeInput,
      }] },
      session_id: sessionId,
    });
    emit({
      type: 'user',
      message: { role: 'user', content: [{
        type: 'tool_result',
        content: [{ type: 'text', text: JSON.stringify({ success, message: success ? 'Delivered' : 'Rejected' }) }],
        is_error: !success,
        tool_use_id: toolUseId,
      }] },
      session_id: sessionId,
    });
  };
  const emitOk = () => emit({ type: 'result', subtype: 'success', session_id: sessionId });

  if (turn === 4) {
    if (scenario === 'p4-second-ensure-spawns-again') {
      appendObserverRow({
        evidence_mode: 'fake-fixture', producer: 'fake-claude-functional-child',
        hook_event_name: 'SubagentStart', session_id: sessionId,
        agent_id: 'agent_second_ensure_extra', agent_type: agentActions[0].payload.agent_type,
      });
    }
    emitBash();
    toolResult(envelope('init-session', 'READY', []), 0);
    emitOk();
    return;
  }
  if (turn === 5) {
    emitBash();
    toolResult(envelope('resume-work', 'ACTION_REQUIRED', resumeActions), 4);
    emitOk();
    return;
  }
  if (turn === 6) {
    if (!text.includes('Canonical SendMessage input array (JSON):') || !text.includes('Expected operation set: SendMessage.')) process.exit(92);
    for (let index = 0; index < resumeActions.length; index += 1) {
      const action = resumeActions[index];
      emitSendMessageDelivery(action.payload.teammate_name, action.payload.message, true, index);
      appendObserverRow({
        evidence_mode: 'fake-fixture', producer: 'fake-claude-functional-child',
        hook_event_name: 'SubagentStart', session_id: sessionId,
        agent_id: scenario === 'p4-resume-replaces-actor' && index === 0
          ? 'agent_resume_replacement'
          : `agent_${String(index + 1).padStart(2, '0')}`,
        agent_type: action.role,
      });
    }
    emitOk();
    return;
  }
  if (turn === 7) {
    if (scenario === 'p4-resume-replaces-actor') {
      // The replacement observation was emitted by the preceding real
      // SendMessage relay, where the divergence actually occurs.
    }
    emitBash();
    toolResult(envelope('resume-work', 'READY', []), 0);
    emitOk();
    return;
  }
  if (turn === 8) {
    emitBash();
    toolResult(envelope('work', 'ACTION_REQUIRED', [rootSourceAction]), 4);
    emitOk();
    return;
  }
  if (turn === 9) {
    const canonical = exactRootSourceInput();
    const proposal = proposedRootSourceInput();
    if (!text.includes(JSON.stringify([proposal])) || !text.includes('Expected operation set: Agent.')) process.exit(92);
    if (text.includes(ROOT_SOURCE_BOOTSTRAP)) process.exit(93);
    const toolkitProfile = nativeAgentDefinitions['toolkit-specialist'] || {};
    const profileWouldInviteDefinitionRead = typeof toolkitProfile.prompt === 'string'
      && /bound to|\.claude[\\/]agents[\\/]toolkit-specialist\.md/i.test(toolkitProfile.prompt);
    const rawEventRows = [
      { evidence_mode: 'fake-fixture', producer: 'fake-claude-functional-child', hook_event_name: 'PreToolUse', session_id: sessionId, tool_use_id: 'toolu_root_source', tool_name: 'Agent', tool_input: proposal, updated_input: canonical },
      { evidence_mode: 'fake-fixture', producer: 'fake-claude-functional-child', hook_event_name: 'SubagentStart', session_id: sessionId, agent_id: 'agent_root_source_01', agent_type: 'toolkit-specialist' },
      { evidence_mode: 'fake-fixture', producer: 'fake-claude-functional-child', hook_event_name: 'PostToolUse', session_id: sessionId, tool_use_id: 'toolu_root_source', tool_name: 'Agent', tool_input: canonical },
    ];
    for (const row of rawEventRows) appendObserverRow(row);
    emit({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', id: 'toolu_root_source', name: 'Agent', input: proposal }] },
      session_id: sessionId,
    });
    emit({
      type: 'assistant',
      parent_tool_use_id: 'toolu_root_source',
      subagent_type: 'toolkit-specialist',
      message: { content: [{
        type: 'tool_use',
        id: 'toolu_root_nested_first',
        name: 'Bash',
        input: {
          command: scenario === 'p4-root-extra-first-tool'
            || scenario === 'p4-root-second-tool-before-first-execution'
            || scenario === 'p4-root-concurrent-proposal-first-executes-canonical'
            ? 'echo diagnostic-first'
            : scenario === 'p4-root-canonicalized-first-bash'
              ? "printf '%s' 'opaque-intent' | base64 -d; echo"
            : scenario === 'p4-root-minimal-profile' && profileWouldInviteDefinitionRead
              ? 'cat ".claude/agents/toolkit-specialist.md"'
              : ROOT_SOURCE_PUBLISH_COMMAND,
        },
      }] },
      session_id: sessionId,
    });
    if (scenario === 'p4-root-second-tool-before-first-execution') {
      emit({
        type: 'assistant',
        parent_tool_use_id: 'toolu_root_source',
        subagent_type: 'toolkit-specialist',
        message: { content: [{
          type: 'tool_use',
          id: 'toolu_root_nested_second_before_first_execution',
          name: 'SendMessage',
          input: { to: 'arch-platform', summary: 'invalid early relay', message: 'invalid early relay' },
        }] },
        session_id: sessionId,
      });
      emitOk();
      return;
    }
    if (scenario === 'p4-root-concurrent-proposal-first-executes-canonical') {
      emit({
        type: 'assistant',
        parent_tool_use_id: 'toolu_root_source',
        subagent_type: 'toolkit-specialist',
        message: { content: [{
          type: 'tool_use',
          id: 'toolu_root_nested_concurrent_denied',
          name: 'Bash',
          input: { command: 'echo concurrent-denied-proposal' },
        }] },
        session_id: sessionId,
      });
      setTimeout(() => {
        appendObserverRow({
          evidence_mode: 'fake-fixture',
          producer: 'fake-claude-functional-child',
          hook_event_name: 'PostToolUse',
          session_id: sessionId,
          agent_id: 'agent_root_source_01',
          agent_type: 'toolkit-specialist',
          tool_use_id: 'toolu_root_nested_first',
          tool_name: 'Bash',
          tool_input: { command: ROOT_SOURCE_PUBLISH_COMMAND },
        });
        emit({
          type: 'assistant',
          parent_tool_use_id: 'toolu_root_source',
          subagent_type: 'toolkit-specialist',
          message: { content: [{
            type: 'tool_use',
            id: 'toolu_root_nested_sendmessage',
            name: 'SendMessage',
            input: { to: 'arch-platform', summary: 'Deliver validated runtime message to arch-platform', message: 'fake correlated consult relay' },
          }] },
          session_id: sessionId,
        });
        emitOk();
      }, 75);
      return;
    }
    if (scenario !== 'p4-root-extra-first-tool'
        && !(scenario === 'p4-root-minimal-profile' && profileWouldInviteDefinitionRead)) {
      appendObserverRow({
        evidence_mode: 'fake-fixture',
        producer: 'fake-claude-functional-child',
        hook_event_name: 'PostToolUse',
        session_id: sessionId,
        agent_id: 'agent_root_source_01',
        agent_type: 'toolkit-specialist',
        tool_use_id: 'toolu_root_nested_first',
        tool_name: 'Bash',
        tool_input: {
          command: scenario === 'p4-root-canonicalized-first-bash'
            ? `${ROOT_SOURCE_PUBLISH_COMMAND} '--requester-binding' 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'`
            : ROOT_SOURCE_PUBLISH_COMMAND,
        },
      });
    }
    if (scenario !== 'p4-root-extra-first-tool') {
      emit({
        type: 'assistant',
        parent_tool_use_id: 'toolu_root_source',
        subagent_type: 'toolkit-specialist',
        message: { content: [{
          type: 'tool_use',
          id: 'toolu_root_nested_sendmessage',
          name: 'SendMessage',
          input: { to: 'arch-platform', summary: 'Deliver validated runtime message to arch-platform', message: 'fake correlated consult relay' },
        }] },
        session_id: sessionId,
      });
    }
    emitOk();
    return;
  }
  if (turn === 10) {
    emitBash();
    toolResult(envelope('work', 'COMPLETED', [], {
      result_ref: `transactions/${'1'.repeat(64)}/results/${'2'.repeat(32)}.json`,
      result_digest: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      accepted_result_ref: `transactions/${'1'.repeat(64)}/accepted-result.json`,
      accepted_result_digest: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      ack_ref: `transactions/${'1'.repeat(64)}/ack.json`,
      ack_digest: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    }), 0);
    emitOk();
    return;
  }
  if (turn === 11) {
    emitBash();
    toolResult(envelope('ingest-content', 'BLOCKED', [], null, 'approval-required'), 5);
    emitOk();
    return;
  }
  if (turn === 12) {
    emitBash();
    toolResult(envelope('ingest-content', 'ACTION_REQUIRED', [
      { operation: 'SendMessage', payload: { teammate_name: 'doc-updater', message: 'fake-ingestion-message' } },
    ], null, 'ingestion-action-required'), 4);
    emitOk();
    return;
  }
  if (turn === 13) {
    if (!text.includes('Canonical SendMessage input array (JSON):') || !text.includes('Expected operation set: SendMessage.')) process.exit(92);
    emitSendMessageDelivery('doc-updater', 'fake-ingestion-message', scenario !== 'p4-sendmessage-fails');
    emitOk();
    return;
  }
  if (turn === 14) {
    emitBash();
    toolResult(envelope('ingest-content', 'COMPLETED', [], ingestApprovedResult(scenario === 'p4-ingest-approved-mismatch'), 'ingestion-completed'), 0);
    emitOk();
    return;
  }
  if (turn === 15) {
    emitBash();
    if (scenario === 'p4-monitor-fails') {
      toolResult(envelope('monitor-docs', 'FAILED', [], null, 'monitoring-failed'), 7);
    } else {
      toolResult(envelope('monitor-docs', 'COMPLETED', [], monitorResult(), 'monitoring-completed'), 0);
    }
    emitOk();
    return;
  }
  const cleanupIndex = turn - 16;
  if (cleanupIndex >= 0 && cleanupIndex < 5) {
    if (scenario === 'p4-cleanup-absent') {
      process.exit(0);
      return;
    }
    const role = extractFlagValue(command, '--role');
    emitBash();
    const shouldFailLastRole = scenario === 'p4-cleanup-partial' && cleanupIndex === 4;
    if (shouldFailLastRole) {
      toolResult(lifecycleCliResult('stop-owned', 'UNAVAILABLE', 'CAPABILITY_UNAVAILABLE', []), 4);
    } else {
      toolResult(lifecycleCliResult('stop-owned', 'STOPPED', 'NONE', [stopOwnedActionFor(role)]), 0);
    }
    emitOk();
    return;
  }
  process.exit(93);
}

function toolResult(value, exitCode) {
  emit({
    type: 'user',
    message: { role: 'user', content: [{
      type: 'tool_result',
      content: `Exit code ${exitCode}\n${JSON.stringify(value)}`,
      is_error: exitCode !== 0,
      tool_use_id: `fake-tool-${turn}`,
    }] },
    session_id: sessionId,
  });
  if (value && value.status === 'ACTION_REQUIRED'
      && Array.isArray(value.actions) && value.actions.length > 0) {
    awaitingActionInterrupt = true;
  }
}

if (scenario === 'five-role-split-deviation' || scenario === 'hcp-stderr') {
  process.stderr.write('fake stderr sentinel\n');
}

let directMcpServers = [];
if (directRole && argValue('--mcp-config')) {
  try {
    directMcpServers = Object.keys(JSON.parse(argValue('--mcp-config')).mcpServers || {})
      .sort().map((name) => ({ name }));
  } catch {
    process.exit(97);
  }
}
if (scenario === 'direct-role-mcp-missing' && directRole === 'doc-updater') {
  directMcpServers = [];
}
// A direct role that receives a run-scoped MCP server records the toolkit root its MCP
// child would actually resolve, so a test can prove the launcher pins it instead of
// inheriting whatever ANDROID_COMMON_DOC happens to be set in the ambient shell.
if (directRole && argValue('--mcp-config') && process.env.P4_CERT_EVIDENCE_ROOT) {
  fs.writeFileSync(
    path.join(process.env.P4_CERT_EVIDENCE_ROOT, `direct-role-mcp-env-${directRole}.json`),
    `${JSON.stringify({
      role: directRole,
      android_common_doc: process.env.ANDROID_COMMON_DOC || null,
    })}\n`,
  );
}
const initEvent = {
  type: 'system', subtype: 'init', cwd: projectRoot, session_id: sessionId,
  tools: directRole
    ? [...String(argValue('--tools') || '').split(',').filter(Boolean),
      ...(scenario === 'direct-role-forbidden-tool' ? ['Agent'] : [])]
    : (scenario === 'bad-init' ? ['Bash'] : ['Task', 'Bash', 'SendMessage', 'Read', ...(hostProbe ? ['Glob'] : [])]),
  mcp_servers: directRole ? directMcpServers
    : ((scenario === 'five-role-split-deviation' || hostProbe) ? [{ name: 'docs' }] : []),
  model: scenario === 'bad-init' ? '' : ((scenario === 'five-role-split-deviation' || hostProbe) ? 'fake-model-literal' : 'claude-sonnet-5'),
  permissionMode: 'bypassPermissions', claude_code_version: hostProbe ? '2.1.261' : '2.1.219',
  agents: directRole ? [directRole]
    : (scenario === 'p4-missing-native-agent' ? declaredAgents.slice(1) : declaredAgents),
  capabilities: scenario === 'p4-missing-interrupt-capability'
    ? []
    : ['interrupt_receipt_v1', 'interrupt_cancel_queued_v1', 'msg_lifecycle_v1'],
};
if (!(directRole && scenario === 'direct-role-init-after-input')) emit(initEvent);
if (scenario === 'wrong-session-frame' || scenario === 'hcp-wrong-session') {
  emit({ type: 'system', subtype: 'foreign-session-frame', session_id: 'foreign-session' });
}
if (scenario === 'malformed-json' || scenario === 'hcp-malformed-json') {
  process.stdout.write('{"malformed"\n');
}

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on('line', (line) => {
  if (!line.trim()) return;
  const message = JSON.parse(line);
  if (message.type === 'control_request') {
    if (!awaitingActionInterrupt) process.exit(96);
    const terminal = deferredInterruptedResult || {
      type: 'result', subtype: 'error_during_execution', is_error: true, session_id: sessionId,
    };
    deferredInterruptedResult = null;
    if (scenario === 'p4-interrupt-result-before-receipt') {
      awaitingActionInterrupt = false;
      emitRaw(terminal);
      return;
    }
    const requestId = scenario === 'p4-interrupt-foreign-receipt'
      ? `${message.request_id}-foreign`
      : message.request_id;
    const responsePayload = scenario === 'p4-interrupt-malformed-receipt'
      ? {}
      : { still_queued: [] };
    awaitingActionInterrupt = false;
    emitRaw({
      type: 'control_response',
      response: { subtype: 'success', request_id: requestId, response: responsePayload },
    });
    emitRaw(terminal);
    return;
  }
  const text = message.message.content[0].text;
  turn += 1;
  emit({ type: 'system', subtype: 'fake_turn_received', turn, session_id: sessionId });

  if (directRole) {
    if (scenario === 'direct-role-init-after-input' && turn === 1) emit(initEvent);
    if (turn > 1) {
      emit(scenario === 'direct-role-init-drift'
        ? { ...initEvent, tools: [...initEvent.tools, 'SendMessage'] }
        : initEvent);
    }
    if (scenario === 'direct-role-exits-before-ready') process.exit(0);
    const replayedMessage = scenario === 'direct-role-changed-echo'
      ? { ...message.message, content: [{ type: 'text', text: `${text}-changed` }] }
      : message.message;
    emit({ type: 'user', session_id: sessionId, message: replayedMessage });
    if (text.startsWith('Please acknowledge that you are ready to receive a repository task.')) {
      emit({ type: 'assistant', session_id: sessionId, message: { content:
        scenario === 'direct-role-activation-tool'
          ? [{ type: 'tool_use', id: `direct-role-activation-tool-${turn}`,
            name: 'Bash', input: { command: 'echo unexpected-activation-tool' } }]
          : [{ type: 'text', text: 'Ready to receive a repository task.' }],
      } });
    } else if (text.startsWith('COORDINATION_CONSULT/v1\n')
        && scenario !== 'direct-role-empty-semantic-result') {
      emit({ type: 'assistant', session_id: sessionId, message: { content: [{
        type: 'text', text: 'Offline fixture architecture result: the bounded request is coherent and requires no repository mutation.',
      }] } });
    }
    let command = null;
    if (text.startsWith('FIRST Bash=')) {
      const end = text.indexOf(';require');
      if (end > 'FIRST Bash='.length) command = text.slice('FIRST Bash='.length, end);
    } else if (text.startsWith('ROOT_SOURCE_BOOTSTRAP/v1')) {
      const line = text.split(/\r?\n/).find((item) => item.startsWith('publish_command='));
      if (line) command = line.slice('publish_command='.length);
    }
    if (scenario === 'direct-role-wrong-first-tool' && command !== null) command = `${command} --changed`;
    if (command !== null) {
      emit({ type: 'assistant', session_id: sessionId, message: { content: [{
        type: 'tool_use', id: `direct-role-tool-${turn}`, name: 'Bash', input: { command },
      }] } });
      emit({ type: 'user', session_id: sessionId, message: { role: 'user', content: [{
        type: 'tool_result', tool_use_id: `direct-role-tool-${turn}`,
        content: JSON.stringify({ ok: true, status: 'READY' }), is_error: false,
      }] } });
    }
    emit({ type: 'result', subtype: 'success', is_error: false, session_id: sessionId });
    if (scenario === 'direct-role-duplicate-result'
        && (command !== null || text.startsWith('COORDINATION_CONSULT/v1\n'))) {
      emit({ type: 'result', subtype: 'success', is_error: false, session_id: sessionId });
    }
    return;
  }

  if (hostProbe) {
    writeHostProbeObservations();
    emit({ type: 'system', subtype: 'fake_host_probe_complete', session_id: sessionId });
    emit({ type: 'result', subtype: 'success', session_id: sessionId });
    return;
  }

  if (scenario === 'abnormal-exit') process.exit(23);

  if (process.env.P4_CERT_MANAGED_CONDUCTOR_OFFLINE === '1') {
    if (text.includes('Open this fresh no-persistence test conversation') && text.includes('READY_FOR_FIRST_STEP')) {
      if (scenario === 'managed-model-bash') {
        emit({ type: 'assistant', session_id: sessionId, message: { content: [{
          type: 'tool_use', id: 'toolu_forbidden_managed_bash', name: 'Bash',
          input: { command: 'echo model-owned-host-command' },
        }] } });
        emit({ type: 'result', subtype: 'success', session_id: sessionId });
        return;
      }
      emit({ type: 'assistant', session_id: sessionId, message: { content: [{ type: 'text', text: 'managed-stream-ready' }] } });
      emit({ type: 'result', subtype: 'success', session_id: sessionId });
      return;
    }
    const pendingPath = path.join(process.env.P4_CERT_EVIDENCE_ROOT, 'managed-pending-action-set.json');
    const pendingEnvelope = JSON.parse(fs.readFileSync(pendingPath, 'utf8'));
    const actions = pendingEnvelope.actions;
    const canonical = actions.map((action) => ({
      description: `${action.payload.agent_type} runtime bootstrap`,
      subagent_type: action.payload.agent_type,
      name: action.kind === 'root-source-spawn' ? action.payload.name : action.payload.teammate_name,
      prompt: action.payload.bootstrap_message,
      run_in_background: action.kind === 'role-spawn',
    }));
    const proposed = canonical.map((input) => ({ ...input, prompt: AGENT_PROPOSAL_PROMPT }));
    if (actions.length > 0 && actions.every((action) => action.operation === 'SendMessage')) {
      const inputs = actions.map((action) => ({
        to: action.payload.teammate_name,
        summary: `Deliver validated runtime message to ${action.payload.teammate_name}`,
        message: action.payload.message,
      }));
      // A correlated resume is the unique five-role SendMessage fan-out and is
      // evidenced by the same actor identities becoming active again. Key this
      // to the action set rather than the transport turn number: the managed
      // stream activation frame is allowed to shift turn indexes.
      const supportRoles = new Set(agentActions.map((action) => action.payload.agent_type));
      const resumedRoles = new Set(actions.map((action) => action.role));
      const isSupportRoleResume = actions.length === agentActions.length
        && resumedRoles.size === supportRoles.size
        && [...resumedRoles].every((role) => supportRoles.has(role));
      if (isSupportRoleResume) {
        for (let index = 0; index < actions.length; index += 1) {
          appendObserverRow({
            evidence_mode: 'fake-fixture', producer: 'fake-claude-functional-child',
            hook_event_name: 'SubagentStart', session_id: sessionId,
            agent_id: `agent_${String(index + 1).padStart(2, '0')}`,
            agent_type: actions[index].role,
          });
        }
      }
      emit({ type: 'assistant', session_id: sessionId, message: { content: inputs.map((input, index) => ({
        type: 'tool_use', id: `toolu_managed_message_${turn}_${index}`, name: 'SendMessage', input,
      })) } });
      emit({ type: 'system', subtype: 'fake_sendmessage_delivered', session_id: sessionId });
      emit({ type: 'result', subtype: 'success', session_id: sessionId });
      return;
    }
    if (actions.length > 0 && actions.every((action) => action.kind === 'role-spawn')) {
      writeAgentObservations(proposed, canonical);
      emit({
        type: 'assistant', session_id: sessionId,
        message: { content: proposed.map((input, index) => ({
          type: 'tool_use', id: `toolu_${String(index + 1).padStart(2, '0')}`, name: 'Agent', input,
        })) },
      });
      emit({ type: 'result', subtype: 'success', session_id: sessionId });
      return;
    }
    if (actions.length === 1 && actions[0].kind === 'root-source-spawn') {
      const action = actions[0];
      const input = proposed[0];
      const executed = canonical[0];
      const publishCommand = action.payload.bootstrap_message.split(/\r?\n/)
        .find((line) => line.startsWith('publish_command=')).slice('publish_command='.length);
      for (const row of [
        { evidence_mode: 'fake-fixture', producer: 'fake-claude-functional-child', hook_event_name: 'PreToolUse', session_id: sessionId, tool_use_id: 'toolu_root_source', tool_name: 'Agent', tool_input: input, updated_input: executed },
        { evidence_mode: 'fake-fixture', producer: 'fake-claude-functional-child', hook_event_name: 'SubagentStart', session_id: sessionId, agent_id: 'agent_root_source_01', agent_type: 'toolkit-specialist' },
        { evidence_mode: 'fake-fixture', producer: 'fake-claude-functional-child', hook_event_name: 'PostToolUse', session_id: sessionId, tool_use_id: 'toolu_root_source', tool_name: 'Agent', tool_input: executed },
        { evidence_mode: 'fake-fixture', producer: 'fake-claude-functional-child', hook_event_name: 'PostToolUse', session_id: sessionId, agent_id: 'agent_root_source_01', agent_type: 'toolkit-specialist', tool_use_id: 'toolu_root_nested_first', tool_name: 'Bash', tool_input: { command: publishCommand } },
      ]) appendObserverRow(row);
      emit({ type: 'assistant', session_id: sessionId, message: { content: [
        { type: 'tool_use', id: 'toolu_root_source', name: 'Agent', input },
      ] } });
      emit({ type: 'assistant', session_id: sessionId, parent_tool_use_id: 'toolu_root_source', subagent_type: 'toolkit-specialist', message: { content: [
        { type: 'tool_use', id: 'toolu_root_nested_first', name: 'Bash', input: { command: publishCommand } },
        { type: 'tool_use', id: 'toolu_root_nested_sendmessage', name: 'SendMessage', input: { to: 'arch-platform', summary: 'Deliver validated runtime message to arch-platform', message: 'fake correlated consult relay' } },
      ] } });
      emit({ type: 'result', subtype: 'success', session_id: sessionId });
      return;
    }
    process.exit(97);
    return;
  }

  if (turn === 1) {
    const command = scenario === 'bad-first-tool'
      ? 'echo wrong-first-tool'
      : text.trim().split(/\r?\n/).at(-1);
    if (p6Scenario) {
      const readToolUseId = 'fake-p6-preflight-read';
      emit({ type: 'assistant', message: { content: [{
        type: 'tool_use', id: readToolUseId, name: 'Read',
        input: { file_path: path.join(projectRoot, 'skills', 'init-session', 'SKILL.md') },
      }] }, session_id: sessionId });
      emit({ type: 'user', message: { content: [{
        type: 'tool_result', tool_use_id: readToolUseId,
        content: 'Canonical runtime entrypoint documentation inspected.',
      }] }, session_id: sessionId });
    }
    emit({ type: 'assistant', message: { content: [{
      type: 'tool_use', id: 'fake-tool-1', name: 'Bash', input: { command },
    }] }, session_id: sessionId });
    if (scenario === 'bad-init' || scenario === 'bad-first-tool') return;
    toolResult(envelope('init-session', 'ACTION_REQUIRED',
      p5Scenario
        ? [agentActions[0], agentActions[2], agentActions[4], supervisorStartAction]
      : scenario === 'p5-mixed-host-action-relay'
        ? [agentActions[0], supervisorStartAction]
        : (scenario.startsWith('p5-supervisor-start-') ? [supervisorStartAction] : agentActions)), 4);
    if (scenario === 'p4-inline-bootstrap-before-relay') {
      const inputs = observedAgentInputs();
      writeAgentObservations(inputs, canonicalHostInputs());
      emit({
        type: 'assistant',
        message: {
          id: 'fake-inline-agent-batch',
          content: inputs.map((agentInput, index) => ({
            type: 'tool_use',
            id: `toolu_${String(index + 1).padStart(2, '0')}`,
            name: 'Agent',
            input: { description: `Bootstrap ${agentInput.name}`, ...agentInput },
          })),
        },
        session_id: sessionId,
      });
      // Reproduce native stream-json ordering: the driver has already queued
      // its relay, so the per-query result is not emitted until that queued
      // message becomes active. The relay must not cause a second Agent batch.
      return;
    }
    emit({ type: 'result', subtype: 'success', session_id: sessionId });
    if (scenario === 'eof-after-turn-one') process.exit(0);
    return;
  }

  if (turn === 2) {
    if (p5Scenario) {
      const selectedActions = [agentActions[0], agentActions[2], agentActions[4]];
      const selectedInputs = selectedActions.map((action) => ({
        description: `${action.payload.agent_type} runtime bootstrap`,
        subagent_type: action.payload.agent_type,
        name: action.payload.teammate_name,
        prompt: AGENT_PROPOSAL_PROMPT,
        run_in_background: true,
      }));
      const canonicalInputs = selectedActions.map((action) => ({
        description: `${action.payload.agent_type} runtime bootstrap`,
        subagent_type: action.payload.agent_type,
        name: action.payload.teammate_name,
        prompt: action.payload.bootstrap_message,
        run_in_background: true,
      }));
      const supervisorInput = exactSupervisorStartInput();
      if (!text.includes(JSON.stringify(selectedInputs))
          || !text.includes(JSON.stringify([supervisorInput]))
          || !text.includes('Expected operation set: Agent,Bash.')) process.exit(91);
      writeAgentObservations(selectedInputs, canonicalInputs);
      writeSupervisorStartObservation(supervisorInput);
      emit({
        type: 'assistant', session_id: sessionId,
        message: { content: [
          ...selectedInputs.map((agentInput, index) => ({
            type: 'tool_use', id: `toolu_${String(index + 1).padStart(2, '0')}`, name: 'Agent', input: agentInput,
          })),
          { type: 'tool_use', id: 'toolu_supervisor_start', name: 'Bash', input: supervisorInput },
        ] },
      });
      emit({ type: 'result', subtype: 'success', session_id: sessionId });
      return;
    }
    if (scenario === 'p5-mixed-host-action-relay') {
      const agentInput = observedAgentInputs()[0];
      const canonicalAgent = canonicalHostInputs()[0];
      const supervisorInput = exactSupervisorStartInput();
      if (!text.includes(JSON.stringify(proposedAgentInputs().slice(0, 1)))
          || !text.includes(JSON.stringify([supervisorInput]))
          || !text.includes('Expected operation set: Agent,Bash.')) process.exit(91);
      writeAgentObservations([agentInput], [canonicalAgent]);
      writeSupervisorStartObservation(supervisorInput);
      emit({
        type: 'assistant',
        message: { content: [
          { type: 'tool_use', id: 'toolu_01', name: 'Agent', input: { description: `Bootstrap ${agentInput.name}`, ...agentInput } },
          { type: 'tool_use', id: 'toolu_supervisor_start', name: 'Bash', input: supervisorInput },
        ] },
        session_id: sessionId,
      });
      emit({ type: 'result', subtype: 'success', session_id: sessionId });
      return;
    }
    if (scenario.startsWith('p5-supervisor-start-')) {
      const expectedInput = exactSupervisorStartInput();
      if (scenario === 'p5-supervisor-start-command-mismatch') {
        expectedInput.command = `${expectedInput.command} '--foreign'`;
      }
      if (scenario === 'p5-supervisor-start-foreground') {
        expectedInput.run_in_background = false;
      }
      if (!text.includes(JSON.stringify([expectedInput]))
          && scenario === 'p5-supervisor-start-relay') process.exit(91);
      if (scenario !== 'p5-supervisor-start-missing-observation') {
        writeSupervisorStartObservation(expectedInput);
      }
      emit({
        type: 'assistant',
        message: { content: [{
          type: 'tool_use', id: 'toolu_supervisor_start', name: 'Bash', input: expectedInput,
        }] },
        session_id: sessionId,
      });
      emit({ type: 'result', subtype: 'success', session_id: sessionId });
      return;
    }
    if (!text.includes(JSON.stringify(proposedAgentInputs())) || !text.includes('Expected operation set: Agent.')) process.exit(91);
    if (text.includes('fake-bootstrap-')) process.exit(92);
    if (scenario === 'agent-no-tool-turn') {
      emit({
        type: 'assistant',
        message: { id: 'fake-agent-declined', content: [{ type: 'text', text: 'I need confirmation before executing this action set.' }] },
        session_id: sessionId,
      });
      emit({ type: 'result', subtype: 'success', session_id: sessionId });
      return;
    }
    if (scenario === 'p4-inline-bootstrap-before-relay') {
      if (!text.includes('Each action_id is at-most-once for this session')
          || !text.includes('make no tool call and end this turn')) process.exit(95);
      emit({ type: 'result', subtype: 'success', session_id: sessionId });
      return;
    }
    if (scenario === 'p4-subagent-ready-result') {
      // Native Agent streams the child Bash result through the root
      // JSONL channel. This is lifecycle evidence for the spawned role, not the
      // launcher's later root-level stop-owned cleanup result.
      toolResult(lifecycleCliResult('ready', 'READY', 'NONE', []), 0);
    }
    if (scenario === 'five-role-split-deviation') {
      const canonicalInputs = canonicalHostInputs();
      const rawInputs = canonicalInputs.map((input) => ({ ...input }));
      rawInputs[0].prompt = `PREFIX:${rawInputs[0].prompt}:SUFFIX\nmodel explanation`;
      rawInputs[1].prompt = rawInputs[1].prompt.replaceAll('\r\n', '\n');
      delete rawInputs[2].name;
      delete rawInputs[2].run_in_background;
      rawInputs[3].name = 'model-authored-name';
      rawInputs[3].prompt = `${rawInputs[3].prompt.slice(0, -1)}X`;
      rawInputs[3].description = 'model-authored description';
      rawInputs[3].run_in_background = false;
      writeAgentObservations(rawInputs, canonicalInputs);
      emit({ type: 'assistant', message: { id: 'fake-agent-batch-a', content: rawInputs.slice(0, 3).map((agentInput, index) => ({ type: 'tool_use', id: `toolu_${String(index + 1).padStart(2, '0')}`, name: 'Agent', input: agentInput })) }, session_id: sessionId });
      emit({ type: 'assistant', message: { id: 'fake-agent-batch-b', content: rawInputs.slice(3).map((agentInput, index) => ({ type: 'tool_use', id: `toolu_${String(index + 4).padStart(2, '0')}`, name: 'Agent', input: agentInput })) }, session_id: sessionId });
      emit({ type: 'system', subtype: 'fake_action_fanout_delivered', count: rawInputs.length, session_id: sessionId });
      emit({ type: 'result', subtype: 'success', session_id: sessionId });
      return;
    }
    const inputs = observedAgentInputs();
    let emittedInputs = inputs;
    let observedInputs = canonicalHostInputs();
    if (scenario === 'permuted-split') {
      const order = [4, 0, 2, 1, 3];
      emittedInputs = order.map((index) => inputs[index]);
      observedInputs = order.map((index) => canonicalHostInputs()[index]);
    }
    if (observedAgentScenarios.has(scenario)) {
      writeAgentObservations(emittedInputs, observedInputs, {
        wrongExecutedIndex: scenario === 'wrong-executed-input' ? 0 : -1,
        missingStartIndex: scenario === 'missing-start' ? 0 : -1,
        duplicateStartIndex: scenario === 'duplicate-start' ? 0 : -1,
        wrongSession: scenario === 'wrong-observation-session',
        wrapRows: scenario === 'p4-subagent-ready-result',
      });
    }
    if (scenario === 'readiness-race') {
      emit({ type: 'assistant', message: { id: 'fake-agent-race-a', content: emittedInputs.slice(0, 3).map((agentInput, index) => ({ type: 'tool_use', id: `toolu_${String(index + 1).padStart(2, '0')}`, name: 'Agent', input: agentInput })) }, session_id: sessionId });
      emit({ type: 'result', subtype: 'success', session_id: sessionId });
      // Force the continuation onto a later I/O turn. Without this delay the
      // OS often coalesces all four frames into one pipe chunk, making a
      // setImmediate-based readiness race pass by accident.
      setTimeout(() => {
        emit({ type: 'assistant', message: { id: 'fake-agent-race-b', content: emittedInputs.slice(3).map((agentInput, index) => ({ type: 'tool_use', id: `toolu_${String(index + 4).padStart(2, '0')}`, name: 'Agent', input: agentInput })) }, session_id: sessionId });
        emit({ type: 'result', subtype: 'success', session_id: sessionId });
      }, 50);
      return;
    }
    if (scenario === 'permuted-split') {
      emit({ type: 'assistant', message: { id: 'fake-agent-permuted-a', content: emittedInputs.slice(0, 2).map((agentInput, index) => ({ type: 'tool_use', id: `toolu_${String(index + 1).padStart(2, '0')}`, name: 'Agent', input: agentInput })) }, session_id: sessionId });
      emit({ type: 'assistant', message: { id: 'fake-agent-permuted-b', content: emittedInputs.slice(2).map((agentInput, index) => ({ type: 'tool_use', id: `toolu_${String(index + 3).padStart(2, '0')}`, name: 'Agent', input: agentInput })) }, session_id: sessionId });
      emit({ type: 'result', subtype: 'success', session_id: sessionId });
      return;
    }
    emit({
      type: 'assistant',
      message: {
        id: 'fake-agent-batch',
        content: inputs.map((agentInput, index) => ({
          type: 'tool_use',
          id: `toolu_${String(index + 1).padStart(2, '0')}`,
          name: 'Agent',
          input: { description: `Bootstrap ${agentInput.name}`, ...agentInput },
        })),
      },
      session_id: sessionId,
    });
    emit({ type: 'system', subtype: 'fake_action_fanout_delivered', count: inputs.length, session_id: sessionId });
    emit({ type: 'result', subtype: 'success', session_id: sessionId });
    return;
  }

  if (turn === 3) {
    const command = text.trim().split(/\r?\n/).at(-1);
    emit({ type: 'assistant', message: { content: [{
      type: 'tool_use', id: 'fake-tool-3', name: 'Bash', input: { command },
    }] }, session_id: sessionId });
    toolResult(envelope('init-session', 'READY'), 0);
    emit({ type: 'result', subtype: 'success', session_id: sessionId });
    return;
  }

  if (p5Scenario && turn >= 4) {
    handleP5Turn(turn, text);
    return;
  }

  if (P4_FULL_SCENARIOS.has(scenario) && turn >= 4) {
    handleP4Turn(turn, text);
    return;
  }

  if (scenario === 'empty-action-exhausted' && turn >= 4) {
    const command = text.trim().split(/\r?\n/).at(-1);
    emit({ type: 'assistant', message: { content: [{
      type: 'tool_use', id: `fake-tool-${turn}`, name: 'Bash', input: { command },
    }] }, session_id: sessionId });
    toolResult(envelope('work', 'ACTION_REQUIRED', []), 4);
    emit({ type: 'result', subtype: 'success', session_id: sessionId });
    return;
  }

  if (turn === 4) {
    const command = text.trim().split(/\r?\n/).at(-1);
    emit({ type: 'assistant', message: { content: [{
      type: 'tool_use', id: 'fake-tool-4', name: 'Bash', input: { command },
    }] }, session_id: sessionId });
    if (scenario === 'empty-action-polling' || scenario === 'empty-action-exhausted') {
      toolResult(envelope('work', 'ACTION_REQUIRED', []), 4);
      emit({ type: 'result', subtype: 'success', session_id: sessionId });
      return;
    }
    if (scenario === 'completion-without-ack') {
      toolResult(envelope('work', 'COMPLETED', [], {
        result_ref: `transactions/${'1'.repeat(64)}/results/${'2'.repeat(32)}.json`,
        result_digest: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        accepted_result_ref: `transactions/${'1'.repeat(64)}/accepted-result.json`,
        accepted_result_digest: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      }), 0);
      emit({ type: 'result', subtype: 'success', session_id: sessionId });
      return;
    }
    if (scenario === 'partial-result') {
      toolResult(envelope('work', 'COMPLETED', [], { role: 'toolkit-specialist' }), 0);
      emit({ type: 'result', subtype: 'success', session_id: sessionId });
      return;
    }
    toolResult(envelope('work', 'ACTION_REQUIRED', [
      { operation: 'SendMessage', payload: { teammate_name: 'toolkit-specialist', message: 'fake-work-message' } },
    ]), 4);
    emit({ type: 'result', subtype: 'success', session_id: sessionId });
    return;
  }

  if (turn === 5) {
    if (scenario === 'empty-action-polling' || scenario === 'empty-action-exhausted') {
      toolResult(envelope('work', 'ACTION_REQUIRED', []), 4);
      emit({ type: 'result', subtype: 'success', session_id: sessionId });
      return;
    }
    if (!text.includes('Canonical SendMessage input array (JSON):') || !text.includes('Expected operation set: SendMessage.')) process.exit(92);
    emit({ type: 'system', subtype: 'fake_sendmessage_delivered', count: 1, session_id: sessionId });
    emit({ type: 'result', subtype: 'success', session_id: sessionId });
    return;
  }

  if (turn === 6) {
    if (scenario === 'empty-action-polling') {
      toolResult(envelope('work', 'COMPLETED', [], {
        result_ref: `transactions/${'1'.repeat(64)}/results/${'2'.repeat(32)}.json`,
        result_digest: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        accepted_result_ref: `transactions/${'1'.repeat(64)}/accepted-result.json`,
        accepted_result_digest: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        ack_ref: `transactions/${'1'.repeat(64)}/ack.json`,
        ack_digest: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      }), 0);
      emit({ type: 'result', subtype: 'success', session_id: sessionId });
      return;
    }
    if (scenario === 'empty-action-exhausted') {
      toolResult(envelope('work', 'ACTION_REQUIRED', []), 4);
      emit({ type: 'result', subtype: 'success', session_id: sessionId });
      return;
    }
    toolResult(envelope('work', 'COMPLETED', [], {
      result_ref: `transactions/${'1'.repeat(64)}/results/${'2'.repeat(32)}.json`,
      result_digest: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      accepted_result_ref: `transactions/${'1'.repeat(64)}/accepted-result.json`,
      accepted_result_digest: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      ack_ref: `transactions/${'1'.repeat(64)}/ack.json`,
      ack_digest: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    }), 0);
    emit({ type: 'system', subtype: 'fake_three_plus_turns_proven', received_turns: turn, session_id: sessionId });
    emit({ type: 'result', subtype: 'success', session_id: sessionId });
    return;
  }

  process.exit(93);
});

input.on('close', () => {
  if (directRole && scenario === 'direct-role-orphan') {
    setInterval(() => {}, 1000);
    return;
  }
  process.exit(directRole
    ? (turn >= 1 ? 0 : 94)
    : process.env.P4_CERT_MANAGED_CONDUCTOR_OFFLINE === '1'
      ? (turn >= 1 ? 0 : 94)
      : hostProbe
        ? (turn >= 1 ? 0 : 94)
        : (P4_FULL_SCENARIOS.has(scenario) ? (turn >= 16 ? 0 : 94) : (turn >= 6 ? 0 : 94)));
});
