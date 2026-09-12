'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function arg(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

const runRoot = path.resolve(arg('--run-root'));
const name = arg('--name');
const kind = arg('--kind');
const role = arg('--role');
const sessionId = arg('--session-id');
const scenario = arg('--scenario');
const statePath = path.join(runRoot, 'fake-managed-command-state.json');
let state = { counts: {} };
try { state = JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch {}
state.counts[name] = (state.counts[name] || 0) + 1;
fs.writeFileSync(statePath, `${JSON.stringify(state)}\n`);

function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeysDeep(value[key])]));
  }
  return value;
}

if (kind === 'entrypoint') {
  const encoded = arg('--intent');
  try {
    const bytes = Buffer.from(encoded, 'base64url');
    const text = bytes.toString('utf8');
    if (bytes.toString('base64url') !== encoded || JSON.stringify(sortKeysDeep(JSON.parse(text))) !== text) {
      throw new Error('noncanonical-intent');
    }
  } catch {
    process.stderr.write('fake managed entrypoint received a noncanonical intent\n');
    process.exit(65);
  }
}

const agentActions = ['arch-integration', 'arch-platform', 'arch-testing', 'context-provider', 'doc-updater']
  .map((role, index) => ({
    action_id: `fake-action-0${index + 1}`,
    kind: 'role-spawn', runtime: 'claude-native', operation: 'Agent',
    payload: {
      team_name: 'fake-team', agent_type: role, teammate_name: role,
      bootstrap_artifact_ref: `bootstrap:0${index + 1}`,
      bootstrap_message: `FIRST Bash='fake-node' 'fake-runtime-role-lifecycle' 'ready' '--action' 'fake-action-0${index + 1}';require READY else report/stop;WAIT.\nROLE=${role}`,
    },
  }));
const rootAction = {
  action_id: 'fake-root-source-action-01', kind: 'root-source-spawn', runtime: 'claude-native',
  payload: {
    agent_type: 'toolkit-specialist', name: 'toolkit-specialist',
    bootstrap_message: [
      'ROOT_SOURCE_BOOTSTRAP/v1', 'plan_ref=fake-plan-ref',
      'subject_bundle_ref=fake-subject-bundle-ref',
      "publish_command='fake-node' 'fake-runtime-consultation' 'publish-request'",
      'Execute publish_command exactly once as the first tool action.',
    ].join('\n'),
  },
};
const supervisorStartAction = {
  action_id: 'fake-supervisor-start-action-01', kind: 'supervisor-start',
  runtime: 'host-process', operation: 'bash-tool-launch', role: null,
  payload: {
    bridge: 'codex-app-server',
    bridge_argv: ['fake-node', 'fake-runtime-bridge-codex', '--action', 'fake-supervisor-start-action-01'],
    bridge_command: "'fake-node' 'fake-runtime-bridge-codex' '--action' 'fake-supervisor-start-action-01'",
  },
};
const resumeActions = agentActions.map((action, index) => ({
  action_id: `${index + 11}`.padStart(32, '0'), kind: 'role-notify',
  runtime: 'claude-native', operation: 'SendMessage', role: action.payload.agent_type,
  payload: {
    binding_id: `${index + 31}`.padStart(32, '0'),
    teammate_name: action.payload.teammate_name,
    artifact_ref: `checkpoint:${digest('p4-full-scenario-checkpoint-v1')}`,
    artifact_kind: 'session-control',
    message: `Resume the parked actor for checkpoint:${digest('p4-full-scenario-checkpoint-v1')} using resume-handle:${`${index + 21}`.padStart(32, '0')}; runtime-action:${`${index + 11}`.padStart(32, '0')}.`,
  },
}));

// Byte-exact shape of the live INGESTION_NOTIFY/v1 delivery (artifact_ref confined in
// the canonical JSON, never interpolated prose), reused by every re-mint below so the
// repeats differ ONLY in transient envelope fields.
const LIVE_INGESTION_ARTIFACT_REF = ['C:', 'live-root', '.planning', 'wave-live',
  'requests', 'ingestion', 'p4-mcp-final.json'].join(path.win32.sep);
const LIVE_INGESTION_MESSAGE = `INGESTION_NOTIFY/v1
${JSON.stringify({
  artifact_ref: LIVE_INGESTION_ARTIFACT_REF,
  instruction: 'Read artifact_ref exactly, ingest or apply the approved request, publish its correlated result, then resume WAITING.',
  phase: 'request',
})}`;

function envelope(entrypoint, status, actions, result = null) {
  return {
    schema: 'runtime/collaboration-entrypoint-result/v1', entrypoint, status,
    detail: `fake-managed-${entrypoint}-${status.toLowerCase()}`,
    selection: {
      actual_host: 'claude', actual_model: 'claude-sonnet-5', actual_role_engine: 'claude',
      continuity: 'session-persistent', fallback_reason: null, fallback_used: false,
    },
    actions, result,
  };
}

function lifecycleResult(command, status, operation) {
  return {
    schema: 'coordination/lifecycle-cli-result/v1', command, ok: true, exit_code: 0,
    status, detail_code: 'NONE', notices: [], artifacts: [], actions: [], operation,
  };
}

function waitingOperation(kind, operationId, requestId) {
  return {
    kind, operation_id: operationId, state: 'WAITING', request_id: requestId,
    request_ref: null, request_digest: null, result_ref: null, result_digest: null,
    accepted_result_ref: null, accepted_result_digest: null,
    ack_ref: null, ack_digest: null, cancel_ref: null, cancel_digest: null,
  };
}

const fakeRootRequest = path.join(runRoot, 'fake-root-request.json');
const fakeRootClaim = path.join(runRoot, 'fake-root-claim.json');
const fakeRootRequestId = '55555555555555555555555555555555';
const fakeRootAttemptId = '66666666666666666666666666666666';
const fakeRootMessage = `COORDINATION_CONSULT/v1\n${JSON.stringify({
  artifact_path: fakeRootRequest,
  kind: 'consult',
  request_id: fakeRootRequestId,
  role: 'toolkit-specialist',
  target_role: 'arch-platform',
})}`;

let output;
if (kind === 'root-consult' && name === 'publish-request') {
  output = lifecycleResult(name, 'SUCCESS', null);
  output.artifact_ref = fakeRootRequest;
  output.artifact_digest = digest('fake-root-request');
  output.request_id = fakeRootRequestId;
} else if (kind === 'root-consult' && name === 'dispatch') {
  output = lifecycleResult(name, 'SUCCESS', null);
  output.activation_action = {
    kind: 'claude-sendmessage', selected_driver: 'claude-sendmessage',
    request_artifact_path: fakeRootRequest, request_id: fakeRootRequestId,
    attempt_id: fakeRootAttemptId, lease_epoch: 1,
    target_role: 'arch-platform',
    target_name: scenario === 'direct-role-foreign-root-activation' ? 'arch-testing' : 'arch-platform',
    message: fakeRootMessage,
  };
} else if (kind === 'root-consult' && name === 'record-delivery') {
  output = lifecycleResult(name, 'SUCCESS', null);
  output.artifact_ref = path.join(runRoot, 'fake-root-delivery.json');
} else if (kind === 'root-consult' && name === 'claim') {
  output = lifecycleResult(name, 'SUCCESS', null);
  output.artifact_ref = fakeRootClaim;
} else if (kind === 'root-consult' && name === 'publish-result') {
  output = lifecycleResult(name, 'SUCCESS', null);
  output.artifact_ref = path.join(runRoot, 'fake-root-result.json');
  output.artifact_digest = digest('fake-root-result');
} else if (kind === 'root-consult' && name === 'await-result') {
  output = lifecycleResult(name, 'SUCCESS', null);
  output.artifact_ref = path.join(runRoot, 'fake-root-result.json');
} else if (kind === 'root-consult' && name === 'accept-result') {
  output = lifecycleResult(name, 'SUCCESS', null);
  output.artifact_ref = path.join(runRoot, 'fake-root-accepted-result.json');
  output.artifact_digest = digest('fake-root-accepted-result');
} else if (kind === 'root-consult' && name === 'transaction-ack') {
  output = lifecycleResult(name, 'SUCCESS', null);
  output.artifact_ref = path.join(runRoot, 'fake-root-ack.json');
  output.artifact_digest = digest('fake-root-ack');
} else if (kind === 'lifecycle' && name === 'stop-owned') {
  output = {
    schema: 'coordination/lifecycle-cli-result/v1', command: 'stop-owned', ok: true,
    exit_code: 0, status: 'STOPPED', detail_code: 'NONE', notices: [], artifacts: [],
    actions: [{ action_id: `stop-${role}`, kind: 'role-stop-owned', runtime: 'claude-native', role }],
    operation: null,
  };
} else if (kind === 'lifecycle' && name === 'mixed-review-request') {
  output = lifecycleResult(name, 'WAITING',
    waitingOperation(name, '11111111111111111111111111111111', '33333333333333333333333333333333'));
} else if (kind === 'lifecycle' && name === 'consult-root') {
  output = lifecycleResult(name, 'WAITING',
    waitingOperation('root-consult', '22222222222222222222222222222222', '44444444444444444444444444444444'));
} else if (kind === 'lifecycle' && name === 'consult-root-status') {
  output = lifecycleResult(name, 'READY', {
    ...waitingOperation('root-consult', '22222222222222222222222222222222', '44444444444444444444444444444444'),
    state: 'READY', result_ref: 'result:p5-docs', result_digest: digest('p5-docs-result'),
    accepted_result_ref: 'accepted-result:p5-docs', accepted_result_digest: digest('p5-docs-accepted'),
    ack_ref: 'ack:p5-docs', ack_digest: digest('p5-docs-ack'),
  });
} else if (name === 'init-session') {
  // ensure() keeps projecting an unconsumed supervisor-start until its worker registers
  // READY, so the identical action id is re-emitted on re-entry. Reproduces that.
  const repeatSupervisor = process.env.P5_CERT_REPEAT_SUPERVISOR_START === '1'
    && scenario === 'P5_U2_DOCS_MCP' && state.counts[name] === 2;
  output = state.counts[name] === 1
    ? envelope(name, 'ACTION_REQUIRED', scenario === 'P5_U2_DOCS_MCP'
      ? [agentActions[0], agentActions[2], agentActions[4], supervisorStartAction]
      : agentActions)
    : repeatSupervisor
      ? envelope(name, 'ACTION_REQUIRED', [supervisorStartAction])
      : envelope(name, 'READY', []);
} else if (name === 'resume-work') {
  output = state.counts[name] === 1
    ? envelope(name, 'ACTION_REQUIRED', resumeActions)
    : envelope(name, 'READY', []);
} else if (name === 'work') {
  output = state.counts[name] === 1
    ? envelope(name, 'ACTION_REQUIRED', [rootAction])
    : envelope(name, 'COMPLETED', [], {
      result_ref: `transactions/${'1'.repeat(64)}/results/${'2'.repeat(32)}.json`,
      result_digest: 'a'.repeat(64),
      accepted_result_ref: `transactions/${'1'.repeat(64)}/accepted-result.json`,
      accepted_result_digest: 'b'.repeat(64),
      ack_ref: `transactions/${'1'.repeat(64)}/ack.json`, ack_digest: 'c'.repeat(64),
    });
} else if (name === 'ingest-content') {
  if (state.counts[name] === 1) {
    output = envelope(name, 'BLOCKED', [], null);
    output.detail = 'approval-required';
  } else if (state.counts[name] === 2
      || (process.env.P4_CERT_REPEAT_INGEST_ACTION === '1' && state.counts[name] === 3)
      || (process.env.P4_CERT_REPEAT_INGEST_ACTION_VARIED === '1' && state.counts[name] <= 4)) {
    const mint = state.counts[name];
    const notify = {
      action_id: `fake-ingest-message-${mint}`, kind: 'role-notify', runtime: 'claude-native',
      operation: 'SendMessage', role: 'doc-updater',
      payload: { teammate_name: 'doc-updater', message: 'fake-ingestion-message' },
    };
    if (process.env.P4_CERT_REPEAT_INGEST_ACTION_VARIED === '1') {
      // Reproduces the live approved-ingestion re-mint exactly: the producer stamps a
      // fresh action id, expiry, session generation, binding id and authority digests on
      // every emission while the DELIVERED semantics (role, artifact_ref, artifact_kind,
      // phase and message bytes) are byte-identical. Keying repeat detection on any of
      // those transient fields therefore sees N distinct action sets and redelivers
      // forever, which is the defect this fixture exists to reproduce.
      notify.schema = 'coordination/role-lifecycle-action/v1';
      notify.action_id = digest(`live-mint-action-${mint}`).slice(0, 32);
      notify.expires_at = `2026-09-09T17:26:${String(20 + mint).padStart(2, '0')}Z`;
      notify.session_generation_id = digest(`live-mint-generation-${mint}`).slice(0, 32);
      notify.policy_digest = digest(`live-mint-policy-${mint}`);
      notify.plan_digest = digest('live-mint-plan');
      notify.repo_id = digest('live-mint-repo');
      notify.worktree_id = digest('live-mint-worktree');
      notify.payload = {
        binding_id: digest(`live-mint-binding-${mint}`).slice(0, 32),
        teammate_name: 'doc-updater',
        artifact_ref: LIVE_INGESTION_ARTIFACT_REF,
        artifact_kind: 'ingestion-request',
        message: LIVE_INGESTION_MESSAGE,
      };
    }
    output = envelope(name, 'ACTION_REQUIRED', [notify]);
  } else {
    const requestRef = process.env.P4_CERT_FAKE_INGEST_REQUEST_REF;
    const approvalRef = process.env.P4_CERT_FAKE_INGEST_APPROVAL_REF;
    output = envelope(name, 'COMPLETED', [], {
      request_ref: requestRef, approval_ref: approvalRef,
      request_digest: requestRef.slice('request:'.length),
      approval_digest: approvalRef.slice('approval:'.length),
      result_ref: `result:${'d'.repeat(64)}`, result_digest: 'd'.repeat(64),
      disposition: 'written', audit_status: 'recorded',
    });
  }
} else if (name === 'monitor-docs') {
  output = envelope(name, 'COMPLETED', [], { observations: [], proposals: [] });
} else {
  process.stderr.write(`unsupported fake managed command: ${name}\n`);
  process.exit(64);
}
process.stdout.write(`${JSON.stringify(output)}\n`);
process.exit(output.status === 'ACTION_REQUIRED' ? 4 : (output.status === 'BLOCKED' ? 5 : 0));
