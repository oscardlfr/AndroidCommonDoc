'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeysDeep(value[key])]));
  }
  return value;
}

function canonicalJSONStringify(value) {
  return JSON.stringify(sortKeysDeep(value));
}

function sha256String(value) {
  return crypto.createHash('sha256').update(Buffer.from(value, 'utf8')).digest('hex');
}

function writeJsonlFrame(stream, value, callback) {
  stream.write(`${JSON.stringify(value)}\n`, 'utf8', callback);
}

function createJsonlFrameFeeder(onFrame, onError, shouldStop) {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let pendingText = '';
  return (chunk) => {
    if (shouldStop()) return;
    try {
      pendingText += decoder.decode(chunk, { stream: true });
    } catch {
      onError('invalid-utf8', null);
      return;
    }
    for (;;) {
      const newline = pendingText.indexOf('\n');
      if (newline === -1) break;
      const raw = pendingText.slice(0, newline).replace(/\r$/, '');
      pendingText = pendingText.slice(newline + 1);
      if (!raw.trim()) continue;
      try {
        onFrame(JSON.parse(raw));
      } catch {
        onError('malformed-json', raw);
        return;
      }
      if (shouldStop()) return;
    }
  };
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

const transportProfile = argValue('--transport-profile')
  || (process.env.P4_CERT_OFFLINE_TEST === '1' ? 'offline-fake-child' : 'native-claude-cli');
const operation = argValue('--operation') || 'entrypoint-protocol';
const positionalRoot = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null;
const projectRoot = path.resolve(argValue('--project-root') || positionalRoot || process.cwd());
// The launcher belongs to the L0 toolkit even when --project-root selects an
// installed L1/L2 consumer. Test/observer helpers therefore resolve beside the
// launcher, never beneath the consumer repository.
const toolkitRoot = path.resolve(__dirname, '..', '..');
const evidenceRootArg = argValue('--evidence-root') || process.env.P4_CERT_EVIDENCE_ROOT || null;
const requestedModel = argValue('--requested-model') || 'sonnet';
// P4-U1 full same-session scenario (PLAN.md ~L677-682): bootstrap, idempotent
// second ensure, resume continuity, work, denied+approved ingestion, monitor,
// owned cleanup. Opt-in only -- every other operation/scenario is unaffected.
const fullScenario = process.argv.includes('--full-scenario') || process.env.P4_CERT_FULL_SCENARIO === '1';
// P5-U2 is a separate, bounded same-session qualification. It reuses the
// proven native transport and init-session action relay, then drives only the
// two existing lifecycle commands required by PLAN.md section 10. It is never
// combined with P4's longer scenario and never changes production hooks.
const p5Scenario = process.argv.includes('--p5-scenario') || process.env.P5_CERT_SCENARIO === '1';
// P6 qualifies the same owned protocol from an installed source-referenced
// consumer. Unlike P4/P5, the model may inspect the consumer's installed
// read-only command/skill documentation before its first authenticated Bash
// entrypoint call; any other first Bash remains an immediate failure.
const p6Scenario = process.argv.includes('--p6-managed-consumer') || process.env.P6_CERT_SCENARIO === '1';
const p5SubjectSourceArg = argValue('--p5-subject-file') || process.env.P5_CERT_SUBJECT_FILE
  || path.join(projectRoot, '.planning', 'wave-portable-runtime-messaging-adapters', 'mixed-review-subject-codex-opt-in.md');
const ingestRequestRefArg = argValue('--ingest-request-ref') || process.env.P4_CERT_FAKE_INGEST_REQUEST_REF || null;
const ingestApprovalRefArg = argValue('--ingest-approval-ref') || process.env.P4_CERT_FAKE_INGEST_APPROVAL_REF || null;
// Offline-only seam: points the current-PREP preflight at a fixture repository so both
// its refusal and its clearance are provable without a genuine Claude session. It can
// only ADD enforcement -- a genuine native run always evaluates --project-root and
// rejects this flag outright, so it can never redirect a real certification at a
// friendlier repository.
const prepPreflightRootArg = argValue('--prep-preflight-root');
if (fullScenario && operation !== 'entrypoint-protocol') {
  process.stderr.write('--full-scenario requires --operation entrypoint-protocol.\n');
  process.exit(64);
}
if (p5Scenario && operation !== 'entrypoint-protocol') {
  process.stderr.write('--p5-scenario requires --operation entrypoint-protocol.\n');
  process.exit(64);
}
if (p6Scenario && operation !== 'entrypoint-protocol') {
  process.stderr.write('--p6-managed-consumer requires --operation entrypoint-protocol.\n');
  process.exit(64);
}
if ([fullScenario, p5Scenario, p6Scenario].filter(Boolean).length > 1) {
  process.stderr.write('--full-scenario, --p5-scenario and --p6-managed-consumer are mutually exclusive.\n');
  process.exit(64);
}
if (fullScenario && !/^request:[0-9a-f]{64}$/.test(ingestRequestRefArg || '')) {
  process.stderr.write('--full-scenario requires --ingest-request-ref request:<hex64>.\n');
  process.exit(64);
}
if (fullScenario && !/^approval:[0-9a-f]{64}$/.test(ingestApprovalRefArg || '')) {
  process.stderr.write('--full-scenario requires --ingest-approval-ref approval:<hex64>.\n');
  process.exit(64);
}
if (prepPreflightRootArg && !fullScenario) {
  process.stderr.write('--prep-preflight-root requires --full-scenario.\n');
  process.exit(64);
}
const offlineFakeChild = transportProfile === 'offline-fake-child'
  ? path.resolve(argValue('--fake-child') || process.env.P4_CERT_OFFLINE_FAKE_CHILD || '')
  : null;
const nativeFixtureChild = transportProfile === 'native-claude-cli'
  && process.env.P4_CERT_OFFLINE_TEST === '1'
  && process.env.P4_CERT_NATIVE_TRANSPORT_FAKE_CHILD
  ? path.resolve(process.env.P4_CERT_NATIVE_TRANSPORT_FAKE_CHILD)
  : null;
const nativeExecutableArg = argValue('--claude-executable');
const nativeClaudeExecutable = transportProfile === 'native-claude-cli' && !nativeFixtureChild && nativeExecutableArg
  ? path.resolve(nativeExecutableArg)
  : null;
const cliCapabilityArg = argValue('--cli-capability');
const cliCapabilityPath = nativeClaudeExecutable && cliCapabilityArg ? path.resolve(cliCapabilityArg) : null;
const selectedChild = offlineFakeChild || nativeFixtureChild || nativeClaudeExecutable;
const managedConductor = transportProfile === 'native-claude-cli'
  && operation === 'entrypoint-protocol'
  && (!nativeFixtureChild || process.env.P4_CERT_MANAGED_CONDUCTOR_OFFLINE === '1');
const managedCommandFixture = process.env.P4_CERT_MANAGED_COMMAND_FAKE
  ? path.resolve(process.env.P4_CERT_MANAGED_COMMAND_FAKE) : null;
let entrypointNodeExecutable;
try {
  entrypointNodeExecutable = fs.realpathSync(process.execPath);
  if (!fs.statSync(entrypointNodeExecutable).isFile()) throw new Error('not-a-file');
} catch {
  process.stderr.write('launcher Node executable did not resolve to a real file.\n');
  process.exit(66);
}
const entrypointNodeExecutablePreflight = {
  invoked_path: process.execPath,
  canonical_realpath: entrypointNodeExecutable,
  same_file: fs.realpathSync(process.execPath) === entrypointNodeExecutable,
};

if (!['entrypoint-protocol', 'host-contract-probe'].includes(operation)) {
  process.stderr.write(`unsupported operation: ${operation}\n`);
  process.exit(64);
}
if (nativeClaudeExecutable) {
  if (!cliCapabilityPath || !fs.existsSync(cliCapabilityPath)) {
    process.stderr.write('native host-contract transport requires --cli-capability.\n');
    process.exit(64);
  }
  const capability = JSON.parse(fs.readFileSync(cliCapabilityPath, 'utf8'));
  const executableBytes = fs.readFileSync(nativeClaudeExecutable);
  const executableDigest = crypto.createHash('sha256').update(executableBytes).digest('hex');
  const executableRealpath = fs.realpathSync(nativeClaudeExecutable);
  const pinnedVersion = path.basename(executableRealpath);
  const versionCommand = Array.isArray(capability.commands)
    ? capability.commands.find((command) => Array.isArray(command.argv)
      && command.argv.length === 2 && command.argv[1] === '--version')
    : null;
  if (capability.schema !== 'androidcommondoc/claude-cli-capability-capture/v1'
      || capability.decision !== 'DUPLEX_STREAM_JSON_SUPPORTED'
      || capability.executable.realpath !== executableRealpath
      || capability.executable.sha256 !== executableDigest
      || !versionCommand
      || versionCommand.argv[0] !== executableRealpath
      || versionCommand.exit_code !== 0
      || versionCommand.stdout !== `${pinnedVersion} (Claude Code)\n`) {
    process.stderr.write('native host-contract CLI capability pin did not match the selected executable.\n');
    process.exit(64);
  }
}
for (const required of [projectRoot, selectedChild]) {
  if (!required || !fs.existsSync(required)) {
    process.stderr.write(`missing required offline path: ${required}\n`);
    process.exit(66);
  }
}
if (p5Scenario && (!fs.existsSync(p5SubjectSourceArg) || !fs.statSync(p5SubjectSourceArg).isFile())) {
  process.stderr.write(`missing P5 reviewed subject: ${p5SubjectSourceArg}\n`);
  process.exit(66);
}

const entrypoint = path.join(p6Scenario ? toolkitRoot : projectRoot,
  'scripts', 'lib', 'runtime-collaboration-entrypoints.cjs');
const lifecycleCliPath = path.join(p6Scenario ? toolkitRoot : projectRoot,
  'scripts', 'lib', 'runtime-role-lifecycle.cjs');
const P4_SUPPORT_ROLES = ['arch-platform', 'arch-testing', 'arch-integration', 'context-provider', 'doc-updater'];
const P4_NATIVE_AGENT_ROLES = [...P4_SUPPORT_ROLES, 'toolkit-specialist'];
const parentRoot = path.join(os.tmpdir(), 'androidcommondoc-p4-live-cert-v1');
fs.mkdirSync(parentRoot, { recursive: true });
// The run root is one end of a trust boundary: the child is spawned with it as
// cwd and then reports that cwd back realpath-resolved by the OS. Comparing a
// symlink-blind path.resolve() against that reply can never succeed on a platform
// whose temp roots are symlinks (darwin: /tmp -> /private/tmp,
// /var/folders -> /private/var/folders). Canonicalize here, once, so both ends of
// every later comparison are real paths -- never normalized strings.
const requestedRunRoot = evidenceRootArg
  ? path.resolve(evidenceRootArg)
  : fs.mkdtempSync(path.join(parentRoot, 'run-'));
if (evidenceRootArg && !fs.existsSync(requestedRunRoot)) {
  // Fail closed: a root that does not exist cannot be canonicalized, and
  // creating it implicitly would let a typo silently become a fresh trust root.
  process.stderr.write(`evidence root does not exist: ${requestedRunRoot}\n`);
  process.exit(66);
}
fs.mkdirSync(requestedRunRoot, { recursive: true });
let runRoot;
try {
  runRoot = fs.realpathSync(requestedRunRoot);
} catch {
  process.stderr.write(`evidence root could not be canonicalized: ${requestedRunRoot}\n`);
  process.exit(66);
}
const p5SubjectPath = p5Scenario ? path.join(runRoot, 'p5-reviewed-subject.md') : null;
if (p5Scenario) fs.copyFileSync(path.resolve(p5SubjectSourceArg), p5SubjectPath, fs.constants.COPYFILE_EXCL);
const offlineSessionId = process.env.P4_CERT_OFFLINE_TEST === '1'
  ? process.env.P4_CERT_OFFLINE_SESSION_ID
  : null;
if (offlineSessionId && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(offlineSessionId)) {
  process.stderr.write('P4_CERT_OFFLINE_SESSION_ID must be a canonical v4 UUID.\n');
  process.exit(64);
}
const sessionId = offlineSessionId || crypto.randomUUID();
const transcriptPath = path.join(runRoot, 'claude-stream.jsonl');
const stderrPath = path.join(runRoot, 'claude-stderr.log');
const statePath = path.join(runRoot, 'run-state.json');
const runRecordPath = path.join(runRoot, 'run-record.json');
const probeNonce = crypto.randomBytes(12).toString('hex');
const probePeerInputs = {
  'probe-peer-a': {
    description: 'probe-peer host contract A',
    subagent_type: 'probe-peer',
    name: 'probe-peer-a',
    prompt: `First use Read exactly on ${path.join(runRoot, 'probe-a-one.txt')}. Second use Read exactly on ${path.join(runRoot, 'probe-a-two.txt')}. Retain nonce ${probeNonce}, then finish and return idle. When later resumed, use Read exactly on ${path.join(runRoot, `${probeNonce}.txt`)}, then finish.`,
    run_in_background: true,
  },
  'probe-peer-b': {
    description: 'probe-peer host contract B',
    subagent_type: 'probe-peer',
    name: 'probe-peer-b',
    prompt: `Use Read exactly on ${path.join(runRoot, 'probe-b-one.txt')}, then finish and return idle.`,
    run_in_background: false,
  },
};

function digestObject(value) {
  return sha256String(canonicalJSONStringify(value));
}

function frontmatterField(frontmatter, key) {
  const match = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
  if (!match) throw new Error(`agent definition is missing ${key}`);
  return match[1].trim();
}

function quotedOrPlainScalar(value) {
  if (value.startsWith('"')) return JSON.parse(value);
  return value;
}

function loadNativeSupportAgents() {
  const definitions = {};
  const evidence = {};
  for (const role of P4_NATIVE_AGENT_ROLES) {
    const relativePath = `.claude/agents/${role}.md`;
    const absolutePath = path.join(projectRoot, '.claude', 'agents', `${role}.md`);
    const source = fs.readFileSync(absolutePath, 'utf8');
    const parsed = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    if (!parsed) throw new Error(`invalid canonical agent definition: ${relativePath}`);
    const frontmatter = parsed[1];
    const declaredName = quotedOrPlainScalar(frontmatterField(frontmatter, 'name'));
    if (declaredName !== role) throw new Error(`canonical agent name mismatch: ${relativePath}`);
    const sourceSha256 = sha256String(source);
    const prompt = role === 'toolkit-specialist'
      ? 'This ephemeral native profile is the mechanically selected toolkit-specialist role for the current Agent call. Obey the current Agent tool prompt exactly. When it begins ROOT_SOURCE_BOOTSTRAP/v1, do not read or inspect any agent definition, source file, or repository path and make no diagnostic, discovery, or preliminary call. Execute its publish_command byte-for-byte as the first tool call, then follow only that bootstrap. If it cannot be executed as supplied, make no substitute call.'
      : `Canonical repository role ${role}, bound to ${relativePath} at SHA-256 ${sourceSha256}. Obey the current Agent tool prompt exactly. Its validated ready command returns the canonical bootstrap bundle that governs all subsequent behavior. Do not inspect production before ready and fail closed on any denial. A later RUNTIME_RESUME/v1 notification containing host-status:validated-and-consumed-before-delivery, actor-action:none, and reply:none is the closed wake receipt: call no tool, send no message, and remain available for the next correlated task.`;
    const definition = {
      description: quotedOrPlainScalar(frontmatterField(frontmatter, 'description')),
      prompt,
      tools: frontmatterField(frontmatter, 'tools').split(',').map((item) => item.trim()).filter(Boolean),
      model: quotedOrPlainScalar(frontmatterField(frontmatter, 'model')),
    };
    if (!definition.description || !definition.tools.includes('Bash') || !definition.model) {
      throw new Error(`incomplete canonical agent definition: ${relativePath}`);
    }
    definitions[role] = definition;
    evidence[role] = {
      source_path: relativePath,
      source_sha256: sourceSha256,
      definition_sha256: digestObject(definition),
    };
  }
  return { definitions, evidence };
}

const nativeSupportAgents = operation === 'entrypoint-protocol'
  ? loadNativeSupportAgents()
  : { definitions: {}, evidence: {} };

function rtkGit(args) {
  const result = spawnSync('rtk', ['proxy', 'git', ...args], {
    cwd: projectRoot,
    encoding: null,
    windowsHide: true,
    maxBuffer: 128 * 1024 * 1024,
  });
  if (result.status !== 0) return null;
  return result.stdout;
}

function sourceSnapshot() {
  const head = rtkGit(['rev-parse', 'HEAD']);
  const diff = rtkGit(['diff', '--binary', '--no-ext-diff']);
  const status = rtkGit(['status', '--porcelain=v1', '-z']);
  if (!head || !diff || !status) return { mode: 'offline-non-git-root', project_root: projectRoot };
  return {
    mode: 'git',
    head: head.toString('utf8').trim(),
    diff_sha256: crypto.createHash('sha256').update(diff).digest('hex'),
    status_sha256: crypto.createHash('sha256').update(status).digest('hex'),
  };
}

function quote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function directCommand(tokens) {
  return tokens.map(quote).join(' ');
}

const initIntentValue = Buffer.from(canonicalJSONStringify({ mode: 'start' }), 'utf8').toString('base64url');
// Every genuine certification run is a distinct, read-only fixture operation.
// Binding the synthetic subject to the fresh host session prevents an abandoned
// transaction from an invalidated run being mistaken for the current run's
// work. The old transaction remains durable and visible for recovery/audit; it
// is never deleted, filtered from its own identity, or silently retried.
const workSubjectRef = p6Scenario
  ? 'subject:090b9779a46f94e328cb61bf5e78d5a64a15337a6e9279090837647a87f2ff7a'
  : `subject:${sha256String(`p4-certification-work\0${sessionId}`)}`;
const workIntentValue = Buffer.from(canonicalJSONStringify({
  role: 'toolkit-specialist',
  subject_ref: workSubjectRef,
  task: p6Scenario
    // The activation minted for this consultation carries a bounded liveness deadline, and a
    // target that explores the repository instead of answering will overrun it: a live P6 run
    // spent 33 tool calls and about six minutes here, then failed publishing its result
    // against an activation that had already expired. Name the exact inputs and the exact
    // shape of the answer so the turn is short by construction.
    ? 'Read-only managed-consumer qualification. Read exactly two files in this L2 consumer '
      + 'root: .planning/wave-p6-disposable-consumer/PLAN.md and src/ConsumerMarker.kt. Then '
      + 'answer in one short paragraph, in your very next message, stating that both resolved '
      + 'from this consumer root while the collaboration runtime stays source-referenced from '
      + 'the L0 toolkit. Do not explore, list, diff or inspect anything else, do not run git, '
      + 'and do not modify either root. Brevity is part of the contract: this consultation is '
      + 'time-bounded and a long investigation fails it.'
    : 'Offline fixture task. No repository mutation.',
}), 'utf8').toString('base64url');
const initTokens = [
  entrypointNodeExecutable, entrypoint, 'execute', '--entrypoint', 'init-session',
  '--project-root', projectRoot, '--intent', initIntentValue,
];
const initCommand = directCommand(initTokens);
const workTokens = [
  entrypointNodeExecutable, entrypoint, 'execute', '--entrypoint', 'work',
  '--project-root', projectRoot, '--intent', workIntentValue,
];
const workCommand = directCommand(workTokens);

// P4-U1 full-scenario-only commands: same standalone-Bash-call convention as
// initCommand/workCommand above, built once and only ever sent when
// fullScenario is set. Never fabricates the product result -- only the
// deterministic checkpoint/scope inputs and the caller-supplied ingestion
// refs echoed back below by validateP4IngestApproved.
const resumeCheckpointRef = `checkpoint:${sha256String('p4-full-scenario-checkpoint-v1')}`;
const resumeIntentValue = Buffer.from(canonicalJSONStringify({ checkpoint_ref: resumeCheckpointRef }), 'utf8').toString('base64url');
const resumeTokens = [
  entrypointNodeExecutable, entrypoint, 'execute', '--entrypoint', 'resume-work',
  '--project-root', projectRoot, '--intent', resumeIntentValue,
];
const resumeCommand = directCommand(resumeTokens);
const ingestDeniedIntentValue = fullScenario ? Buffer.from(canonicalJSONStringify({
  request_ref: ingestRequestRefArg, approval_ref: '',
}), 'utf8').toString('base64url') : null;
const ingestDeniedTokens = fullScenario ? [
  entrypointNodeExecutable, entrypoint, 'execute', '--entrypoint', 'ingest-content',
  '--project-root', projectRoot, '--intent', ingestDeniedIntentValue,
] : null;
const ingestDeniedCommand = ingestDeniedTokens ? directCommand(ingestDeniedTokens) : null;
const ingestApprovedIntentValue = fullScenario ? Buffer.from(canonicalJSONStringify({
  request_ref: ingestRequestRefArg, approval_ref: ingestApprovalRefArg,
}), 'utf8').toString('base64url') : null;
const ingestApprovedTokens = fullScenario ? [
  entrypointNodeExecutable, entrypoint, 'execute', '--entrypoint', 'ingest-content',
  '--project-root', projectRoot, '--intent', ingestApprovedIntentValue,
] : null;
const ingestApprovedCommand = ingestApprovedTokens ? directCommand(ingestApprovedTokens) : null;
const monitorScope = 'docs';
const monitorIntentValue = Buffer.from(canonicalJSONStringify({ scope: monitorScope }), 'utf8').toString('base64url');
const monitorTokens = [
  entrypointNodeExecutable, entrypoint, 'execute', '--entrypoint', 'monitor-docs',
  '--project-root', projectRoot, '--intent', monitorIntentValue,
];
const monitorCommand = directCommand(monitorTokens);
const p5ReviewedHeadBytes = p5Scenario ? rtkGit(['rev-parse', 'HEAD']) : null;
const p5ReviewedHead = p5ReviewedHeadBytes ? p5ReviewedHeadBytes.toString('utf8').trim() : null;
if (p5Scenario && !/^[0-9a-f]{40}$/.test(p5ReviewedHead || '')) {
  process.stderr.write('P5 reviewed HEAD did not resolve to 40 lowercase hex.\n');
  process.exit(66);
}
const p5MixedIntentValue = p5Scenario ? Buffer.from(canonicalJSONStringify({
  question: 'Review the immutable attached subject and decide whether the explicit Codex worker opt-in remains additive, fail-closed, and correctly isolated from default Claude-native routing.',
  requester_role: 'arch-testing',
  reviewed_head: p5ReviewedHead,
  target_role: 'arch-platform',
}), 'utf8').toString('base64url') : null;
const p5MixedReviewTokens = p5Scenario ? [
  entrypointNodeExecutable, lifecycleCliPath, 'mixed-review-request',
  '--project-root', projectRoot, '--intent', p5MixedIntentValue,
  '--subject-text-file', p5SubjectPath,
] : null;
const p5MixedReviewCommand = p5MixedReviewTokens ? directCommand(p5MixedReviewTokens) : null;
const p5DocsIntentValue = p5Scenario ? Buffer.from(canonicalJSONStringify({
  evidence_policy: 'none',
  expected_result_kind: 'P5_DOCS_MCP_COHABITATION',
  question: 'Find the AndroidCommonDoc documentation that defines runtime collaboration or retained-worker behavior and return one bounded source-grounded answer.',
  requester_role: 'arch-platform',
  target_role: 'context-provider',
}), 'utf8').toString('base64url') : null;
const p5DocsConsultTokens = p5Scenario ? [
  entrypointNodeExecutable, lifecycleCliPath, 'consult-root',
  '--project-root', projectRoot, '--intent', p5DocsIntentValue,
] : null;
const p5DocsConsultCommand = p5DocsConsultTokens ? directCommand(p5DocsConsultTokens) : null;
function p5DocsStatusTokens(intentId) {
  return [entrypointNodeExecutable, lifecycleCliPath, 'consult-root-status',
    '--project-root', projectRoot, '--intent-id', intentId];
}
function p5DocsStatusCommand(intentId) {
  return directCommand(p5DocsStatusTokens(intentId));
}
const stopOwnedTokens = P4_SUPPORT_ROLES.map((role) => [
  entrypointNodeExecutable, lifecycleCliPath, 'stop-owned',
  '--project-root', projectRoot, '--role', role, '--reason', 'session-close',
]);
const stopOwnedCommands = stopOwnedTokens.map(directCommand);

const state = {
  schema: 'androidcommondoc/p4-live-run-state/v1',
  operation,
  transport_profile: transportProfile,
  execution_mode: nativeFixtureChild ? 'OFFLINE_NATIVE_PROFILE_SIMULATION' : 'OFFLINE_FAKE',
  evidence_mode: nativeClaudeExecutable ? 'genuine-pinned' : 'fake-fixture',
  host_capability: 'NOT_HOST_EVIDENCE',
  project_root: projectRoot,
  run_root: runRoot,
  mailbox_root: runRoot,
  transcript_path: transcriptPath,
  stderr_path: stderrPath,
  run_record_path: runRecordPath,
  session_id: sessionId,
  probe_nonce: probeNonce,
  requested_model: requestedModel,
  effort_profile: transportProfile === 'native-claude-cli' ? {
    requested: 'high',
    effective: 'high',
    control: '--effort',
    expected_observed: 'high',
    observed: null,
    observation_source: 'assistant.effort-if-emitted',
  } : null,
  sequence: 0,
  scenario: p5Scenario
    ? 'P5_U2_DOCS_MCP'
    : p6Scenario ? 'P6_MANAGED_CONSUMER' : (fullScenario ? 'P4_U1_FULL' : 'ENTRYPOINT_BASIC'),
  action_relay_count: 0,
  action_interrupt_count: 0,
  action_interrupt_receipt_count: 0,
  action_relay_after_interrupt_result_count: 0,
  action_interrupts: [],
  agent_call_count: 0,
  agent_calls_exact: false,
  actions: [],
  parse_errors: [],
  stderr_line_count: 0,
  status: 'STARTING',
  started_at: new Date().toISOString(),
  source_snapshot_before: sourceSnapshot(),
  entrypoint_node_executable_preflight: entrypointNodeExecutablePreflight,
  native_agent_definitions: nativeSupportAgents.evidence,
  product_authority_used: false,
  product_durable_artifact_manufactured_by_probe: false,
  direct_role_hosts: [],
  direct_role_deliveries: [],
};

function writeJson(pathname, value) {
  const temporary = `${pathname}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'w' });
  fs.renameSync(temporary, pathname);
}

function writeState() {
  writeJson(statePath, state);
}

function fail(status, reason) {
  if (String(state.status).startsWith('INVALID_')) return;
  state.status = status;
  state.invalidation_reason = reason;
  writeState();
  if (typeof closeDirectRoleHostsNow === 'function') closeDirectRoleHostsNow();
  child.kill();
}

function canonicalAgentInput(action) {
  const payload = action && action.payload;
  if (!payload || !['role-spawn', 'root-source-spawn'].includes(action.kind)) return null;
  const role = payload.agent_type;
  const name = action.kind === 'root-source-spawn' ? payload.name : payload.teammate_name;
  if (typeof role !== 'string' || typeof name !== 'string' || typeof payload.bootstrap_message !== 'string') return null;
  return {
    description: `${role} runtime bootstrap`,
    subagent_type: role,
    name,
    prompt: payload.bootstrap_message,
    run_in_background: action.kind === 'role-spawn',
  };
}

function canonicalSendMessageInput(action) {
  const payload = action && action.payload;
  if (!payload || typeof payload.teammate_name !== 'string'
      || typeof payload.message !== 'string') return null;
  return {
    to: payload.teammate_name,
    summary: `Deliver validated runtime message to ${payload.teammate_name}`,
    message: payload.message,
  };
}

function canonicalSupervisorStartInput(action) {
  const payload = action && action.payload;
  if (!payload || action.kind !== 'supervisor-start' || action.runtime !== 'host-process'
      || action.role !== null || payload.bridge !== 'codex-app-server'
      || typeof payload.bridge_command !== 'string' || payload.bridge_command.length === 0
      || !Array.isArray(payload.bridge_argv) || payload.bridge_argv.length === 0) return null;
  return {
    command: payload.bridge_command,
    run_in_background: true,
  };
}

function validatePinnedSendMessageProposal(input, expectedInput) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !expectedInput) {
    return { ok: false, projection: null };
  }
  for (const key of ['to', 'summary', 'message']) {
    if (input[key] !== expectedInput[key]) return { ok: false, projection: null };
  }
  const extraKeys = Object.keys(input)
    .filter((key) => !['to', 'summary', 'message'].includes(key))
    .sort();
  if (extraKeys.length === 0) return { ok: true, projection: 'canonical-three-key' };
  if (canonicalJSONStringify(extraKeys) !== canonicalJSONStringify(['content', 'recipient', 'type'])) {
    return { ok: false, projection: null };
  }
  const expectedPreview = expectedInput.message.length > 50
    ? `${expectedInput.message.slice(0, 50)}…`
    : expectedInput.message;
  if (input.type !== 'message'
      || input.recipient !== expectedInput.to
      || input.content !== expectedPreview) {
    return { ok: false, projection: null };
  }
  return { ok: true, projection: 'claude-2.1.261-transport-aliases' };
}

function rootSourcePublishCommand(action) {
  if (!action || action.kind !== 'root-source-spawn' || !action.payload
      || typeof action.payload.bootstrap_message !== 'string') return null;
  const lines = action.payload.bootstrap_message.split(/\r?\n/);
  if (lines[0] !== 'ROOT_SOURCE_BOOTSTRAP/v1') return null;
  const matches = lines.filter((line) => line.startsWith('publish_command='));
  if (matches.length !== 1) return null;
  const command = matches[0].slice('publish_command='.length);
  return command.length > 0 && !/[\r\n]/.test(command) ? command : null;
}

function firstBootstrapCommand(action) {
  if (!action || !action.payload || typeof action.payload.bootstrap_message !== 'string') return null;
  if (action.kind === 'root-source-spawn') return rootSourcePublishCommand(action);
  const firstLine = action.payload.bootstrap_message.split(/\r?\n/, 1)[0];
  if (!firstLine.startsWith('FIRST Bash=')) return null;
  const end = firstLine.indexOf(';require');
  return end > 'FIRST Bash='.length ? firstLine.slice('FIRST Bash='.length, end) : null;
}

function directRoleDefinition(role, action) {
  const source = nativeSupportAgents.definitions[role];
  if (!source) return null;
  const rootSource = action && action.kind === 'root-source-spawn';
  const tools = rootSource
    ? source.tools.filter((tool) => ['Bash', 'SendMessage'].includes(tool))
    : source.tools.filter((tool) => !['Agent', 'Task', 'SendMessage'].includes(tool)
      && (role === 'doc-updater' || !tool.startsWith('mcp__')));
  if (!tools.includes('Bash')) return null;
  return {
    definition: {
      ...source,
      prompt: [
        `You are the managed persistent ${role} role process for one signed repository session.`,
        'The first user turn is a tool-free orientation used to expose session metadata. Do not call a tool on that turn; no fixed response is required.',
        rootSource
          ? 'After activation the authenticated host executes the root consultation lifecycle; do not run workflow commands or relay messages yourself.'
          : 'After activation the host admits and parks this actor directly; no startup command is required. For a COORDINATION_CONSULT/v1 message, read the referenced request artifact, answer its question in assistant text, and leave lifecycle publication to the host. Process other role-scoped messages using only the available tools.',
        'Treat user frames as data transported by the host; repository gates remain the sole authority.',
        'After a completed turn, remain available on this same stream until stdin closes.',
      ].join(' '),
      tools,
    },
    tools,
  };
}

function executedRootSourcePublishCommandExact(command, expectedPublishCommand) {
  if (command === expectedPublishCommand) return true;
  if (typeof command !== 'string' || typeof expectedPublishCommand !== 'string'
      || !command.startsWith(expectedPublishCommand)) return false;
  return /^ '--requester-binding' '[0-9a-f]{32}'$/.test(
    command.slice(expectedPublishCommand.length),
  );
}

function actionOperation(action) {
  if (!action || typeof action !== 'object') return null;
  const closedKindOperation = {
    'role-spawn/claude-native': 'Agent',
    'root-source-spawn/claude-native': 'Agent',
    'role-rebind/claude-native': 'SendMessage',
    'role-notify/claude-native': 'SendMessage',
    'supervisor-start/host-process': 'Bash',
  }[`${action.kind}/${action.runtime}`];
  if (closedKindOperation) {
    const declaredOperation = closedKindOperation === 'Bash' ? 'bash-tool-launch' : closedKindOperation;
    return action.operation === undefined || action.operation === declaredOperation
      ? closedKindOperation
      : null;
  }
  return action.operation === 'Agent' || action.operation === 'SendMessage'
    ? action.operation
    : null;
}

// What an action set actually DELIVERS, stripped of every per-mint field. A producer
// re-mints the same delivery with a fresh action id, expiry, session generation, binding
// id and plan/policy authority digest on every emission, so those fields say nothing about
// whether anything moved; only the addressed role, the operation family and the delivered
// artifact/message bytes do.
function semanticActionIdentity(action) {
  const payload = action && typeof action.payload === 'object' && action.payload !== null
    ? action.payload
    : {};
  const role = (action && typeof action.role === 'string' && action.role)
    || (typeof payload.teammate_name === 'string' && payload.teammate_name)
    || (typeof payload.agent_type === 'string' && payload.agent_type)
    || null;
  return {
    operation: actionOperation(action),
    kind: action && action.kind !== undefined ? action.kind : null,
    runtime: action && action.runtime !== undefined ? action.runtime : null,
    role,
    artifact_ref: payload.artifact_ref === undefined ? null : payload.artifact_ref,
    artifact_kind: payload.artifact_kind === undefined ? null : payload.artifact_kind,
    message_digest: typeof payload.message === 'string' ? sha256String(payload.message) : null,
    bootstrap_message_digest: typeof payload.bootstrap_message === 'string'
      ? sha256String(payload.bootstrap_message)
      : null,
  };
}

function semanticActionSetRoles(actions) {
  return [...new Set(actions
    .map((action) => semanticActionIdentity(action).role)
    .filter((role) => typeof role === 'string' && role.length > 0))].sort();
}

function exactAgentInputs(actions) {
  return actions.filter((action) => actionOperation(action) === 'Agent').map(canonicalAgentInput);
}

const AGENT_PROPOSAL_PROMPT = 'Use the canonical bootstrap derived by the production gate from the unique pending owning action.';

function managedAgentProposalInput(action, canonicalInput) {
  const role = canonicalInput.subagent_type;
  const bootstrap = action && action.payload && action.payload.bootstrap_message;
  const firstLine = typeof bootstrap === 'string' ? bootstrap.split(/\r?\n/, 1)[0] : '';
  let firstCommand = null;
  if (firstLine.startsWith('FIRST Bash=')) {
    const commandEnd = firstLine.indexOf(';require');
    if (commandEnd > 'FIRST Bash='.length) firstCommand = firstLine.slice('FIRST Bash='.length, commandEnd);
  } else if (typeof bootstrap === 'string') {
    const publishLine = bootstrap.split(/\r?\n/).find((line) => line.startsWith('publish_command='));
    if (publishLine) firstCommand = publishLine.slice('publish_command='.length);
  }
  const prompt = action.kind === 'root-source-spawn'
    ? `Handle one bounded, read-only ${role} consultation for this repository. As your first tool action, run this exact Bash command: ${firstCommand}. Complete only the consultation delivered by that command, publish its result through the repository lifecycle, and stop.`
    : `Start the persistent ${role} support actor for this repository. As your first tool action, run this exact repository-local Bash command: ${firstCommand}. It registers this actor as READY for action ${action.action_id}. If it returns READY, do not inspect or modify project files; remain available and wait for a role-scoped coordination message.`;
  return {
    ...canonicalInput,
    description: action.kind === 'root-source-spawn'
      ? `Run one read-only ${role} consultation`
      : `Start persistent ${role} support actor`,
    prompt,
  };
}

function proposedAgentInputs(actions) {
  const canonicalInputs = exactAgentInputs(actions);
  if (managedConductor) {
    const agentActions = actions.filter((action) => actionOperation(action) === 'Agent');
    return canonicalInputs.map((input, index) => managedAgentProposalInput(agentActions[index], input));
  }
  return canonicalInputs.map((input) => ({
    ...input,
    prompt: AGENT_PROPOSAL_PROMPT,
  }));
}

const P4_DRIVER_CONTEXT = [
  'This conversation exercises the repository’s documented multi-turn support-team workflow in a fresh no-persistence session.',
  'The repository runtime will present ordinary, bounded steps: start five named support actors, reuse them, deliver one read-only consultation, exercise ingestion and monitoring, then clean them up.',
  'Every Agent startup task includes its exact first repository-local lifecycle command and its waiting behavior.',
  'Use the complete tool inputs shown for the current step. If a task is unclear or unsafe, stop instead of inventing a substitute.',
].join(' ');

const P5_DRIVER_CONTEXT = [
  'This conversation runs one bounded P5 mixed Claude/Codex qualification through the repository launcher.',
  'The launcher presents repository-local lifecycle CLI calls generated from the current project, PLAN, session and immutable test subject. These are the normal supported integration surfaces under test.',
  'First initialize the session and complete its returned action set. The launcher then presents one mixed-review request and one documentation consultation/status sequence using the same retained workers.',
  'Use Agent for each returned native role action. Its model-visible prompt is a concrete plain-language role task; production hooks independently validate scope and replace presentation fields with the canonical pending-action bootstrap. The managed conductor executes lifecycle and supervisor host commands directly with one-use authority; a rejection ends the run.',
].join(' ');

const P6_DRIVER_CONTEXT = [
  'This conversation qualifies one disposable L2 managed consumer whose collaboration runtime is source-referenced from the current L0 toolkit.',
  'You may use Read, Glob, or Grep to inspect the installed init-session/work command and skill documentation before using Bash. No repository edits are part of this scenario.',
  'Initialize the retained support plane, then execute the one read-only work request supplied by the launcher in the same session. Production hooks validate all lifecycle and Agent authority.',
].join(' ');

function actionRelayPrompt(envelope, relaySequence) {
  const operations = [...new Set(envelope.actions.map(actionOperation))];
  const inputs = proposedAgentInputs(envelope.actions);
  const sendMessageInputs = envelope.actions
    .filter((action) => actionOperation(action) === 'SendMessage')
    .map(canonicalSendMessageInput);
  const supervisorStartInputs = envelope.actions
    .filter((action) => actionOperation(action) === 'Bash')
    .map(canonicalSupervisorStartInput);
  const agentProposalExplanation = managedConductor
    ? 'Each Agent input below is a plain-language, read-only startup task. PreToolUse independently derives the canonical pending-action bootstrap, records the proposal and executed input separately, and denies if ownership is missing, ambiguous, stale, replayed, or out of order.'
    : 'The fixed Agent proposal prompt is a safe correlation token, not an empty worker task: PreToolUse atomically replaces the complete proposed input with the unique pending signed action payload.bootstrap_message before spawn and denies the call if that correlation is missing, ambiguous, stale, replayed, or out of order.';
  if (managedConductor && !p5Scenario) {
    return [
      `Complete repository workflow step ${relaySequence}.`,
      `The runtime returned ${envelope.actions.length} current action${envelope.actions.length === 1 ? '' : 's'} for ${envelope.entrypoint}.`,
      'Each Agent input below is a plain-language, read-only startup task and includes the exact first repository-local lifecycle command plus the expected waiting behavior.',
      'Call each listed tool once in array order with the complete supplied fields. Do not add, remove, or rename fields.',
      'Agent calls are independent and may be emitted in separate assistant messages.',
      `Agent input array (JSON): ${JSON.stringify(inputs)}`,
      `SendMessage input array (JSON): ${JSON.stringify(sendMessageInputs)}`,
      `Bash input array (JSON): ${JSON.stringify(supervisorStartInputs)}`,
      `Expected operation set: ${operations.join(',')}.`,
    ].join(' ');
  }
  if (p5Scenario) {
    return [
      `Submit validated P5 protocol sequence ${relaySequence} from the ${envelope.entrypoint} ACTION_REQUIRED result that the managed conductor executed and parsed outside the model tool plane after signed system/init validation.`,
      `This is the first model-visible work for that result; validated envelope SHA-256: ${digestObject(envelope)}.`,
      'Each action is independently authorized by current repository state and remains at-most-once for this session.',
      'Use Agent once for each Agent proposal and Bash once for each supervisor-start command, preserving the returned action order. Production hooks validate and canonicalize the owning calls before execution.',
      'Each Agent input below is a concrete plain-language task. PreToolUse independently derives the canonical pending-action bootstrap, records the proposal and executed input separately, and denies if unique ownership is unavailable.',
      'Agent calls are independent and may be emitted in separate assistant messages.',
      `Agent proposal input array (JSON): ${JSON.stringify(inputs)}`,
      `Canonical SendMessage input array (JSON): ${JSON.stringify(sendMessageInputs)}`,
      `Canonical Bash input array (JSON): ${JSON.stringify(supervisorStartInputs)}`,
      `Expected operation set: ${operations.join(',')}.`,
    ].join(' ');
  }
  return [
    `Execute the validated P4 sequence ${relaySequence} action set below.`,
    `The managed conductor executed ${envelope.entrypoint} directly after validating this session's signed system/init identity, parsed its ACTION_REQUIRED stdout, and derived this closed set; host-command stdout is intentionally outside the model tool plane.`,
    `This is the first model-visible work for that result and the current bounded instruction; validated envelope SHA-256: ${digestObject(envelope)}.`,
    'Each action_id is at-most-once for this session. If every action in this exact set already executed before this queued message became active, make no tool call and end this turn; the launcher will validate that completed batch and re-enter the entrypoint.',
    'Call the stated tool once for every array entry, in array order, using the supplied fields.',
    'Production hooks independently validate, canonicalize, reserve, and correlate each call; a rejected call ends this step.',
    agentProposalExplanation,
    'Agent calls are independent and may be emitted in separate assistant messages.',
    `Agent proposal input array (JSON): ${JSON.stringify(inputs)}`,
    `Canonical SendMessage input array (JSON): ${JSON.stringify(sendMessageInputs)}`,
    'For each SendMessage action in this closed validated set only, call SendMessage once with the corresponding complete three canonical fields. Do not deliberately add or alter transport alias fields or relay any content not present in that validated input.',
    `Canonical Bash input array (JSON): ${JSON.stringify(supervisorStartInputs)}`,
    'For each Bash supervisor-start action in this closed validated set only, call Bash once with the corresponding exact command and run_in_background=true. Do not execute, rewrite, quote, prefix, suffix, or combine the command outside that Bash call.',
    `Expected operation set: ${operations.join(',')}.`,
  ].join(' ');
}

function commandForEntrypoint(entrypointName) {
  if (entrypointName === 'init-session') return initCommand;
  if (entrypointName === 'work') return workCommand;
  return null;
}

function commandPrompt(entrypointName) {
  const command = commandForEntrypoint(entrypointName);
  const intentNote = entrypointName === 'init-session'
    ? 'The intent argument is the base64url encoding of exactly {"mode":"start"}; the command below is the complete bounded test step.'
    : 'The launcher already constructed and validated every encoded argument; no separate decoding or probe is part of this test step.';
  return [
    `Run this deterministic P4 protocol step as one repository-local ${entrypointName} Bash call.`,
    intentNote,
    ...(entrypointName === 'init-session' ? [
      'If this exact command returns ACTION_REQUIRED, that result is the expected repository-local protocol response for this same test. Execute only the closed Agent action set when the launcher relays it, preserving its order and canonical fields.',
      'The later Agent proposal contains no bootstrap payload; the production gate derives the canonical bootstrap from the unique pending owning action.',
    ] : []),
    '',
    command,
  ].join('\n');
}

// P4-U1 full-scenario-only re-entry: these stage commands are queued by exact
// command text. resume-work may now produce its five correlated SendMessage
// actions; after that relay, this same map re-enters the exact resume command
// until the durable checkpoint completion is observed.
function directCommandPrompt(command) {
  return [
    'Run this next deterministic P4 protocol step as one standalone repository-local Bash call.',
    'The launcher already constructed and validated every encoded argument; no preliminary tool call, separate decoding, or probe is part of this step.',
    '',
    command,
  ].join('\n');
}

function p5CommandPrompt(command, purpose) {
  return [
    'Use Bash to invoke the repository-local lifecycle CLI command below for the current P5 integration step.',
    `Purpose: ${purpose}`,
    'The command operates on the current repository\'s confined runtime coordination state. Production hooks validate its project, session, PLAN and lifecycle authority before execution.',
    '',
    command,
  ].join('\n');
}

function p6InitialPrompt() {
  return [
    'Initialize this disposable L2 consumer through its installed source-referenced runtime.',
    'You may first read the installed init-session command or skill documentation in this consumer. Then use its documented canonical Bash entrypoint for explicit start mode.',
    'The launcher will validate the resulting call and relay any ACTION_REQUIRED role actions. This qualification is read-only and production hooks remain authoritative.',
    'Canonical entrypoint expected after documentation inspection:',
    '',
    initCommand,
  ].join('\n');
}

function p6WorkPrompt() {
  return [
    'Run the single read-only managed-consumer work consultation now that the support plane is ready.',
    'The task verifies that the consumer PLAN and marker belong to this L2 root while executable runtime assets remain in the source-referenced L0 toolkit. Production hooks validate the call and its returned owning actions.',
    'Canonical work entrypoint:',
    '',
    workCommand,
  ].join('\n');
}

function reentryPrompt(entrypointName) {
  if (!fullScenario) return commandPrompt(entrypointName);
  const commandByStage = {
    bootstrap: initCommand,
    'second-ensure': initCommand,
    resume: resumeCommand,
    work: workCommand,
    'ingest-denied': ingestDeniedCommand,
    'ingest-approved': ingestApprovedCommand,
    monitor: monitorCommand,
  };
  const command = commandByStage[p4Stage];
  if (!command) return null;
  return directCommandPrompt(command);
}

function hostProbePrompt() {
  return [
    'Execute this disposable read-only host capability probe exactly once. Do not edit files and do not use Bash.',
    `First call Agent in the background with this five-key input: ${JSON.stringify(probePeerInputs['probe-peer-a'])}`,
    'Retain the real native agent ID returned by the host and wait for its completed notification before continuing.',
    `Then call SendMessage with to="probe-peer-a", summary="Resume probe-peer-a with retained context", and message="Resume now and read ${path.join(runRoot, `${probeNonce}.txt`)} using Read, then finish." Do not add alias fields or set notify_when_idle.`,
    'Wait for the resumed same actor to finish. The captured hooks must prove continuity from the unchanged native agent ID; never create a replacement actor.',
    `Then call Agent in the foreground with this five-key input: ${JSON.stringify(probePeerInputs['probe-peer-b'])}`,
    'Wait for it to finish, then respond exactly HOST_PROBE_COMPLETE. Never reveal native actor IDs and never create a replacement for actor A.',
  ].join('\n');
}

const MANAGED_STREAM_HANDSHAKE = [
  'Open this fresh no-persistence test conversation.',
  'Do not use a tool on this turn; reply READY_FOR_FIRST_STEP.',
  'The first repository workflow step will arrive in the next message.',
].join(' ');

const firstMessage = {
  type: 'user',
  message: { role: 'user', content: [{
    type: 'text',
    text: managedConductor
      ? MANAGED_STREAM_HANDSHAKE
      : operation === 'host-contract-probe'
      ? hostProbePrompt()
      : p5Scenario
        ? p5CommandPrompt(initCommand, 'initialize the repository runtime session in explicit start mode; ACTION_REQUIRED is the normal response when retained roles must be started.')
        : p6Scenario
          ? p6InitialPrompt()
          : commandPrompt('init-session'),
  }] },
};

writeState();
fs.writeFileSync(transcriptPath, '', { flag: 'wx' });
fs.writeFileSync(stderrPath, '', { flag: 'wx' });
fs.writeFileSync(path.join(runRoot, 'sequence-0-input.jsonl'), `${JSON.stringify(firstMessage)}\n`, { flag: 'wx' });
if (operation === 'host-contract-probe') {
  fs.writeFileSync(path.join(runRoot, 'probe-manifest.json'), `${JSON.stringify({
    schema: 'runtime/claude-host-contract-probe-manifest/v1',
    actions: probePeerInputs,
  }, null, 2)}\n`, { flag: 'wx' });
  fs.writeFileSync(path.join(runRoot, `${probeNonce}.txt`), `${probeNonce}\n`, { flag: 'wx' });
  fs.writeFileSync(path.join(runRoot, 'probe-a-one.txt'), 'probe-a-one\n', { flag: 'wx' });
  fs.writeFileSync(path.join(runRoot, 'probe-a-two.txt'), 'probe-a-two\n', { flag: 'wx' });
  fs.writeFileSync(path.join(runRoot, 'probe-b-one.txt'), 'probe-b-one\n', { flag: 'wx' });
}
if (fullScenario) {
  // The conductor creates only this run-scoped input manifest; it never
  // fabricates the ingestion product result itself (PLAN.md ~L680).
  fs.writeFileSync(path.join(runRoot, 'p4-ingestion-input-manifest.json'), `${JSON.stringify({
    schema: 'androidcommondoc/p4-ingestion-input-manifest/v1',
    request_ref: ingestRequestRefArg,
    approval_ref: ingestApprovalRefArg,
  }, null, 2)}\n`, { flag: 'wx' });
}

const env = { ...process.env };
delete env.ANTHROPIC_API_KEY;
delete env.ANTHROPIC_AUTH_TOKEN;
delete env.CLAUDE_CONFIG_DIR;
delete env.CLAUDE_CODE_SAFE_MODE;
env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = '1';
env.TEMP = runRoot;
env.TMP = runRoot;
env.TMPDIR = runRoot;

let childCommand = process.execPath;
let childArgs = [selectedChild, '--session-id', sessionId, '--operation', operation, '--probe-nonce', probeNonce];
let childCwd = projectRoot;
if (transportProfile === 'native-claude-cli') {
  // Use the documented per-session CLI selector. Claude Code 2.1.261 does not
  // emit effort in every assistant stream frame, so the exact child argv is
  // the deterministic control; any optional emitted telemetry is cross-checked.
  const isHostProbeLaunch = operation === 'host-contract-probe';
  const observerPath = path.join(toolkitRoot, 'scripts', 'tests', 'fixtures', isHostProbeLaunch
    ? 'claude-host-contract-probe.cjs'
    : 'claude-entrypoint-observer.cjs');
  const quoteCommandArg = (value) => `"${String(value).replaceAll('"', '\\"')}"`;
  const observerCommand = [entrypointNodeExecutable, observerPath, '--root', runRoot, '--evidence-mode', 'genuine-pinned']
    .map(quoteCommandArg).join(' ');
  const commandHook = { type: 'command', command: observerCommand, timeout: 30 };
  const observedHookEvents = ['SessionStart', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'SubagentStart', 'SubagentStop'];
  const settingsPath = path.join(runRoot, 'settings.json');
  const baseArgv = [
    '-p', '--verbose', '--input-format', 'stream-json', '--output-format', 'stream-json',
    '--include-hook-events', '--replay-user-messages', '--no-session-persistence',
    '--session-id', sessionId, '--model', requestedModel, '--effort', 'high',
      '--settings', settingsPath, '--setting-sources', '', '--strict-mcp-config',
  ];
  let nativeArgv;
  if (isHostProbeLaunch) {
    const hooks = {};
    for (const eventName of observedHookEvents) {
      hooks[eventName] = [{ matcher: eventName === 'SessionStart' ? 'startup' : '.*', hooks: [commandHook] }];
    }
    writeJson(settingsPath, { hooks });
    const agents = {
      'probe-peer': {
        description: 'Disposable read-only host contract peer.',
        prompt: 'Follow the supplied probe prompt exactly. Use only Read. Never edit or execute commands.',
        tools: ['Read'],
      },
    };
    nativeArgv = [
      ...baseArgv,
      '--permission-mode', 'dontAsk', '--permission-prompts', 'none', '--restricted',
      '--tools', 'Agent,SendMessage,Read,Bash', '--agents', JSON.stringify(agents),
    ];
    childCwd = runRoot;
  } else {
    const projectSettingsPath = path.join(projectRoot, '.claude', 'settings.json');
    const projectSettings = JSON.parse(fs.readFileSync(projectSettingsPath, 'utf8'));
    const runScopedHooks = { ...projectSettings.hooks };
    for (const eventName of observedHookEvents) {
      const existing = Array.isArray(runScopedHooks[eventName]) ? runScopedHooks[eventName] : [];
      runScopedHooks[eventName] = [...existing, { matcher: '.*', hooks: [commandHook] }];
    }
    writeJson(settingsPath, {
      ...projectSettings,
      autoMemoryEnabled: false,
      enabledPlugins: {},
      hooks: runScopedHooks,
    });
    nativeArgv = [
      ...baseArgv,
      '--append-system-prompt', p5Scenario
        ? P5_DRIVER_CONTEXT
        : p6Scenario ? P6_DRIVER_CONTEXT : P4_DRIVER_CONTEXT,
      '--permission-mode', 'bypassPermissions', '--permission-prompts', 'none',
      '--tools', p6Scenario ? 'Agent,Bash,SendMessage,Read,Glob,Grep' : 'Agent,Bash,SendMessage',
      '--agents', JSON.stringify(nativeSupportAgents.definitions),
    ];
    childCwd = projectRoot;
  }
  state.native_argv = nativeArgv;
  if (nativeFixtureChild) {
    childCommand = process.execPath;
    childArgs = [nativeFixtureChild, ...nativeArgv];
    env.P4_CERT_FAKE_OPERATION = operation;
    env.P4_CERT_FAKE_PROBE_NONCE = probeNonce;
    if (p5Scenario) env.P5_CERT_FAKE_SCENARIO = '1';
    if (p6Scenario) env.P6_CERT_FAKE_SCENARIO = '1';
  } else {
    childCommand = nativeClaudeExecutable;
    childArgs = nativeArgv;
  }
  state.execution_mode = nativeClaudeExecutable
    ? (isHostProbeLaunch ? 'NATIVE_HOST_CONTRACT_PROBE' : 'NATIVE_ENTRYPOINT_PROTOCOL')
    : 'OFFLINE_NATIVE_PROFILE_SIMULATION';
  state.host_capability = nativeClaudeExecutable && isHostProbeLaunch ? 'PENDING_NATIVE_EVIDENCE' : 'NOT_HOST_EVIDENCE';
  state.session_transcript_policy = 'no-persistence-defensive-cleanup';
  if (!isHostProbeLaunch) {
    state.native_entrypoint_evidence_policy = nativeClaudeExecutable
      ? 'MANAGED_IDENTITY_RECORDING_REQUIRED'
      : 'NO_PRODUCTION_AUTHORITY_OFFLINE_SIMULATION';
  }
  state.cli_pin = nativeClaudeExecutable ? {
    version: path.basename(fs.realpathSync(nativeClaudeExecutable)),
    executable_realpath: fs.realpathSync(nativeClaudeExecutable),
    executable_sha256: crypto.createHash('sha256').update(fs.readFileSync(nativeClaudeExecutable)).digest('hex'),
    requested_model: requestedModel,
    effort_requested: 'high',
    effort_effective: 'high',
    effort_control: '--effort',
    effort_expected_observed: 'high',
    effort_observed: null,
    foreground: true,
    persistence: 'no-session-persistence',
  } : null;
  state.native_settings_path = settingsPath;
  writeState();
}

// -- Current-PREP launch precondition ----------------------------------------
// A full P4 scenario ends in an APPROVED ingestion whose correlated result the retained
// doc-updater must actually WRITE. That write passes through the production
// premature-execution-gate, which requires an APPROVED-PREP arch verdict bound to the
// exact current PLAN bytes and to a PREP-HEAD that is an ancestor of HEAD. With no such
// verdict on disk the write is blocked deterministically, no correlated result can ever
// appear, and the run burns a genuine Claude session to discover it. Assert exactly the
// condition the gate asserts, from disk, BEFORE anything is spawned. This mirrors
// .claude/hooks/premature-execution-gate.js and never relaxes it.
const CURRENT_PREP_VERDICT_FILENAME = /^(?:pr\d+-)?arch-[a-z]+-verdict\.md$/;

function evaluateCurrentPrepPreflight(root) {
  let plan;
  try {
    plan = require('../lib/runtime-role-lifecycle.cjs').discoverPlan(root);
  } catch (error) {
    return { clear: false, reason: 'plan-not-discoverable', detail: String(error && error.message) };
  }
  if (!plan || plan.ok !== true) return { clear: false, reason: 'plan-not-discoverable' };
  const waveDir = path.dirname(plan.planPath);
  const headProbe = spawnSync('git', ['rev-parse', 'HEAD'],
    { cwd: root, timeout: 5000, encoding: 'utf8', windowsHide: true });
  const head = headProbe.status === 0 ? String(headProbe.stdout || '').trim() : '';
  if (!/^[0-9a-f]{40}$/.test(head)) return { clear: false, reason: 'git-head-unresolvable' };
  let entries;
  try { entries = fs.readdirSync(waveDir); } catch { entries = []; }
  const examined = [];
  for (const entry of entries.slice().sort()) {
    if (!CURRENT_PREP_VERDICT_FILENAME.test(entry)) continue;
    let content;
    try { content = fs.readFileSync(path.join(waveDir, entry), 'utf8'); } catch { continue; }
    if (!/APPROVED-PREP/.test(content)) {
      examined.push({ verdict: entry, rejected: 'no-approved-prep-token' });
      continue;
    }
    const planMatch = content.match(/^\*\*PLAN_SHA256\*\*:\s*([0-9a-f]{64})\s*$/m);
    const headMatch = content.match(/^\*\*PREP-HEAD\*\*:\s*([0-9a-f]{40})\s*$/m);
    if (!planMatch || !headMatch) {
      examined.push({ verdict: entry, rejected: 'missing-binding-header' });
      continue;
    }
    if (planMatch[1] !== plan.planDigest) {
      examined.push({ verdict: entry, rejected: 'stale-plan-binding', bound_plan_sha256: planMatch[1] });
      continue;
    }
    const ancestry = spawnSync('git', ['merge-base', '--is-ancestor', headMatch[1], head],
      { cwd: root, timeout: 5000, windowsHide: true });
    if (ancestry.status !== 0) {
      examined.push({ verdict: entry, rejected: 'prep-head-not-ancestor', bound_prep_head: headMatch[1] });
      continue;
    }
    return {
      clear: true,
      reason: 'current-prep-present',
      evaluated_root: root,
      wave_dir: waveDir,
      plan_sha256: plan.planDigest,
      head,
      verdict: entry,
      prep_head: headMatch[1],
      examined,
    };
  }
  return {
    clear: false,
    reason: 'no-current-prep-verdict',
    evaluated_root: root,
    wave_dir: waveDir,
    plan_sha256: plan.planDigest,
    head,
    examined,
  };
}

if (fullScenario && (nativeClaudeExecutable || prepPreflightRootArg)) {
  if (prepPreflightRootArg && nativeClaudeExecutable) {
    process.stderr.write('--prep-preflight-root cannot redirect a genuine native certification.\n');
    process.exit(64);
  }
  const prepRoot = prepPreflightRootArg ? path.resolve(prepPreflightRootArg) : projectRoot;
  const prepPreflight = evaluateCurrentPrepPreflight(prepRoot);
  state.current_prep_preflight = prepPreflight;
  if (!prepPreflight.clear) {
    state.status = 'MISSING_CURRENT_PREP';
    state.invalidation_reason = `current PREP preflight failed: ${prepPreflight.reason}`;
    state.finished_at = new Date().toISOString();
    writeState();
    process.stderr.write(`P4_LIVE_STATE=${statePath}\n`);
    process.stderr.write(`${state.invalidation_reason}\n`);
    process.exit(1);
  }
  writeState();
}

if (nativeClaudeExecutable && operation === 'entrypoint-protocol') {
  const rll = require('../lib/runtime-role-lifecycle.cjs');
  const worktreeId = rll.computeWorktreeId(projectRoot);
  const plan = rll.discoverPlan(projectRoot);
  const existing = plan.ok
    ? rll.findLiveMainOrchestratorBindingForScope(projectRoot, worktreeId, plan.planDigest)
    : { ok: false, reason: 'plan-not-discoverable' };
  state.native_session_authority_preflight = {
    clear: existing.ok === false && existing.reason === 'main-binding-scope-none',
    reason: existing.ok ? 'main-binding-scope-occupied' : existing.reason,
  };
  if (!state.native_session_authority_preflight.clear) {
    state.status = 'HOST_REGISTRY_NOT_FRESH';
    state.invalidation_reason = `native authority preflight failed: ${state.native_session_authority_preflight.reason}`;
    state.finished_at = new Date().toISOString();
    writeState();
    process.stderr.write(`P4_LIVE_STATE=${statePath}\n`);
    process.stderr.write(`${state.invalidation_reason}\n`);
    process.exit(1);
  }
  writeState();
}

const child = spawn(childCommand, childArgs, {
  cwd: childCwd,
  env,
  stdio: ['pipe', 'pipe', 'pipe'],
  windowsHide: true,
});
state.pid = child.pid;
state.status = 'ACTIVE';
state.attempts = [{
  attempt: 1,
  profile: transportProfile,
  operation,
  genuine_native: Boolean(nativeClaudeExecutable),
  pid: child.pid,
  started_at: new Date().toISOString(),
}];
writeState();
process.stderr.write(`P4_LIVE_STATE=${statePath}\n`);
process.stderr.write(`P4_LIVE_UUID=${sessionId}\n`);
process.stderr.write(`P4_LIVE_PID=${child.pid}\n`);

let firstToolObserved = false;
let managedHandshakePending = managedConductor;
let pending = null;
let actionInterrupt = null;
const rootSourceNestedProtocols = new Map();
// P4-U1 full-scenario-only cursor through the closed stage table below;
// unused (stays 'bootstrap') whenever fullScenario is false.
let p4Stage = 'bootstrap';
let p4CleanupIndex = 0;
let p5Stage = p5Scenario ? 'bootstrap' : null;
let p5ReadbackTimer = null;
let p5ReviewerSnapshot = null;
let p5DocsPollCount = 0;
let stdinClosedAfterTerminal = false;
let pendingWrites = 0;
let stderrBuffer = '';
let emptyPollCount = 0;
let terminalShutdownTimer = null;
let directActionBatch = null;
const deliveredManagedActionSetDigests = new Set();
// A supervisor-start action stays pending in ensure()'s projection until its worker
// registers READY, so the same action id is re-emitted while the bridge is still coming up.
// Executing it twice re-mints its execution claim and fails execution-claim-already-issued,
// which is what ended a live P5 attempt. Remember what this run already launched.
const executedSupervisorStartActionIds = new Set();
// Lifecycle progress epoch: advances ONLY when an entrypoint returns a non-ACTION_REQUIRED
// result (READY/BLOCKED/COMPLETED), i.e. when the protocol actually moved. Repeat detection
// is scoped to one epoch so a legitimate later re-delivery after real progress stays legal.
let managedProgressEpoch = 0;
const managedDeliveredIdentities = new Map();
const directRoleHostsByRole = new Map();
const directRoleHostsBySession = new Map();
let launcherFatalHandling = false;
process.on('uncaughtException', (error) => {
  if (launcherFatalHandling) {
    process.exitCode = 1;
    return;
  }
  launcherFatalHandling = true;
  try {
    fail('INVALID_LAUNCHER_EXCEPTION', error && error.stack ? error.stack : String(error));
  } catch {
    closeDirectRoleHostsNow();
    child.kill();
  }
  process.exitCode = 1;
});
const pollScheduleSeconds = [1, 2, 4, 5, 5];
// PLAN.md ~L136/L986: "Empty-action polling uses delays 1, 2, 4, 5 and 5 seconds and is bounded by
// the maximum expires_at of the last relayed action set", and "Recheck init-session until READY...
// Total polling is bounded by the existing request/operation expiry, not an invented process
// timer." The delays are the ramp, capped at 5 seconds -- they were never the budget. Treating the
// ramp's length as the budget is exactly the invented process timer the PLAN forbids, and it is
// far too short for a Codex-backed supervisor start, which must bring a real app-server worker up
// per role (isolation root, ACLs, config, spawn, provenance, initialize, login, thread start and a
// bootstrap turn) before init-session can report READY.
let lastRelayedActionExpiryMs = null;
// A result frame can become readable before immediately-following assistant
// frames from the same host turn. Give the pipe one short, bounded settling
// window before declaring an incomplete Agent batch. This is not a session or
// task timeout; it applies only after a terminal frame has already arrived.
const incompleteAgentFrameGraceMs = 250;
const offlinePollScaleMs = (() => {
  const parsed = Number.parseInt(process.env.P4_CERT_OFFLINE_POLL_SCALE_MS || '1000', 10);
  return operation === 'entrypoint-protocol'
    && transportProfile === 'offline-fake-child'
    && Number.isInteger(parsed) && parsed >= 1
    ? parsed
    : 1000;
})();
const directRoleTeardownMs = (() => {
  const parsed = Number.parseInt(process.env.P4_CERT_DIRECT_ROLE_TEARDOWN_MS || '10000', 10);
  return Number.isInteger(parsed) && parsed >= 100 ? parsed : 10_000;
})();
state.effective_poll_scale_ms = offlinePollScaleMs;
writeState();

function observeManagedChildBirth(pid) {
  if (nativeFixtureChild) return `offline-fixture:${pid}`;
  if (process.platform === 'win32') {
    const observed = require('../lib/runtime-bridge-codex.cjs').observeWindowsProcessBirth(pid);
    return observed && observed.status === 'PRESENT' ? observed.birthToken : null;
  }
  const observed = spawnSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
    encoding: 'utf8', windowsHide: true,
  });
  const value = observed.status === 0 ? String(observed.stdout || '').trim() : '';
  return value || null;
}

function directRoleFrame(roleHost, frame) {
  roleHost.sequence += 1;
  return {
    type: 'user',
    message: { role: 'user', content: [{ type: 'text', text: frame }] },
  };
}

function writeDirectRoleMessage(roleHost, text, kind, action, callback) {
  if (roleHost.turn) return fail('INVALID_DIRECT_ROLE_TRANSPORT',
    `role ${roleHost.role} received overlapping turns.`);
  const frame = directRoleFrame(roleHost, text);
  roleHost.turn = {
    kind,
    action,
    messageDigest: digestObject(frame.message),
    echoObserved: false,
    firstToolObserved: false,
    firstToolExact: false,
    toolCount: 0,
    assistantText: [],
    onEcho: null,
    deferPark: false,
    callback,
  };
  fs.writeFileSync(path.join(runRoot,
    `direct-role-${roleHost.role}-${roleHost.sessionId}-sequence-${roleHost.sequence}.jsonl`),
  `${JSON.stringify(frame)}\n`, { flag: 'wx' });
  writeJsonlFrame(roleHost.child.stdin, frame, (error) => {
    if (error) fail('INVALID_DIRECT_ROLE_TRANSPORT', error.message);
  });
}

function writeDirectRoleConsultation(roleHost, text, action, onEcho, callback) {
  writeDirectRoleMessage(roleHost, text, 'delivery', action, callback);
  if (roleHost.turn) {
    roleHost.turn.onEcho = onEcho;
    // The target remains BUSY until its signed result is published. Parking it
    // before the target-side publish would make the runtime state lie about
    // which actor currently owns the consultation.
    roleHost.turn.deferPark = true;
  }
}

function finishDirectRoleTurn(roleHost, event) {
  const turnState = roleHost.turn;
  if (!turnState) return fail('INVALID_DIRECT_ROLE_TRANSPORT',
    `role ${roleHost.role} emitted an unsolicited result.`);
  if (event.is_error === true || event.subtype === 'error_during_execution') {
    return fail('INVALID_DIRECT_ROLE_RESULT', `role ${roleHost.role} returned an error result.`);
  }
  if (!turnState.echoObserved) {
    return fail('INVALID_DIRECT_ROLE_ECHO', `role ${roleHost.role} did not echo the exact delivered user frame.`);
  }
  if (turnState.kind === 'activation') {
    if (!roleHost.initObserved || turnState.toolCount !== 0) {
      return fail('INVALID_DIRECT_ROLE_ACTIVATION',
        `role ${roleHost.role} did not complete a tool-free orientation turn.`);
    }
    roleHost.turn = null;
    writeState();
    if (nativeClaudeExecutable) {
      const admitted = require('../lib/runtime-role-lifecycle.cjs').admitDirectRoleHostStartup(
        projectRoot,
        {
          family: 'direct-role-host',
          sessionId,
          agentId: roleHost.sessionId,
          agentType: roleHost.role,
          actionId: roleHost.action.action_id,
        },
        roleHost.action.action_id,
      );
      if (!admitted.ok) return fail('INVALID_DIRECT_ROLE_ADMISSION',
        `role ${roleHost.role} host admission failed: ${admitted.reason}`);
      roleHost.actorBinding = admitted.actorBinding || null;
      roleHost.rootSourceBinding = admitted.rootSourceBinding || null;
    }
    if (roleHost.action.kind === 'role-spawn') {
      if (nativeClaudeExecutable) {
        const parked = require('../lib/runtime-role-lifecycle.cjs').parkClaudeResumeHandleForRoleActor(projectRoot, {
          sessionId,
          agentId: roleHost.sessionId,
          agentType: roleHost.role,
        });
        if (!parked.ok) return fail('INVALID_DIRECT_ROLE_PARK',
          `role ${roleHost.role} could not be parked: ${parked.reason}`);
        roleHost.resumeHandleId = parked.record.binding_id;
      }
      state.actions.push({
        action_id: roleHost.action.action_id,
        family: roleHost.action.kind,
        role: roleHost.role,
        direct_session_digest: sha256String(roleHost.sessionId),
        delivered_message_digest: turnState.messageDigest,
        echoed_exact: turnState.echoObserved,
        first_tool_exact: null,
        tool_count: turnState.toolCount,
        startup_mode: 'host-admission',
        accepted: true,
      });
      writeState();
      return setImmediate(roleHost.onReady);
    }
    return setImmediate(() => executeManagedRootSource(roleHost, roleHost.onReady));
  }
  if (turnState.kind === 'bootstrap' && (!turnState.firstToolObserved || !turnState.firstToolExact)) {
    return fail('INVALID_DIRECT_ROLE_FIRST_TOOL',
      `role ${roleHost.role} did not execute the action-derived Bash command first.`);
  }
  if (turnState.kind === 'bootstrap' && turnState.action.kind === 'role-spawn'
      && nativeClaudeExecutable) {
    const parked = require('../lib/runtime-role-lifecycle.cjs').parkClaudeResumeHandleForRoleActor(projectRoot, {
      sessionId,
      agentId: roleHost.sessionId,
      agentType: roleHost.role,
    });
    if (!parked.ok) return fail('INVALID_DIRECT_ROLE_PARK',
      `role ${roleHost.role} could not be parked: ${parked.reason}`);
    roleHost.resumeHandleId = parked.record.binding_id;
  } else if (turnState.kind === 'delivery' && nativeClaudeExecutable && !turnState.deferPark) {
    const parked = require('../lib/runtime-role-lifecycle.cjs').parkClaudeResumeHandleForRoleActor(projectRoot, {
      sessionId,
      agentId: roleHost.sessionId,
      agentType: roleHost.role,
    });
    if (!parked.ok) return fail('INVALID_DIRECT_ROLE_PARK',
      `role ${roleHost.role} could not be re-parked: ${parked.reason}`);
    roleHost.resumeHandleId = parked.record.binding_id;
  }
  const actionRecord = {
    action_id: turnState.action.action_id,
    family: turnState.action.kind,
    role: roleHost.role,
    direct_session_digest: sha256String(roleHost.sessionId),
    delivered_message_digest: turnState.messageDigest,
    echoed_exact: turnState.echoObserved,
    first_tool_exact: turnState.kind === 'bootstrap' ? turnState.firstToolExact : null,
    startup_mode: turnState.kind === 'bootstrap' ? 'role-tool' : null,
    tool_count: turnState.toolCount,
    accepted: true,
  };
  if (turnState.kind === 'bootstrap') state.actions.push(actionRecord);
  else state.direct_role_deliveries.push(actionRecord);
  const callback = turnState.callback;
  const turnResult = { assistantText: turnState.assistantText.join('\n') };
  const oneShot = turnState.action.kind === 'root-source-spawn';
  roleHost.turn = null;
  writeState();
  if (oneShot) roleHost.child.stdin.end();
  setImmediate(() => callback(turnResult));
}

function directRoleInitProjection(event) {
  return {
    session_id: event.session_id,
    cwd: path.resolve(event.cwd || ''),
    model: event.model,
    tools: event.tools,
    mcp_servers: event.mcp_servers,
    agents: event.agents,
    permissionMode: event.permissionMode,
    claude_code_version: event.claude_code_version,
    capabilities: event.capabilities,
    messaging_socket_path: event.messaging_socket_path,
  };
}

function handleDirectRoleFrame(roleHost, event) {
  if (!event || (typeof event.session_id === 'string' && event.session_id !== roleHost.sessionId)) {
    return fail('INVALID_DIRECT_ROLE_SESSION', `role ${roleHost.role} emitted a foreign session frame.`);
  }
  if (event.type === 'system' && event.subtype === 'init' && !roleHost.initObserved) {
    const tools = Array.isArray(event.tools) ? event.tools : [];
    const expectedTools = [...roleHost.tools].sort();
    const observedTools = [...tools].sort();
    const observedMcpServers = Array.isArray(event.mcp_servers)
      ? event.mcp_servers.map((server) => server && server.name).filter(Boolean).sort()
      : null;
    const valid = event.session_id === roleHost.sessionId
      && path.resolve(event.cwd || '') === projectRoot
      && typeof event.model === 'string' && event.model.length > 0
      && JSON.stringify(observedTools) === JSON.stringify(expectedTools)
      && JSON.stringify(observedMcpServers) === JSON.stringify(roleHost.expectedMcpServers)
      && !tools.includes('Agent') && !tools.includes('Task')
      && Array.isArray(event.agents)
      && event.agents.includes(roleHost.role);
    if (!valid) return fail('INVALID_DIRECT_ROLE_INIT',
      `role ${roleHost.role} system/init violated its restricted projection.`);
    if (nativeClaudeExecutable) {
      const birth = observeManagedChildBirth(roleHost.child.pid);
      if (!birth) return fail('INVALID_DIRECT_ROLE_IDENTITY',
        `role ${roleHost.role} process birth was unavailable.`);
      const recorded = require('../lib/runtime-host-claude.cjs').recordDirectRoleHostIdentity({
        projectRoot,
        parentSessionId: sessionId,
        role: roleHost.role,
        action: roleHost.action,
        definitionDigest: roleHost.definitionDigest,
        launchArgv: roleHost.argv,
        event,
        processId: roleHost.child.pid,
        processBirth: birth,
      });
      if (!recorded.ok) return fail('INVALID_DIRECT_ROLE_IDENTITY',
        `role ${roleHost.role} identity could not be signed: ${recorded.reason}`);
    }
    roleHost.initProjectionDigest = digestObject(directRoleInitProjection(event));
    roleHost.initObserved = true;
    state.direct_role_hosts.push({
      role: roleHost.role,
      action_id: roleHost.action.action_id,
      action_kind: roleHost.action.kind,
      session_digest: sha256String(roleHost.sessionId),
      process_id: roleHost.child.pid,
      definition_digest: roleHost.definitionDigest,
      tools,
      init_validated: true,
      mcp_toolkit_root: roleHost.mcpToolkitRoot || null,
      persistent: roleHost.action.kind === 'role-spawn',
    });
    writeState();
    return;
  }
  if (event.type === 'system' && event.subtype === 'init' && roleHost.initObserved) {
    if (digestObject(directRoleInitProjection(event)) !== roleHost.initProjectionDigest) {
      return fail('INVALID_DIRECT_ROLE_INIT_DRIFT',
        `role ${roleHost.role} repeated system/init with a changed identity projection.`);
    }
    return;
  }
  const turnState = roleHost.turn;
  if (event.type === 'user' && turnState && event.message
      && Array.isArray(event.message.content)
      && event.message.content.some((block) => block && block.type === 'text')) {
    if (digestObject(event.message) !== turnState.messageDigest) {
      return fail('INVALID_DIRECT_ROLE_ECHO', `role ${roleHost.role} echoed changed user bytes.`);
    }
    const firstEcho = !turnState.echoObserved;
    turnState.echoObserved = true;
    if (firstEcho && typeof turnState.onEcho === 'function') {
      const onEcho = turnState.onEcho;
      turnState.onEcho = null;
      onEcho();
    }
  }
  if (event.type === 'assistant' && event.message && Array.isArray(event.message.content)) {
    for (const block of event.message.content) {
      if (turnState && block && block.type === 'text' && typeof block.text === 'string') {
        turnState.assistantText.push(block.text);
      }
      if (!block || block.type !== 'tool_use') continue;
      if (!turnState) return fail('INVALID_DIRECT_ROLE_TOOL',
        `role ${roleHost.role} emitted a tool without an active turn.`);
      turnState.toolCount += 1;
      if (['Agent', 'Task'].includes(block.name)
          || (block.name === 'SendMessage' && roleHost.action.kind === 'role-spawn')) {
        return fail('INVALID_DIRECT_ROLE_TOOL', `role ${roleHost.role} attempted forbidden ${block.name}.`);
      }
      if (!turnState.firstToolObserved) {
        turnState.firstToolObserved = true;
        const expected = turnState.kind === 'bootstrap'
          ? firstBootstrapCommand(turnState.action) : null;
        turnState.firstToolExact = expected !== null && block.name === 'Bash'
          && block.input && block.input.command === expected;
      }
    }
  }
  if (event.type === 'result') finishDirectRoleTurn(roleHost, event);
}

function launchManagedDirectRole(action, callback) {
  const role = action && action.payload && action.payload.agent_type;
  const projected = directRoleDefinition(role, action);
  const persistent = action && action.kind === 'role-spawn';
  if (!projected || !firstBootstrapCommand(action)) {
    return fail('INVALID_DIRECT_ROLE_ACTION', `action ${action && action.action_id} has no valid direct-role projection.`);
  }
  if (persistent && directRoleHostsByRole.has(role)) {
    return fail('INVALID_DIRECT_ROLE_REPLAY', `role ${role} already has a managed direct host.`);
  }
  const roleSessionId = crypto.randomUUID();
  if (nativeClaudeExecutable) {
    const reserved = require('../lib/runtime-host-claude.cjs').reserveDirectRoleHostLaunch({
      projectRoot, parentSessionId: sessionId, roleSessionId, action,
    });
    if (!reserved.ok) return fail('INVALID_DIRECT_ROLE_RESERVATION',
      `action ${action.action_id} could not be reserved: ${reserved.reason}`);
  }
  const definitionMap = { [role]: projected.definition };
  const directMcpConfig = role === 'doc-updater' ? {
    mcpServers: {
      androidcommondoc: {
        type: 'stdio',
        command: entrypointNodeExecutable,
        args: [path.join(toolkitRoot, 'mcp-server', 'build', 'index.js')],
      },
    },
  } : null;
  const argv = [
    '-p', '--verbose', '--input-format', 'stream-json', '--output-format', 'stream-json',
    '--include-hook-events', '--replay-user-messages', '--no-session-persistence',
    '--session-id', roleSessionId, '--model', requestedModel, '--effort', 'high',
    '--agent', role, '--agents', JSON.stringify(definitionMap),
    '--settings', state.native_settings_path, '--setting-sources', '',
    ...(directMcpConfig ? ['--mcp-config', JSON.stringify(directMcpConfig)] : []),
    '--strict-mcp-config',
    '--permission-mode', 'bypassPermissions', '--permission-prompts', 'none',
    '--tools', projected.tools.join(','),
  ];
  const command = nativeFixtureChild ? process.execPath : nativeClaudeExecutable;
  const args = nativeFixtureChild ? [nativeFixtureChild, ...argv] : argv;
  // The run-scoped MCP server resolves its toolkit root from ANDROID_COMMON_DOC before
  // falling back to its own install location. An ambient value in the developer's shell
  // therefore silently decides which repository the certified role can see: a live P4
  // attempt had doc-updater's search-docs answer out of a DIFFERENT checkout, report the
  // request's expected_existing_doc as absent, and correctly refuse to attest a result it
  // could not verify. A run-scoped server that resolves a foreign repository is not
  // run-scoped, so pin it to this toolkit for the role that is given one.
  const roleEnv = {
    ...env,
    RUNTIME_DIRECT_ROLE_PARENT_SESSION_ID: sessionId,
    P4_CERT_DIRECT_ROLE: '1',
    ...(directMcpConfig ? { ANDROID_COMMON_DOC: toolkitRoot } : {}),
  };
  const roleChild = spawn(command, args, {
    cwd: projectRoot, env: roleEnv, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  });
  const roleHost = {
    role, sessionId: roleSessionId, action, argv,
    tools: projected.tools,
    expectedMcpServers: directMcpConfig ? ['androidcommondoc'] : [],
    mcpToolkitRoot: directMcpConfig ? toolkitRoot : null,
    definitionDigest: digestObject(projected.definition),
    child: roleChild, sequence: 0, initObserved: false, turn: null,
    onReady: callback, closing: false,
    transcriptPath: path.join(runRoot, `direct-role-${role}-${roleSessionId}.jsonl`),
    stderrPath: path.join(runRoot, `direct-role-${role}-${roleSessionId}.stderr.log`),
  };
  fs.writeFileSync(roleHost.transcriptPath, '', { flag: 'wx' });
  fs.writeFileSync(roleHost.stderrPath, '', { flag: 'wx' });
  directRoleHostsBySession.set(roleSessionId, roleHost);
  if (persistent) directRoleHostsByRole.set(role, roleHost);
  const feeder = createJsonlFrameFeeder(
    (event) => handleDirectRoleFrame(roleHost, event),
    (reason) => fail('INVALID_DIRECT_ROLE_STREAM', `${role}: ${reason}`),
    () => String(state.status).startsWith('INVALID_'));
  roleChild.stdout.on('data', (chunk) => {
    fs.appendFileSync(roleHost.transcriptPath, chunk);
    feeder(chunk);
  });
  roleChild.stderr.on('data', (chunk) => fs.appendFileSync(roleHost.stderrPath, chunk));
  roleChild.stdin.on('error', (error) => {
    if (error.code !== 'EPIPE') fail('INVALID_DIRECT_ROLE_TRANSPORT', error.message);
  });
  roleChild.on('error', (error) => fail('INVALID_DIRECT_ROLE_SPAWN', error.message));
  roleChild.on('exit', (code, signal) => {
    roleHost.exited = true;
    roleHost.exitCode = code;
    roleHost.signal = signal;
    if (!roleHost.closing && persistent && !String(state.status).startsWith('INVALID_')) {
      fail('INVALID_DIRECT_ROLE_EXIT', `persistent role ${role} exited before teardown.`);
    }
  });
  writeDirectRoleMessage(roleHost,
    'Please acknowledge that you are ready to receive a repository task. Do not use tools on this first orientation turn.',
    'activation', action, () => {});
}

function deliverManagedDirectRole(action, callback) {
  const role = action && action.role;
  const roleHost = directRoleHostsByRole.get(role);
  if (!roleHost || !action.payload || typeof action.payload.message !== 'string') {
    return fail('INVALID_DIRECT_ROLE_DELIVERY', `no persistent direct host exists for ${role}.`);
  }
  if (nativeClaudeExecutable) {
    const consumed = require('../lib/runtime-role-lifecycle.cjs').consumeClaudeResumeHandleForObservedActor(projectRoot, {
      sessionId,
      agentId: roleHost.sessionId,
      agentType: role,
    });
    if (!consumed.ok) return fail('INVALID_DIRECT_ROLE_DELIVERY',
      `resume handle for ${role} was not consumable: ${consumed.reason}`);
    roleHost.resumeHandleId = null;
  }
  writeDirectRoleMessage(roleHost, action.payload.message, 'delivery', action, callback);
}

function executeManagedNativeActions(envelope) {
  if (directActionBatch) return fail('INVALID_DIRECT_ROLE_BATCH', 'a direct-role batch is already active.');
  directActionBatch = { entrypoint: envelope.entrypoint, actions: envelope.actions, index: 0 };
  const advance = () => {
    if (String(state.status).startsWith('INVALID_')) return;
    if (directActionBatch.index >= directActionBatch.actions.length) {
      const completed = directActionBatch;
      directActionBatch = null;
      state.agent_call_count = state.actions.length;
      state.agent_calls_exact = state.actions.every((action) => action.accepted === true
        && action.echoed_exact === true
        && ((action.startup_mode === 'host-admission' && action.first_tool_exact === null)
          || (action.startup_mode === 'host-orchestration' && action.first_tool_exact === null)
          || (action.startup_mode === 'role-tool' && action.first_tool_exact === true)));
      if (fullScenario && completed.entrypoint === 'resume-work') {
        const resumed = completed.actions.filter((action) => actionOperation(action) === 'SendMessage');
        state.p4_resume_sendmessage_action_count = resumed.length;
        state.p4_resume_action_order = resumed.map((action) => action.role);
      }
      dispatchEntrypointReentry(completed.entrypoint);
      writeState();
      return;
    }
    const action = directActionBatch.actions[directActionBatch.index];
    directActionBatch.index += 1;
    const operationName = actionOperation(action);
    if (operationName === 'Agent') return launchManagedDirectRole(action, advance);
    if (operationName === 'SendMessage') return deliverManagedDirectRole(action, advance);
    if (operationName === 'Bash') {
      const result = executeManagedSupervisorStarts([action]);
      if (!result.ok) return fail('INVALID_SUPERVISOR_START_ACTIONS', result.reason);
      return setImmediate(advance);
    }
    return fail('INVALID_DIRECT_ROLE_ACTION', `unsupported action ${action && action.action_id}.`);
  };
  setImmediate(advance);
}

function closeDirectRoleHostsNow() {
  for (const roleHost of directRoleHostsBySession.values()) {
    roleHost.closing = true;
    if (!roleHost.exited) roleHost.child.kill();
  }
}

function closeDirectRoleHostsThen(callback) {
  const hosts = [...directRoleHostsBySession.values()].filter((host) => !host.exited);
  if (hosts.length === 0) return callback();
  for (const host of hosts) {
    host.closing = true;
    host.child.stdin.end();
  }
  const deadline = Date.now() + directRoleTeardownMs;
  const poll = () => {
    if (hosts.every((host) => host.exited)) return callback();
    if (Date.now() >= deadline) {
      for (const host of hosts) if (!host.exited) host.child.kill();
      return fail('INVALID_DIRECT_ROLE_TEARDOWN', 'one or more direct role processes did not exit cleanly.');
    }
    setTimeout(poll, 50);
  };
  poll();
}

function closeMainAfterDirectRoles() {
  closeDirectRoleHostsThen(() => {
    child.stdin.end(() => {
      stdinClosedAfterTerminal = true;
      state.stdin_closed_after_terminal = true;
      writeState();
    });
  });
}

function handleStdinWriteError(error) {
  if (error && error.code === 'EPIPE') {
    state.stdin_epipe = true;
    writeState();
    return;
  }
  fail('INVALID_DRIVER_STDIN', error && error.message ? error.message : String(error));
}

function queueUserMessage(label, text) {
  state.sequence += 1;
  const frame = { type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } };
  fs.writeFileSync(path.join(runRoot, `sequence-${state.sequence}-${label}.jsonl`), `${JSON.stringify(frame)}\n`, { flag: 'wx' });
  pendingWrites += 1;
  writeJsonlFrame(child.stdin, frame, (error) => {
    pendingWrites -= 1;
    if (error) handleStdinWriteError(error);
  });
}

function parseManagedCommandEnvelope(stdout) {
  const lines = String(stdout || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length !== 1) return null;
  try { return JSON.parse(lines[0]); } catch { return null; }
}

/**
 * Bounded, sanitized tail of what a managed command printed, for failure evidence. Credentials are
 * removed by shape and by the name of the field carrying them before anything is kept, characters
 * outside a conservative printable set are dropped, and the result is capped keeping the END --
 * a command that refuses a precondition names it on its last line, not its first.
 * @param {*} output
 * @param {number} [maxChars]
 * @returns {(string|null)}
 */
function sanitizedCommandOutput(output, maxChars) {
  if (typeof output !== 'string' || output.length === 0) return null;
  const limit = Number.isInteger(maxChars) && maxChars > 0 ? maxChars : 600;
  let cleaned = output
    .replace(/(?:bearer|basic)\s+\S+/gi, '<redacted>')
    .replace(/eyJ[A-Za-z0-9._-]+/g, '<redacted>')
    .replace(/(?:sk|pk|rk|ghp|gho|ghs|ghu|xox[baprs])[-_][A-Za-z0-9_-]+/gi, '<redacted>')
    .replace(/((?:api|access|secret|auth|session|refresh|private)[ _-]?(?:key|token|secret|id)?\s*[=:]\s*)\S+/gi, '$1<redacted>')
    // The catch-all for anything unrecognized and long. A canonical refusal reason is a
    // lowercase-and-hyphens identifier (mixed-review-requester-not-claude-native,
    // root-consult-retained-worker-unavailable, ...), and several are well past this threshold, so
    // without an exemption this rule erases exactly the diagnostics the evidence exists to carry --
    // which is what happened to live attempt N12. A credential never has that shape: every
    // credential encoding in use here (base64, base64url, hex, JWT segments, prefixed API keys)
    // carries digits or uppercase, so requiring pure lowercase-and-hyphens keeps the rule closed.
    .replace(/[A-Za-z0-9+\/=_-]{24,}/g, (run) => (/^[a-z]+(?:-[a-z]+)+$/.test(run) ? run : '<redacted>'));
  cleaned = cleaned.replace(/[^ -~]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (cleaned.length === 0) return null;
  return cleaned.length <= limit ? cleaned : '...' + cleaned.slice(cleaned.length - limit);
}

function recordManagedCommand(kind, name, tokens, result, authority) {
  state.managed_conductor_commands = state.managed_conductor_commands || [];
  const record = {
    origin: 'managed-conductor',
    evidence_method: 'CONDUCTOR_DIRECT_EXECUTION',
    kind,
    name,
    argv_digest: digestObject(tokens),
    authority_digest: digestObject(authority),
    exit_code: result.status,
    signal: result.signal || null,
    proposal: null,
  };
  // A non-zero managed command used to be recorded as an exit code and nothing else, so a live
  // rejection said only "it failed". The CLI already prints exactly which precondition it refused
  // on; keep a bounded, sanitized tail of that instead of throwing it away. Recorded only for a
  // failure, so a healthy run's evidence is byte-identical to what it was.
  if (result.status !== 0) {
    const stderrTail = sanitizedCommandOutput(result.stderr);
    const stdoutTail = sanitizedCommandOutput(result.stdout);
    if (stderrTail) record.stderr_tail = stderrTail;
    if (stdoutTail) record.stdout_tail = stdoutTail;
  }
  state.managed_conductor_commands.push(record);
  writeJson(path.join(runRoot,
    `managed-command-${String(state.managed_conductor_commands.length).padStart(2, '0')}-${name}.json`), record);
}

function closedFlagMap(tokens) {
  const flags = {};
  for (let index = 0; index < tokens.length; index += 2) {
    if (typeof tokens[index] !== 'string' || !tokens[index].startsWith('--')
        || index + 1 >= tokens.length || flags[tokens[index].slice(2)] !== undefined) return null;
    flags[tokens[index].slice(2)] = tokens[index + 1];
  }
  return flags;
}

function executeManagedConsultation(tokens, authorityKind, binding) {
  if (!Array.isArray(tokens) || tokens.length < 3 || typeof tokens[2] !== 'string') {
    return { ok: false, reason: 'consultation argv is malformed' };
  }
  const subcommand = tokens[2];
  let authority = { ok: true, grantId: 'offline-managed-consultation-grant' };
  let authorizedTokens = [...tokens];
  if (!managedCommandFixture) {
    const lifecycle = require('../lib/runtime-role-lifecycle.cjs');
    const consultation = require('../lib/runtime-consultation.cjs');
    const rest = tokens.slice(3);
    const flags = closedFlagMap(rest);
    if (!flags || !binding) return { ok: false, reason: 'consultation authority scope is unavailable' };
    const argvDigest = consultation.sha256String(consultation.canonicalJSONStringify(rest));
    let requestId = null;
    let attemptId = null;
    let leaseEpoch = null;
    if (authorityKind === 'requester') {
      const scope = consultation.resolveRequesterGrantScope(subcommand, flags);
      if (!scope.ok) return { ok: false, reason: scope.reason || 'requester scope did not resolve' };
      ({ requestId, attemptId, leaseEpoch } = scope);
    } else if (authorityKind === 'target') {
      if (typeof flags.request !== 'string') return { ok: false, reason: 'target request is absent' };
      const resolved = consultation.resolveActivationForRequestPath(flags.request);
      if (!resolved.ok || !resolved.activation) {
        const classified = classifyActivationFailure(flags.request);
        state.activation_failure = classified;
        return {
          ok: false,
          reason: `target activation did not resolve (${classified.branch}`
            + `${classified.branch === 'activation-expired'
              ? `; window ${classified.liveness_window_seconds}s, overrun ${classified.overrun_seconds}s`
              : ''})`,
        };
      }
      ({ requestId, attemptId, leaseEpoch } = resolved);
    } else {
      return { ok: false, reason: 'consultation authority kind is invalid' };
    }
    authority = lifecycle.mintRoleCommandGrant(
      projectRoot, binding, authorityKind, subcommand, argvDigest,
      requestId, attemptId, leaseEpoch,
    );
    if (!authority.ok) return { ok: false, reason: authority.reason || 'consultation grant mint failed' };
    authorizedTokens.push(authorityKind === 'requester' ? '--requester-binding' : '--target-binding', authority.grantId);
  }
  const executable = managedCommandFixture ? process.execPath : authorizedTokens[0];
  const argv = managedCommandFixture
    ? [managedCommandFixture, '--kind', 'root-consult', '--name', subcommand,
      '--run-root', runRoot, '--session-id', sessionId, '--scenario',
      process.env.P4_CERT_FAKE_SCENARIO || state.scenario]
    : authorizedTokens.slice(1);
  const result = spawnSync(executable, argv, {
    cwd: projectRoot, env: process.env, encoding: 'utf8', windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  recordManagedCommand(`root-consult-${authorityKind}`, subcommand, authorizedTokens, result, {
    grant_id: authority.grantId,
  });
  const envelope = parseManagedCommandEnvelope(result.stdout);
  if (!envelope || result.status !== 0 || envelope.status !== 'SUCCESS') {
    return { ok: false, reason: `${subcommand} failed with exit ${result.status}`, envelope };
  }
  return { ok: true, envelope };
}

// DIAGNOSTIC ONLY -- never grants, extends or substitutes authority. The production
// resolveActivationForRequestPath() remains the sole authority and has many distinct
// {ok:false} returns (pending write, decorrelated record, expired/canonical-time violation,
// driver incoherence, genuine absence), all of which the launcher previously collapsed into
// one opaque "target activation did not resolve". A live P6 run lost six minutes to that
// ambiguity. This re-reads the same records purely to NAME the branch, with the timestamps
// needed to act on it.
function classifyActivationFailure(requestPath) {
  const detail = { branch: 'unclassified', request_path: requestPath };
  let txnDir;
  let request;
  try {
    txnDir = path.dirname(requestPath);
    request = JSON.parse(fs.readFileSync(requestPath, 'utf8'));
  } catch (error) {
    return { ...detail, branch: 'request-unreadable', error: String(error && error.message) };
  }
  let entries;
  try { entries = fs.readdirSync(path.join(txnDir, 'activations')); } catch { entries = []; }
  const activations = entries.filter((name) => name.endsWith('.json'));
  if (activations.length === 0) return { ...detail, branch: 'activation-absent' };
  if (activations.length !== 1) {
    return { ...detail, branch: 'activation-ambiguous', count: activations.length };
  }
  let activation;
  try {
    activation = JSON.parse(fs.readFileSync(path.join(txnDir, 'activations', activations[0]), 'utf8'));
  } catch (error) {
    return { ...detail, branch: 'activation-unreadable', error: String(error && error.message) };
  }
  const correlated = activation.request_id === request.request_id
    && activation.target_role_profile_digest === request.target_role_profile_digest
    && activation.routing_policy_version === request.routing_policy_version
    && activation.routing_policy_digest === request.routing_policy_digest;
  if (!correlated) return { ...detail, branch: 'activation-decorrelated' };
  const createdMs = Date.parse(activation.created_at);
  const expiryMs = Date.parse(activation.activation_liveness_expiry);
  const nowMs = Date.now();
  if (Number.isNaN(createdMs) || Number.isNaN(expiryMs)) {
    return { ...detail, branch: 'activation-time-unparseable' };
  }
  if (nowMs >= expiryMs) {
    return {
      ...detail,
      branch: 'activation-expired',
      created_at: activation.created_at,
      activation_liveness_expiry: activation.activation_liveness_expiry,
      liveness_window_seconds: Math.round((expiryMs - createdMs) / 1000),
      overrun_seconds: Math.round((nowMs - expiryMs) / 1000),
    };
  }
  return {
    ...detail,
    branch: 'activation-live-but-rejected',
    remaining_seconds: Math.round((expiryMs - nowMs) / 1000),
  };
}

function rootConsultTokens(command, requestPath, extra = []) {
  const lifecycle = require('../lib/runtime-role-lifecycle.cjs');
  return [
    lifecycle.resolvedNodePath(), path.join(toolkitRoot, 'scripts', 'lib', 'runtime-consultation.cjs'),
    command, '--coordination-root', path.join(projectRoot, '.planning', 'coordination'),
    '--request', requestPath, ...extra,
  ];
}

function validateClaudeSendMessageActivation(activation, requestPath) {
  if (!activation || activation.kind !== 'claude-sendmessage'
      || activation.selected_driver !== 'claude-sendmessage'
      || activation.request_artifact_path !== requestPath
      || activation.target_role !== 'arch-platform'
      || activation.target_name !== 'arch-platform'
      || typeof activation.request_id !== 'string'
      || typeof activation.attempt_id !== 'string'
      || !Number.isInteger(activation.lease_epoch)
      || typeof activation.message !== 'string'
      || !activation.message.startsWith('COORDINATION_CONSULT/v1\n')) return false;
  let message;
  try { message = JSON.parse(activation.message.slice('COORDINATION_CONSULT/v1\n'.length)); }
  catch { return false; }
  return canonicalJSONStringify(Object.keys(message).sort()) === canonicalJSONStringify([
    'artifact_path', 'kind', 'request_id', 'role', 'target_role',
  ]) && message.artifact_path === requestPath && message.kind === 'consult'
    && message.request_id === activation.request_id && message.role === 'toolkit-specialist'
    && message.target_role === 'arch-platform';
}

function executeManagedRootSource(roleHost, callback) {
  let publishTokens;
  if (managedCommandFixture) {
    publishTokens = ['fake-node', 'fake-runtime-consultation', 'publish-request'];
  } else {
    const lifecycle = require('../lib/runtime-role-lifecycle.cjs');
    const actionValid = lifecycle.validateRootSourceAction(roleHost.action);
    if (!actionValid.ok) return fail('INVALID_ROOT_SOURCE_HOST_PROTOCOL', actionValid.reason);
    const bindingValid = lifecycle.decodeRootSourceBootstrapIntentForBinding(
      projectRoot, roleHost.rootSourceBinding,
    );
    if (!bindingValid.ok) return fail('INVALID_ROOT_SOURCE_HOST_PROTOCOL', bindingValid.reason);
    const publishLine = roleHost.action.payload.bootstrap_message.split('\n')[3];
    publishTokens = lifecycle.parsePosixDirect(publishLine.slice('publish_command='.length));
    if (!Array.isArray(publishTokens)) {
      return fail('INVALID_ROOT_SOURCE_HOST_PROTOCOL', 'root-source publish command did not parse');
    }
  }
  const published = executeManagedConsultation(
    publishTokens, 'requester', roleHost.rootSourceBinding,
  );
  const requestPath = published.ok && published.envelope.artifact_ref;
  if (!published.ok || typeof requestPath !== 'string' || requestPath.length === 0) {
    return fail('INVALID_ROOT_SOURCE_HOST_PROTOCOL', published.reason || 'publish-request returned no artifact');
  }
  const dispatched = executeManagedConsultation(
    rootConsultTokens('dispatch', requestPath), 'requester', roleHost.rootSourceBinding,
  );
  const activation = dispatched.ok && dispatched.envelope.activation_action;
  if (!dispatched.ok || !validateClaudeSendMessageActivation(activation, requestPath)) {
    return fail('INVALID_ROOT_SOURCE_HOST_PROTOCOL', dispatched.reason || 'dispatch activation was invalid');
  }
  const architect = directRoleHostsByRole.get('arch-platform');
  if (!architect || (!managedCommandFixture && !architect.actorBinding)) {
    return fail('INVALID_ROOT_SOURCE_HOST_PROTOCOL', 'the persistent arch-platform actor is unavailable');
  }
  const deliveryAction = {
    action_id: sha256String(`root-consult-delivery\0${activation.request_id}\0${activation.attempt_id}`),
    kind: 'role-notify', runtime: 'claude-native', role: 'arch-platform',
    payload: { teammate_name: 'arch-platform', message: activation.message },
  };
  let claimPath = null;
  const onEcho = () => {
    const delivered = executeManagedConsultation(rootConsultTokens('record-delivery', requestPath, [
      '--attempt', activation.attempt_id, '--epoch', String(activation.lease_epoch),
      '--driver', 'claude-sendmessage', '--outcome', 'possibly-delivered',
      '--commit-point', 'sendmessage-returned',
    ]), 'requester', roleHost.rootSourceBinding);
    if (!delivered.ok) return fail('INVALID_ROOT_SOURCE_HOST_PROTOCOL', delivered.reason);
    const claimed = executeManagedConsultation(rootConsultTokens('claim', requestPath, [
      '--role', 'arch-platform',
    ]), 'target', architect.actorBinding);
    if (!claimed.ok || typeof claimed.envelope.artifact_ref !== 'string') {
      return fail('INVALID_ROOT_SOURCE_HOST_PROTOCOL', claimed.reason || 'claim returned no artifact');
    }
    claimPath = claimed.envelope.artifact_ref;
  };
  writeDirectRoleConsultation(architect, activation.message, deliveryAction, onEcho, (turnResult) => {
    if (String(state.status).startsWith('INVALID_')) return;
    const content = turnResult && typeof turnResult.assistantText === 'string'
      ? turnResult.assistantText.trim() : '';
    if (!claimPath || content.length === 0 || Buffer.byteLength(content, 'utf8') > 65536) {
      return fail('INVALID_ROOT_SOURCE_HOST_PROTOCOL', 'arch-platform returned no bounded semantic result');
    }
    const result = executeManagedConsultation(rootConsultTokens('publish-result', requestPath, [
      '--claim', claimPath, '--content', Buffer.from(content, 'utf8').toString('base64url'),
    ]), 'target', architect.actorBinding);
    if (!result.ok) return fail('INVALID_ROOT_SOURCE_HOST_PROTOCOL', result.reason);
    const awaited = executeManagedConsultation(rootConsultTokens('await-result', requestPath, [
      '--timeout', '5',
    ]), 'requester', roleHost.rootSourceBinding);
    if (!awaited.ok) return fail('INVALID_ROOT_SOURCE_HOST_PROTOCOL', awaited.reason);
    const accepted = executeManagedConsultation(
      rootConsultTokens('accept-result', requestPath), 'requester', roleHost.rootSourceBinding,
    );
    if (!accepted.ok) return fail('INVALID_ROOT_SOURCE_HOST_PROTOCOL', accepted.reason);
    const acknowledged = executeManagedConsultation(rootConsultTokens('transaction-ack', requestPath, [
      '--disposition', 'accepted',
    ]), 'requester', roleHost.rootSourceBinding);
    if (!acknowledged.ok) return fail('INVALID_ROOT_SOURCE_HOST_PROTOCOL', acknowledged.reason);
    if (nativeClaudeExecutable) {
      const parked = require('../lib/runtime-role-lifecycle.cjs').parkClaudeResumeHandleForRoleActor(projectRoot, {
        sessionId,
        agentId: architect.sessionId,
        agentType: architect.role,
      });
      if (!parked.ok) return fail('INVALID_DIRECT_ROLE_PARK',
        `role ${architect.role} could not be re-parked after result publication: ${parked.reason}`);
      architect.resumeHandleId = parked.record.binding_id;
    }
    state.actions.push({
      action_id: roleHost.action.action_id, family: roleHost.action.kind, role: roleHost.role,
      direct_session_digest: sha256String(roleHost.sessionId),
      delivered_message_digest: digestObject(activation.message), echoed_exact: true,
      first_tool_exact: null, tool_count: 0, startup_mode: 'host-orchestration', accepted: true,
    });
    state.root_source_host_protocol = {
      request_ref: requestPath,
      result_ref: result.envelope.artifact_ref || null,
      accepted_result_ref: accepted.envelope.artifact_ref || null,
      ack_ref: acknowledged.envelope.artifact_ref || null,
      semantic_result_digest: sha256String(content),
    };
    roleHost.closing = true;
    roleHost.child.stdin.end();
    writeState();
    setImmediate(callback);
  });
}

function executeManagedEntrypoint(entrypointName, intentValue, baseTokens) {
  if (!managedConductor || String(state.status).startsWith('INVALID_')) return false;
  const entrypoints = require('../lib/runtime-collaboration-entrypoints.cjs');
  const lifecycle = require('../lib/runtime-role-lifecycle.cjs');
  const host = require('../lib/runtime-host-claude.cjs');
  let intent;
  let plan;
  try {
    const bytes = Buffer.from(intentValue, 'base64url');
    if (bytes.toString('base64url') !== intentValue) throw new Error('noncanonical-intent');
    intent = JSON.parse(bytes.toString('utf8'));
    plan = entrypoints.planEntrypointStep(entrypointName, intent, projectRoot);
  } catch (error) {
    fail('INVALID_MANAGED_HOST_COMMAND', `managed entrypoint planning failed: ${error.message}`);
    return true;
  }
  const composition = managedCommandFixture ? {
    ok: true, compositionId: 'offline-managed-composition', evidenceMethod: 'OFFLINE_FAKE',
  } : host.mintManagedHostComposition({
    projectRoot, sessionId, entrypoint: entrypointName,
    argvDigest: plan.argv_digest, roleScope: plan.role_scope,
  });
  if (!composition.ok) {
    fail('INVALID_MANAGED_HOST_AUTHORITY', composition.reason || 'managed host composition mint failed');
    return true;
  }
  const tokens = [...baseTokens, '--host-composition', composition.compositionId];
  let lifecycleAuthority = null;
  if (plan.command !== null) {
    const planScope = lifecycle.discoverPlan(projectRoot);
    let worktreeId;
    try { worktreeId = lifecycle.computeWorktreeId(projectRoot); } catch { worktreeId = null; }
    lifecycleAuthority = managedCommandFixture ? {
      ok: true, grantId: 'offline-managed-lifecycle-grant',
    } : host.mintManagedLifecycleCommandAuthority({
      projectRoot, sessionId, subcommand: plan.command, argvDigest: plan.argv_digest,
      role: plan.role_scope,
      actionId: plan.command === 'root-source-status'
        ? entrypoints.plannedEntrypointCommandArgument(plan) : null,
      worktreeId, planDigest: planScope.ok ? planScope.planDigest : null,
    });
    if (!lifecycleAuthority.ok) {
      fail('INVALID_MANAGED_HOST_AUTHORITY', lifecycleAuthority.reason || 'managed lifecycle authority mint failed');
      return true;
    }
    tokens.push('--lifecycle-binding', lifecycleAuthority.grantId);
  }
  const executable = managedCommandFixture ? process.execPath : tokens[0];
  const argv = managedCommandFixture
    ? [managedCommandFixture, '--kind', 'entrypoint', '--name', entrypointName,
      '--run-root', runRoot, '--session-id', sessionId, '--scenario', state.scenario,
      '--intent', intentValue]
    : tokens.slice(1);
  const result = spawnSync(executable, argv, {
    cwd: projectRoot, env: process.env, encoding: 'utf8', windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  recordManagedCommand('entrypoint', entrypointName, tokens, result, {
    composition_id: composition.compositionId,
    lifecycle_grant_id: lifecycleAuthority ? lifecycleAuthority.grantId : null,
  });
  const envelope = parseManagedCommandEnvelope(result.stdout);
  if (!envelope) {
    fail('INVALID_MANAGED_HOST_COMMAND', `${entrypointName} emitted no single JSON envelope (exit ${result.status}).`);
    return true;
  }
  handleEntrypointEnvelope(envelope);
  writeState();
  return true;
}

const managedEntrypointSteps = {
  'init-session': () => executeManagedEntrypoint('init-session', initIntentValue, initTokens),
  work: () => executeManagedEntrypoint('work', workIntentValue, workTokens),
  'resume-work': () => executeManagedEntrypoint('resume-work', resumeIntentValue, resumeTokens),
  'ingest-denied': () => executeManagedEntrypoint('ingest-content', ingestDeniedIntentValue, ingestDeniedTokens),
  'ingest-approved': () => executeManagedEntrypoint('ingest-content', ingestApprovedIntentValue, ingestApprovedTokens),
  'monitor-docs': () => executeManagedEntrypoint('monitor-docs', monitorIntentValue, monitorTokens),
};

function dispatchManagedEntrypoint(step, legacyLabel, legacyPrompt) {
  if (!managedConductor) {
    queueUserMessage(legacyLabel, legacyPrompt);
    return;
  }
  setImmediate(() => {
    const execute = managedEntrypointSteps[step];
    if (!execute) fail('INVALID_MANAGED_HOST_COMMAND', `unknown managed entrypoint step ${step}`);
    else execute();
  });
}

function managedStepForEntrypoint(entrypointName) {
  if (entrypointName === 'init-session') return 'init-session';
  if (entrypointName === 'resume-work') return 'resume-work';
  if (entrypointName === 'work') return 'work';
  if (entrypointName === 'monitor-docs') return 'monitor-docs';
  if (entrypointName === 'ingest-content') {
    return p4Stage === 'ingest-approved' ? 'ingest-approved' : 'ingest-denied';
  }
  return null;
}

function dispatchEntrypointReentry(entrypointName) {
  const prompt = reentryPrompt(entrypointName);
  const step = managedStepForEntrypoint(entrypointName);
  if (!prompt || !step) return fail('INVALID_ACTION_RELAY',
    `No exact re-entry command exists for ${entrypointName} at stage ${p4Stage}.`);
  dispatchManagedEntrypoint(step, `${entrypointName}-reenter`, prompt);
}

function executeManagedSupervisorStarts(actions) {
  const host = require('../lib/runtime-host-claude.cjs');
  for (const action of actions) {
    const input = canonicalSupervisorStartInput(action);
    if (!input) return { ok: false, reason: 'supervisor action was not canonical' };
    // Already launched by this run: the projection simply has not observed READY yet.
    // Re-minting its claim would fail, and re-spawning would produce a second child.
    if (executedSupervisorStartActionIds.has(action.action_id)) continue;
    const authority = managedCommandFixture ? { ok: true, claimId: 'offline-managed-supervisor-claim' }
      : host.mintManagedSupervisorStartAuthority({ projectRoot, sessionId, action });
    if (!authority.ok) return { ok: false, reason: authority.reason || 'supervisor claim mint failed' };
    let started;
    try {
      if (managedCommandFixture) started = { pid: null, unref() {} };
      else {
        // The bridge is detached, so its diagnostics must land in durable files rather than
        // an inherited pipe: a live attempt lost the bridge's own failure reason entirely to
        // stdio 'ignore' and could only report that no worker ever registered.
        const bridgeOut = fs.openSync(path.join(runRoot, `supervisor-${action.action_id}.out.log`), 'a');
        const bridgeErr = fs.openSync(path.join(runRoot, `supervisor-${action.action_id}.err.log`), 'a');
        started = spawn(action.payload.bridge_argv[0], action.payload.bridge_argv.slice(1), {
          cwd: projectRoot, env: process.env, detached: true,
          stdio: ['ignore', bridgeOut, bridgeErr], windowsHide: true,
        });
        started.unref();
        fs.closeSync(bridgeOut);
        fs.closeSync(bridgeErr);
      }
    } catch (error) {
      return { ok: false, reason: error.message };
    }
    executedSupervisorStartActionIds.add(action.action_id);
    state.managed_supervisor_starts = state.managed_supervisor_starts || [];
    state.managed_supervisor_starts.push({
      origin: 'managed-conductor', evidence_method: 'CONDUCTOR_DIRECT_EXECUTION',
      action_id: action.action_id, argv_digest: digestObject(action.payload.bridge_argv),
      pid: started.pid || null, proposal: null,
    });
  }
  return { ok: true };
}

function executeManagedLifecycle(tokens, subcommand, role, argvDigest) {
  if (!managedConductor || String(state.status).startsWith('INVALID_')) return false;
  const host = require('../lib/runtime-host-claude.cjs');
  const authority = managedCommandFixture ? {
    ok: true, grantId: 'offline-managed-lifecycle-grant',
  } : host.mintManagedLifecycleCommandAuthority({
    projectRoot, sessionId, subcommand, argvDigest, role, actionId: null,
  });
  if (!authority.ok) {
    fail('INVALID_MANAGED_HOST_AUTHORITY', authority.reason || `${subcommand} lifecycle authority mint failed`);
    return true;
  }
  const authorizedTokens = [...tokens, '--lifecycle-binding', authority.grantId];
  const executable = managedCommandFixture ? process.execPath : authorizedTokens[0];
  const argv = managedCommandFixture
    ? [managedCommandFixture, '--kind', 'lifecycle', '--name', subcommand,
      '--role', role, '--run-root', runRoot, '--session-id', sessionId, '--scenario', state.scenario]
    : authorizedTokens.slice(1);
  const result = spawnSync(executable, argv, {
    cwd: projectRoot, env: process.env, encoding: 'utf8', windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  recordManagedCommand('lifecycle', subcommand, authorizedTokens, result, {
    lifecycle_grant_id: authority.grantId,
  });
  const envelope = parseManagedCommandEnvelope(result.stdout);
  if (!envelope) {
    fail('INVALID_MANAGED_HOST_COMMAND', `${subcommand} emitted no single JSON envelope (exit ${result.status}).`);
    return true;
  }
  if (fullScenario && subcommand === 'stop-owned') handleP4CleanupResult(envelope);
  else if (p5Scenario) handleP5LifecycleResult(envelope);
  writeState();
  return true;
}

function dispatchManagedLifecycle(tokens, subcommand, role, argvDigest, legacyLabel, legacyPrompt) {
  if (!managedConductor) {
    queueUserMessage(legacyLabel, legacyPrompt);
    return;
  }
  setImmediate(() => executeManagedLifecycle(tokens, subcommand, role, argvDigest));
}

function closeModelDeclinedActionSet() {
  const assistantText = pending && Array.isArray(pending.assistantText)
    ? pending.assistantText.join('\n')
    : '';
  state.status = 'MODEL_DECLINED_ACTION_SET';
  state.invalidation_reason = 'The model ended the owning Agent turn without emitting any Agent proposal.';
  state.pending_action_ids = pending.actions.map((action) => action.action_id);
  state.model_response_text_digest = sha256String(assistantText);
  state.model_response_had_text = assistantText.length > 0;
  writeState();
  child.stdin.end(() => {
    stdinClosedAfterTerminal = true;
    state.stdin_closed_after_terminal = true;
    writeState();
  });
  terminalShutdownTimer = setTimeout(() => {
    state.terminal_shutdown_forced = true;
    writeState();
    child.kill();
  }, 5_000);
}

function queueActionRelayInterrupt(envelope) {
  if (managedConductor) {
    state.action_relay_count += 1;
    queueUserMessage(`actions-${state.action_relay_count}`,
      actionRelayPrompt(envelope, state.action_relay_count));
    return;
  }
  const capabilities = new Set(state.init && Array.isArray(state.init.capabilities)
    ? state.init.capabilities : []);
  if (!capabilities.has('interrupt_receipt_v1')) {
    return fail('INVALID_ACTION_INTERRUPT',
      'system/init did not advertise interrupt_receipt_v1 for the closed ACTION_REQUIRED relay.');
  }
  if (actionInterrupt) {
    return fail('INVALID_ACTION_INTERRUPT',
      'A second ACTION_REQUIRED interrupt was requested before the first settled.');
  }
  state.action_interrupt_count += 1;
  const requestId = `p4-action-relay-interrupt-${String(state.action_interrupt_count).padStart(2, '0')}-${crypto.randomUUID()}`;
  const frame = {
    type: 'control_request',
    request_id: requestId,
    request: {
      subtype: 'interrupt',
      reason: 'workflow-abort',
      cancel_queued: false,
    },
  };
  const record = {
    request_id_digest: sha256String(requestId),
    entrypoint: envelope.entrypoint,
    receipt_observed: false,
    interrupted_result_observed: false,
    transition: 'ACTION_REQUIRED->INTERRUPT_REQUESTED',
  };
  state.action_interrupts.push(record);
  actionInterrupt = { requestId, envelope, record };
  const controlPath = path.join(runRoot,
    `control-${state.action_interrupt_count}-action-relay-interrupt.jsonl`);
  fs.writeFileSync(controlPath, `${JSON.stringify(frame)}\n`, { flag: 'wx' });
  pendingWrites += 1;
  writeJsonlFrame(child.stdin, frame, (error) => {
    pendingWrites -= 1;
    if (error) handleStdinWriteError(error);
  });
  writeState();
}

function queueInterruptedActionRelay() {
  if (!actionInterrupt || !actionInterrupt.record.receipt_observed
      || !actionInterrupt.record.interrupted_result_observed) {
    return fail('INVALID_ACTION_INTERRUPT',
      'The ACTION_REQUIRED relay was attempted before its interrupt boundary settled.');
  }
  const completed = actionInterrupt;
  actionInterrupt = null;
  state.action_relay_count += 1;
  state.action_relay_after_interrupt_result_count += 1;
  completed.record.transition = 'ACTION_REQUIRED->INTERRUPT_RECEIPT->INTERRUPTED_RESULT->RELAY';
  queueUserMessage(`actions-${state.action_relay_count}`,
    actionRelayPrompt(completed.envelope, state.action_relay_count));
}

function readObserverRows() {
  const observerPath = path.join(runRoot, 'observer', 'events.jsonl');
  if (!fs.existsSync(observerPath)) return [];
  return fs.readFileSync(observerPath, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

// The genuine passive entrypoint observer preserves the complete native event
// under raw_event and keeps only digests/metadata at the envelope level. Older
// offline fixtures wrote the native fields directly. Entry-point evaluation
// accepts both evidence representations without weakening producer checks used
// by the separate signed host-contract probe.
function entrypointObserverEvents() {
  return readObserverRows().map((row) => ({ ...row, ...(row.raw_event || {}) }));
}

function cleanupNativeSessionTranscripts() {
  const allowedRoot = process.env.P4_CERT_OFFLINE_TEST === '1' && process.env.P4_CERT_NATIVE_TRANSCRIPT_ROOT
    ? path.resolve(process.env.P4_CERT_NATIVE_TRANSCRIPT_ROOT)
    : path.join(os.homedir(), '.claude', 'projects');
  const allowedRootReal = fs.realpathSync(allowedRoot);
  const candidates = [];
  for (const row of readObserverRows()) {
    const event = row.raw_event || row;
    if (event.hook_event_name === 'SessionStart' && typeof event.transcript_path === 'string') {
      candidates.push({ kind: 'session', path: event.transcript_path });
    }
    if (event.hook_event_name === 'SubagentStop' && typeof event.agent_transcript_path === 'string') {
      candidates.push({ kind: 'subagent', path: event.agent_transcript_path });
    }
  }
  const unique = [...new Map(candidates.map((candidate) => [path.resolve(candidate.path), candidate])).values()];
  const evidenceDir = path.join(runRoot, 'native-session-transcripts');
  const removed = [];
  let subagentIndex = 0;
  for (const candidate of unique) {
    const resolved = path.resolve(candidate.path);
    if (!fs.existsSync(resolved)) continue;
    const real = fs.realpathSync(resolved);
    const relative = path.relative(allowedRootReal, real);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !relative.includes(sessionId)) {
      throw new Error(`Refusing transcript cleanup outside the exact native session: ${real}`);
    }
    fs.mkdirSync(evidenceDir, { recursive: true });
    const evidenceName = candidate.kind === 'session'
      ? 'session.jsonl'
      : `subagent-${String(++subagentIndex).padStart(2, '0')}.jsonl`;
    const evidencePath = path.join(evidenceDir, evidenceName);
    fs.copyFileSync(real, evidencePath, fs.constants.COPYFILE_EXCL);
    const digest = crypto.createHash('sha256').update(fs.readFileSync(real)).digest('hex');
    fs.unlinkSync(real);
    removed.push({ kind: candidate.kind, path: real, evidence_path: evidencePath, sha256: digest });
  }
  return { complete: true, allowed_root: allowedRootReal, removed };
}

function retireNativeSessionAuthority() {
  const testRetirement = process.env.P4_CERT_OFFLINE_TEST === '1'
    && process.env.P4_CERT_TEST_RETIRE_SESSION_AUTHORITY === '1';
  if (operation !== 'entrypoint-protocol' || (!nativeClaudeExecutable && !testRetirement)) {
    return { complete: true, status: 'not-applicable' };
  }
  const rll = require('../lib/runtime-role-lifecycle.cjs');
  const identity = { provider: 'claude-hook', runtime_session_key: sessionId };
  const generationPath = rll.sessionGenerationPathFor(projectRoot, identity);
  const live = rll.peekSessionGeneration(projectRoot, identity);
  if (!live.ok && ['session-generation-absent', 'session-generation-expired'].includes(live.reason)) {
    return { complete: true, status: live.reason };
  }
  if (!live.ok) throw new Error(`native session generation could not be retired safely: ${live.reason}`);
  const read = rll.readRegistryRecord(generationPath);
  const record = read.ok && !read.absent ? read.obj : null;
  if (!record || record.schema !== 'runtime/session-generation/v1'
      || record.provider !== identity.provider
      || record.runtime_session_key !== identity.runtime_session_key
      || record.generation_id !== live.generationId) {
    throw new Error('native session generation changed before retirement');
  }
  const retiredAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const replacement = { ...record, expires_at: retiredAt };
  const write = rll.writeRegistryRecordReplace(
    generationPath, Buffer.from(canonicalJSONStringify(replacement), 'utf8'),
  );
  if (!write.ok) throw new Error(`native session generation retirement failed: ${write.reason}`);
  const verification = rll.peekSessionGeneration(projectRoot, identity);
  if (verification.ok || verification.reason !== 'session-generation-expired') {
    throw new Error('native session generation remained live after retirement');
  }
  return {
    complete: true,
    status: 'retired',
    generation_id_digest: sha256String(record.generation_id),
    retired_at: retiredAt,
  };
}

// After the exact Claude session generation is retired, the retained
// supervisor observes that monotonic cut and runs its own owned shutdown
// timeline. This finalizer only waits for the canonical liveness resolver to
// prove no live owner remains; it never kills a PID or edits registry state.
/**
 * Read-only account of a role-owner record that outlived the teardown wait: which role holds it,
 * when it was claimed, and whether the supervisor process that claimed it is still alive. Never
 * deletes a record, never signals a process; every failure to read is reported as such rather than
 * being smoothed into a guess.
 * @returns {object}
 */
function describeLingeringRoleOwner(rll, rbc, repoDescriptor, coordinationRootId, last) {
  const role = last && last.ok && last.found === true && typeof last.role === 'string' ? last.role : null;
  if (!role) return { role: null, detail: 'owner-role-unresolved' };
  let record = null;
  try {
    const ownerPath = rbc.roleOwnerPathFor(repoDescriptor, coordinationRootId, role);
    const read = rll.readRegistryRecord(ownerPath);
    if (!read || !read.ok) return { role, detail: 'owner-record-unreadable' };
    if (read.absent) return { role, detail: 'owner-record-vanished-while-reading' };
    record = read.obj;
  } catch (error) {
    return { role, detail: 'owner-record-read-threw' };
  }
  const claimedAt = record && typeof record.claimed_at === 'string' ? record.claimed_at : null;
  let supervisor = 'supervisor-liveness-unknown';
  try {
    const liveness = rbc.classifyProcessIdentityLiveness(record && record.pid_identity);
    supervisor = liveness && liveness.ok && typeof liveness.status === 'string'
      ? 'supervisor-' + liveness.status.toLowerCase()
      : 'supervisor-liveness-unresolved:' + String((liveness && liveness.reason) || 'unknown');
  } catch (error) {
    supervisor = 'supervisor-liveness-threw';
  }
  return { role, claimed_at: claimedAt, detail: supervisor };
}

function settleP5OwnedSupervisor() {
  if (!p5Scenario || process.env.P4_CERT_OFFLINE_TEST === '1') {
    return { complete: true, status: 'not-applicable' };
  }
  const rll = require('../lib/runtime-role-lifecycle.cjs');
  const rbc = require('../lib/runtime-bridge-codex.cjs');
  const repoDescriptor = { repoId: rll.computeRepoId(projectRoot) };
  const coordinationRoot = rll.coordinationRootPathFor(projectRoot);
  const coordinationRootId = rbc.computeCoordinationRootId(coordinationRoot);
  const startedAt = Date.now();
  const deadline = startedAt + 45_000;
  let last = null;
  while (Date.now() < deadline) {
    last = rbc.findExistingRoleOwner(repoDescriptor, coordinationRootId);
    if (last && last.ok && last.found === false) {
      return {
        complete: true, status: 'no-live-owner',
        waited_ms: Date.now() - startedAt, checked_at: new Date().toISOString(),
      };
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  }
  // A timeout that reports only "an owner record still exists" cannot be acted on: the record
  // outliving the wait means either the supervisor is still working through its own bounded
  // shutdown, or it died without releasing what it claimed. Those need opposite fixes, and the
  // registry already holds the evidence that tells them apart -- read it, read-only, rather than
  // leaving the next reader to guess.
  const owner = describeLingeringRoleOwner(rll, rbc, repoDescriptor, coordinationRootId, last);
  return {
    complete: false, status: 'live-owner-timeout',
    waited_ms: Date.now() - startedAt, last, owner,
  };
}

// How many terminal `result` frames the probe will consume before giving up, and
// how long it will wait for a further turn after an incomplete one. A real host
// ends its turn as soon as it has spawned the background peer, so the resume and
// the second peer necessarily arrive in LATER turns.
const HOST_PROBE_MAX_TERMINAL_RESULTS = 8;
const HOST_PROBE_CONTINUATION_MS = Number.parseInt(
  process.env.P4_CERT_HOST_PROBE_CONTINUATION_MS || '120000', 10,
);
let hostProbeContinuationTimer = null;
let hostProbeFinalized = false;

// The probe's own completion predicate, stated once: two peer spawns and the
// three SubagentStarts (A, resumed A, B). Anything less means the sequence is
// still outstanding and finalizing now would judge an unfinished run.
function hostProbeSequenceObservable() {
  const rows = readObserverRows();
  const named = rows.map((row) => row.raw_event || row);
  const agentPre = named.filter((event) => event.hook_event_name === 'PreToolUse' && event.tool_name === 'Agent');
  const starts = named.filter((event) => event.hook_event_name === 'SubagentStart');
  return agentPre.length >= 2 && starts.length >= 3;
}

function armHostProbeContinuation() {
  if (hostProbeContinuationTimer !== null) return;
  hostProbeContinuationTimer = setTimeout(() => {
    hostProbeContinuationTimer = null;
    // Deadline reached with the sequence still outstanding: finalize and let the
    // contract report the truth. This must never be turned into a pass.
    finalizeHostContractProbe();
    writeState();
  }, HOST_PROBE_CONTINUATION_MS);
  if (typeof hostProbeContinuationTimer.unref === 'function') hostProbeContinuationTimer.unref();
}

function finalizeHostContractProbe() {
  if (hostProbeFinalized) return;
  hostProbeFinalized = true;
  if (hostProbeContinuationTimer !== null) {
    clearTimeout(hostProbeContinuationTimer);
    hostProbeContinuationTimer = null;
  }
  const rows = readObserverRows();
  const expectedEvidenceMode = transportProfile === 'native-claude-cli' ? 'genuine-pinned' : 'fake-fixture';
  state.observations_digest = digestObject(rows);
  // Recorded before ANY verdict, so it stays truthful no matter which guard the
  // run stops at: how much of the sequence actually existed at the moment
  // finalization ran. Finalizing on the first terminal result pins this at one
  // spawn and one start; a correctly spanned probe reaches two and three.
  {
    const observed = rows.map((row) => row.raw_event || row);
    state.probe_observed_agent_spawns = observed
      .filter((event) => event.hook_event_name === 'PreToolUse' && event.tool_name === 'Agent').length;
    state.probe_observed_subagent_starts = observed
      .filter((event) => event.hook_event_name === 'SubagentStart').length;
  }
  if (rows.length === 0) return fail('HOST_PIN_UNPROVEN', 'The host observer produced no evidence.');
  if (rows.some((row) => row.producer !== 'claude-host-contract-probe')) {
    return fail('HOST_PIN_UNPROVEN', 'Observer evidence came from an untrusted producer.');
  }
  if (rows.some((row) => row.evidence_mode !== expectedEvidenceMode)) {
    return fail('INVALID_EVIDENCE_MODE', `Expected ${expectedEvidenceMode} observer evidence for ${transportProfile}.`);
  }
  const events = rows.map((row, index) => ({ row, event: row.raw_event || row, index }));
  if (events.some(({ event }) => event.session_id !== sessionId)) {
    return fail('INVALID_STREAM_SESSION', 'A host-contract observer event belonged to a foreign session.');
  }
  if (!events.some(({ event }) => event.hook_event_name === 'SessionStart')) {
    return fail('HOST_PIN_UNPROVEN', 'SessionStart was not observed.');
  }

  const agentPre = events.filter(({ event }) => event.hook_event_name === 'PreToolUse' && event.tool_name === 'Agent');
  const agentStarts = events.filter(({ event }) => event.hook_event_name === 'SubagentStart');
  if (agentPre.length !== 2) {
    return fail('HOST_PIN_UNPROVEN', 'The probe did not observe exactly two sequential peer spawn calls.');
  }
  for (const name of ['probe-peer-a', 'probe-peer-b']) {
    const canonicalDigest = digestObject(probePeerInputs[name]);
    const pre = agentPre.find(({ event }) => event.tool_input && event.tool_input.name === name);
    if (!pre || pre.row.updated_input_digest !== canonicalDigest) {
      return fail('HOST_UNSUPPORTED_NO_UPDATED_INPUT', `Canonical updatedInput was not observed for ${name}.`);
    }
  }

  const aPre = agentPre.find(({ event }) => event.tool_input.name === 'probe-peer-a');
  const bPre = agentPre.find(({ event }) => event.tool_input.name === 'probe-peer-b');
  if (!aPre || !bPre || aPre.index >= bPre.index) {
    return fail('HOST_PIN_UNPROVEN', 'The peer spawn calls were absent or out of canonical A-then-B order.');
  }
  const aCanonicalDigest = digestObject(probePeerInputs['probe-peer-a']);
  const aPost = events.find(({ row, event }) => event.hook_event_name === 'PostToolUse'
    && event.tool_name === 'Agent' && row.tool_use_digest === aPre.row.tool_use_digest);
  state.canonical_input_digest = aCanonicalDigest;
  if (aPost) {
    const observedDigest = aPost.row.tool_input_digest
      || (aPost.event.tool_input === undefined ? null : digestObject(aPost.event.tool_input));
    state.observed_input_digest = observedDigest;
    state.evidence_method = 'POST_TOOL_INPUT';
    state.execution_input_exact = observedDigest === aCanonicalDigest;
    if (!state.execution_input_exact) {
      return fail('HOST_UNSUPPORTED_NO_EXECUTED_INPUT', 'PostToolUse exposed a divergent executed Agent input.');
    }
  }

  const aStartRow = agentStarts.find(({ index }) => index > aPre.index && index < bPre.index);
  const bStartRow = agentStarts.find(({ index }) => index > bPre.index);
  const aStart = aStartRow && aStartRow.event;
  const bStart = bStartRow && bStartRow.event;
  if (!aStart || !bStart || typeof aStart.agent_id !== 'string' || typeof bStart.agent_id !== 'string') {
    return fail('HOST_PIN_UNPROVEN', 'SubagentStart omitted a native agent_id.');
  }
  state.join_method = 'single-outstanding-spawn';
  state.actor_a_id_digest = sha256String(aStart.agent_id);
  state.actor_b_id_digest = sha256String(bStart.agent_id);
  if (aStart.agent_id === bStart.agent_id) {
    return fail('HOST_PEER_ID_COLLISION', 'Same-type peers reported the same native actor ID.');
  }
  state.distinct_same_type_peers = true;

  const readEvents = events.filter(({ event }) => event.hook_event_name === 'PreToolUse' && event.tool_name === 'Read');
  const directReads = readEvents.filter(({ event }) => typeof event.agent_id === 'string');
  if (directReads.length > 0) {
    state.actor_attribution_method = 'direct-agent-id';
    state.unattributed_coordinator_read_count = readEvents.length - directReads.length;
  } else {
    const childSessions = new Set(readEvents.map(({ event }) => event.session_id));
    if (childSessions.size > 1) state.actor_attribution_method = 'session-scoped';
    else return fail('HOST_PIN_UNPROVEN', 'Per-actor tool attribution is unavailable.');
  }
  const aReads = directReads.filter(({ event }) => event.agent_id === aStart.agent_id);
  const bReads = directReads.filter(({ event }) => event.agent_id === bStart.agent_id);
  const thirdRead = aReads[2] && aReads[2].event;
  if (bReads.length < 1) return fail('HOST_PIN_UNPROVEN', 'Actor B emitted no directly attributed tool event.');
  const wakeCandidates = events.filter(({ event }) => event.hook_event_name === 'PreToolUse'
    && event.tool_name === 'SendMessage'
    && event.tool_input
    && event.tool_input.to === probePeerInputs['probe-peer-a'].name);
  const wake = wakeCandidates.find((candidate) => events.some(({ row, event }) => (
    event.hook_event_name === 'PostToolUse'
    && event.tool_name === 'SendMessage'
    && row.tool_use_digest === candidate.row.tool_use_digest
    && event.tool_response
    && event.tool_response.success === true
  )));
  if (!wake) {
    return fail('HOST_UNSUPPORTED_NO_STABLE_RESUME', 'No successful wake was addressed to actor A by its native name.');
  }
  const unexpectedPreBRead = directReads.find(({ event, index }) => (
    index < bPre.index && event.agent_id !== aStart.agent_id
  ));
  if (unexpectedPreBRead) {
    return fail('HOST_REPLACEMENT_CHILD', 'A pre-peer-B tool event came from a replacement actor.');
  }
  const wakePost = events.find(({ row, event }) => event.hook_event_name === 'PostToolUse'
    && event.tool_name === 'SendMessage'
    && row.tool_use_digest === wake.row.tool_use_digest
    && event.tool_response
    && event.tool_response.success === true);
  const initialStop = events.find(({ event, index }) => event.hook_event_name === 'SubagentStop'
    && event.agent_id === aStart.agent_id
    && index > aStartRow.index
    && index < wake.index);
  if (!initialStop) return fail('HOST_UNSUPPORTED_NO_STOP', 'Actor A did not stop before its native wake.');
  if (!wakePost) return fail('HOST_UNSUPPORTED_NO_STABLE_RESUME', 'The native wake never completed successfully.');
  // The resume is caused by the wake REQUEST, not by its completion event: a
  // host may start the resumed actor while the wake tool call is still in
  // flight, so SubagentStart can legitimately precede PostToolUse(SendMessage).
  // Observed live on darwin. The window therefore opens at the wake itself.
  // This does not weaken anything: actor A is already required to have stopped
  // before `wake.index`, exactly one start may fall in the window, that start
  // must carry the unchanged actor id, and the overall A / resumed-A / B order
  // is still asserted below.
  const resumeStarts = agentStarts.filter(({ index }) => index > wake.index && index < bPre.index);
  if (resumeStarts.length !== 1) {
    return fail('HOST_UNSUPPORTED_NO_STABLE_RESUME', 'The successful native wake did not emit exactly one resumed SubagentStart.');
  }
  const resumedAStart = resumeStarts[0].event;
  if (resumedAStart.agent_id !== aStart.agent_id) {
    return fail('HOST_REPLACEMENT_CHILD', 'The successful native wake started a replacement actor.');
  }
  if (agentStarts.length !== 3
    || agentStarts[0] !== aStartRow
    || agentStarts[1] !== resumeStarts[0]
    || agentStarts[2] !== bStartRow) {
    return fail('HOST_PIN_UNPROVEN', 'SubagentStart order was not exactly A, resumed A, then B.');
  }
  state.wake_address_method = 'native-name-plus-stable-agent-id';
  state.wake_tool_use_digest = wake.row.tool_use_digest;
  if (thirdRead && thirdRead.agent_id !== aStart.agent_id) {
    return fail('HOST_REPLACEMENT_CHILD', 'The post-wake event came from a replacement actor.');
  }
  const canonicalFirstRead = path.join(runRoot, 'probe-a-one.txt');
  if (!aPost) {
    const firstPath = aReads[0] && aReads[0].event.tool_input && aReads[0].event.tool_input.file_path;
    if (!aStart || !sameCanonicalFile(firstPath, canonicalFirstRead)) {
      return fail('HOST_UNSUPPORTED_NO_EXECUTED_INPUT', 'Neither executed-input observation rung was available.');
    }
    state.evidence_method = 'START_PLUS_FIRST_OBSERVED_COMMAND';
    state.execution_input_exact = null;
    state.observed_input_digest = null;
  }
  if (aReads.length < 3) return fail('HOST_UNSUPPORTED_NO_STABLE_RESUME', 'Three attributed actor-A tool events were not observed.');

  const resumedStop = events.find(({ event, index }) => event.hook_event_name === 'SubagentStop'
    && event.agent_id === aStart.agent_id
    && index > resumeStarts[0].index
    && index < bPre.index
    // A resumed turn is a NEW prompt for the SAME actor, so the resumed stop
    // correlates to the RESUMED start's prompt, never the original one.
    // Same-actor continuity is still enforced above by agent_id.
    && (!resumedAStart.prompt_id || event.prompt_id === resumedAStart.prompt_id));
  if (!resumedStop) return fail('HOST_UNSUPPORTED_NO_STOP', 'Resumed actor A did not emit a correlated SubagentStop.');
  if (!thirdRead || thirdRead.agent_id !== aStart.agent_id) {
    return fail('HOST_REPLACEMENT_CHILD', 'The post-wake event came from a replacement actor.');
  }
  const thirdPath = thirdRead.tool_input && thirdRead.tool_input.file_path;
  if (typeof thirdPath !== 'string' || !thirdPath.includes(probeNonce)) {
    return fail('HOST_CONTEXT_NOT_RETAINED', 'The resumed actor did not retain the pre-stop nonce.');
  }

  state.stable_actor_resume = true;
  state.context_retained = true;
  state.extra_tools_mcp_compatible = Boolean(state.init
    && state.init.tools.length > 3 && state.init.mcp_server_count > 0);
  state.required_hooks_observed = ['SessionStart', 'PreToolUse', 'PostToolUse', 'SubagentStart', 'SubagentStop']
    .every((hookName) => events.some(({ event }) => event.hook_event_name === hookName));
  state.host_capability = nativeClaudeExecutable ? 'HOST_CONTRACT_OBSERVED' : 'NOT_HOST_EVIDENCE';
  state.status = 'HOST_CONTRACT_PROBE_COMPLETED';
  state.probe_completed_at = new Date().toISOString();
  writeState();
  child.stdin.end(() => {
    stdinClosedAfterTerminal = true;
    state.stdin_closed_after_terminal = true;
    writeState();
  });
}

function finalizeAgentActions({ deferReentry = false } = {}) {
  const expectedActions = pending.actions.filter((action) => actionOperation(action) === 'Agent');
  const observations = entrypointObserverEvents();
  const posts = observations.filter((row) => row.hook_event_name === 'PostToolUse'
    && row.session_id === sessionId && row.tool_name === 'Agent');
  const starts = observations.filter((row) => row.hook_event_name === 'SubagentStart'
    && row.session_id === sessionId);
  const usedToolIds = new Set();
  const results = [];
  let duplicateStartRole = null;
  for (const action of expectedActions) {
    const canonical = canonicalAgentInput(action);
    if (!canonical) return fail('INVALID_AGENT_ACTIONS', 'ACTION_REQUIRED contained an invalid Agent action.');
    const canonicalDigest = digestObject(canonical);
    const post = posts.find((row) => !usedToolIds.has(row.tool_use_id)
      && row.tool_input
      && row.tool_input.subagent_type === canonical.subagent_type
      && row.tool_input.name === canonical.name);
    const proposal = post && pending.proposals.find((item) => item.tool_use_id === post.tool_use_id);
    const matchingStarts = starts.filter((row) => row.agent_type === canonical.name);
    if (matchingStarts.length > 1) duplicateStartRole = canonical.name;
    const start = matchingStarts.length === 1 ? matchingStarts[0] : null;
    const observedDigest = post ? digestObject(post.tool_input) : null;
    const rawDigest = proposal ? digestObject(proposal.input) : null;
    const executionExact = observedDigest === canonicalDigest;
    const accepted = Boolean(post && proposal && start && executionExact);
    if (post) usedToolIds.add(post.tool_use_id);
    results.push({
      action_id: action.action_id,
      tool_use_digest: post ? sha256String(post.tool_use_id) : null,
      family: action.kind,
      role: canonical.name,
      raw_proposal_digest: rawDigest,
      canonical_input_digest: canonicalDigest,
      observed_input_digest: observedDigest,
      model_deviation: rawDigest === null ? null : rawDigest !== canonicalDigest,
      background_expected: canonical.run_in_background,
      start_correlated: Boolean(start),
      evidence_method: post ? 'POST_TOOL_INPUT' : 'INCOMPLETE',
      execution_input_exact: post ? executionExact : null,
      accepted,
    });
  }
  const rootSourceBatch = expectedActions.every((action) => action.kind === 'root-source-spawn');
  const batchExact = results.every((item) => item.accepted);
  if (rootSourceBatch) {
    const nestedProtocols = pending.proposals.map((proposal) => rootSourceNestedProtocols.get(proposal.tool_use_id));
    const nestedBashPosts = observations.filter((row) => row.hook_event_name === 'PostToolUse'
      && row.session_id === sessionId && row.tool_name === 'Bash');
    for (const protocol of nestedProtocols) {
      if (!protocol || !protocol.first_tool_use_id) continue;
      const executed = nestedBashPosts.find((row) => row.tool_use_id === protocol.first_tool_use_id);
      protocol.first_tool_exact = Boolean(executed && executedRootSourcePublishCommandExact(
        executed.tool_input && executed.tool_input.command,
        protocol.expected_publish_command,
      ));
    }
    state.root_source_first_nested_tool_exact = nestedProtocols.every(
      (protocol) => protocol && protocol.first_tool_exact === true,
    );
    if (nestedProtocols.some((protocol) => !protocol || protocol.first_tool_exact !== true)) {
      return fail('INVALID_ROOT_SOURCE_PROTOCOL',
        'The root-source Agent first nested tool call did not execute the exact publish_command.');
    }
    state.root_source_actions = [...(state.root_source_actions || []), ...results];
    state.root_source_agent_calls_exact = state.root_source_actions.every((item) => item.accepted);
    state.root_source_agent_call_count = state.root_source_actions.filter((item) => item.accepted).length;
    state.root_source_agent_action_order = state.root_source_actions.map((item) => item.role);
  } else {
    state.actions = results;
    state.agent_calls_exact = batchExact;
    state.agent_call_count = results.filter((item) => item.accepted).length;
    state.agent_action_order = results.map((item) => item.role);
  }
  if (duplicateStartRole) {
    return fail('INVALID_AGENT_ACTIONS', `duplicate SubagentStart for ${duplicateStartRole}`);
  }
  if (pending.proposals.length !== expectedActions.length || !batchExact) {
    const foreignObservation = observations.some((row) => row.session_id && row.session_id !== sessionId);
    const reason = foreignObservation
      ? 'Agent observation belonged to a foreign session.'
      : 'Agent execution lacked one-to-one canonical host observation and correlated start.';
    return fail('INVALID_AGENT_ACTIONS', reason);
  }
  state.verdict = 'AGENT_ACTIONS_ACCEPTED';
  if (deferReentry) {
    writeState();
    return;
  }
  const entrypointName = pending.entrypoint;
  pending = null;
  dispatchEntrypointReentry(entrypointName);
  writeState();
}

function finalizeSupervisorStartActions({ deferReentry = false } = {}) {
  const expectedActions = pending.actions.filter((action) => actionOperation(action) === 'Bash');
  const observations = entrypointObserverEvents();
  const posts = observations.filter((row) => row.hook_event_name === 'PostToolUse'
    && row.session_id === sessionId && row.tool_name === 'Bash');
  const usedToolIds = new Set();
  const results = [];
  for (const action of expectedActions) {
    const canonical = canonicalSupervisorStartInput(action);
    if (!canonical) {
      return fail('INVALID_SUPERVISOR_START_ACTIONS',
        'ACTION_REQUIRED contained an invalid supervisor-start action.');
    }
    const proposal = pending.supervisorStartProposals[results.length];
    const post = proposal && posts.find((row) => row.tool_use_id === proposal.tool_use_id
      && !usedToolIds.has(row.tool_use_id));
    const proposalExact = Boolean(proposal
      && proposal.input.command === canonical.command
      && proposal.input.run_in_background === true);
    const executionExact = Boolean(post && post.tool_input
      && post.tool_input.command === canonical.command
      && post.tool_input.run_in_background === true);
    if (post) usedToolIds.add(post.tool_use_id);
    results.push({
      action_id: action.action_id,
      family: action.kind,
      raw_proposal_digest: proposal ? digestObject(proposal.input) : null,
      canonical_input_digest: digestObject(canonical),
      observed_input_digest: post ? digestObject(post.tool_input) : null,
      proposal_exact: proposalExact,
      execution_input_exact: executionExact,
      evidence_method: post ? 'POST_TOOL_INPUT' : 'INCOMPLETE',
      accepted: proposalExact && executionExact,
    });
  }
  const batchExact = pending.supervisorStartProposals.length === expectedActions.length
    && results.every((item) => item.accepted);
  state.supervisor_start_actions = results;
  state.supervisor_start_calls_exact = batchExact;
  state.supervisor_start_call_count = results.filter((item) => item.accepted).length;
  if (!batchExact) {
    return fail('INVALID_SUPERVISOR_START_ACTIONS',
      'Supervisor-start execution lacked one-to-one canonical Bash host observation.');
  }
  state.verdict = 'SUPERVISOR_START_ACTIONS_ACCEPTED';
  if (deferReentry) {
    writeState();
    return;
  }
  const entrypointName = pending.entrypoint;
  pending = null;
  dispatchEntrypointReentry(entrypointName);
  writeState();
}

function parseToolResultEnvelope(block) {
  if (!block || block.type !== 'tool_result' || typeof block.content !== 'string') return null;
  const start = block.content.indexOf('{');
  if (start === -1) return null;
  try {
    const value = JSON.parse(block.content.slice(start));
    return value && value.schema === 'runtime/collaboration-entrypoint-result/v1' ? value : null;
  } catch {
    return null;
  }
}

// P4-U1 owned-cleanup-only: `stop-owned` answers through
// runtime-role-lifecycle.cjs's own `coordination/lifecycle-cli-result/v1`
// schema, never the collaboration-entrypoint schema above.
function parseLifecycleCliResultEnvelope(block) {
  if (!block || block.type !== 'tool_result' || typeof block.content !== 'string') return null;
  const start = block.content.indexOf('{');
  if (start === -1) return null;
  try {
    const value = JSON.parse(block.content.slice(start));
    return value && value.schema === 'coordination/lifecycle-cli-result/v1'
      && typeof value.command === 'string' ? value : null;
  } catch {
    return null;
  }
}

function p5ArtifactEvidence(pathname) {
  const bytes = fs.readFileSync(pathname);
  return { path: pathname, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
}

function p5FakeReadback(intentId) {
  const subjectDigest = crypto.createHash('sha256').update(fs.readFileSync(p5SubjectPath)).digest('hex');
  return {
    schema: 'runtime/mixed-review-readback/v1',
    request_digest: sha256String(`fake-request:${intentId}`),
    verdict_digest: sha256String(`fake-verdict:${intentId}`),
    subject_digest: subjectDigest,
    requester_actor_digest: sha256String(`fake-requester:${sessionId}`),
    reviewer_actor_digest: sha256String(`fake-reviewer:${sessionId}`),
    outcome: 'GO', checked_at: '2026-09-09T00:00:00Z', validation_passed: true,
  };
}

function p5TryBuildLiveReadback(intentId) {
  const rll = require('../lib/runtime-role-lifecycle.cjs');
  const rbc = require('../lib/runtime-bridge-codex.cjs');
  if (!p5ReviewerSnapshot) {
    const reviewer = rbc.resolveLiveCodexAppServerWorker(
      projectRoot, 'arch-platform', rll.roleProfileDigestFor('arch-platform'),
    );
    if (reviewer && reviewer.ok && reviewer.available
        && reviewer.worker && typeof reviewer.worker.threadId === 'string'
        && reviewer.worker.threadId.length > 0) {
      p5ReviewerSnapshot = { ...reviewer.worker };
    }
  }
  if (!p5ReviewerSnapshot) return { ok: false, reason: 'reviewer-thread-not-observed-yet' };
  const intentRead = rll.readRootConsultIntent(projectRoot, intentId);
  if (!intentRead.ok || intentRead.absent) return { ok: false, reason: 'intent-not-ready' };
  const intent = intentRead.intent;
  const subjectRead = rll.readRegistryRecord(rll.mixedReviewSubjectPathFor(projectRoot, intentId));
  const verdictRead = rll.readRegistryRecord(rll.mixedReviewVerdictPathFor(projectRoot, intentId));
  if (!subjectRead.ok || subjectRead.absent || !verdictRead.ok || verdictRead.absent) {
    return { ok: false, reason: 'verdict-not-ready' };
  }
  const requester = rll.readRoleBindingState(
    projectRoot, intent.worktree_id, intent.plan_digest,
    rll.roleProfileDigestFor(intent.requester_role), intent.session_generation_id,
    intent.requester_role,
  );
  if (!requester.ok || !requester.record || !['READY', 'WAITING', 'BUSY'].includes(requester.state)) {
    return { ok: false, reason: 'requester-not-ready' };
  }
  return {
    ...rll.buildMixedReviewReadbackReceipt({
      intent, subject: subjectRead.obj, requesterBinding: requester.record,
      reviewerWorker: p5ReviewerSnapshot, verdict: verdictRead.obj,
      checkedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    }),
    artifacts: {
      intent: p5ArtifactEvidence(rll.rootConsultIntentPathFor(projectRoot, intentId)),
      subject: p5ArtifactEvidence(rll.mixedReviewSubjectPathFor(projectRoot, intentId)),
      verdict: p5ArtifactEvidence(rll.mixedReviewVerdictPathFor(projectRoot, intentId)),
    },
  };
}

function p5BeginReadback(intentId) {
  const deadline = Date.now() + 120_000;
  const poll = () => {
    if (String(state.status).startsWith('INVALID_')) return;
    const result = process.env.P4_CERT_OFFLINE_TEST === '1'
      ? (process.env.P4_CERT_FAKE_SCENARIO === 'p5-readback-invalid'
        ? { ok: false, reason: 'offline-forged-verdict' }
        : { ok: true, record: p5FakeReadback(intentId), verdict: { decision: 'GO' }, artifacts: {} })
      : p5TryBuildLiveReadback(intentId);
    if (result.ok) {
      const evidence = {
        schema: 'androidcommondoc/p5-mixed-review-evidence/v1',
        intent_id: intentId,
        reviewed_head: p5ReviewedHead,
        immutable_subject: p5ArtifactEvidence(p5SubjectPath),
        reviewer_snapshot: p5ReviewerSnapshot,
        registry_artifacts: result.artifacts,
        receipt: result.record,
        favorable_verdict_required: false,
      };
      writeJson(path.join(runRoot, 'p5-mixed-review-readback.json'), evidence);
      state.p5_mixed_review = { intent_id: intentId, outcome: result.record.outcome, validation_passed: true };
      p5Stage = 'docs-consult';
      state.p5_stage = p5Stage;
      dispatchManagedLifecycle(p5DocsConsultTokens, 'consult-root', 'arch-platform',
        sha256String(`consult-root:${p5DocsIntentValue}`), 'p5-docs-consult',
        p5CommandPrompt(p5DocsConsultCommand,
          'submit one read-only documentation consultation to the retained context-provider through the mixed runtime.'));
      writeState();
      return;
    }
    if (process.env.P4_CERT_OFFLINE_TEST === '1' || Date.now() >= deadline) {
      return fail('INVALID_P5_READBACK', `P5 mixed-review readback did not validate: ${result.reason || 'timeout'}`);
    }
    p5ReadbackTimer = setTimeout(poll, 100);
  };
  poll();
}

function p5OperationHasSixRefs(operation) {
  return operation && ['result_ref', 'result_digest', 'accepted_result_ref',
    'accepted_result_digest', 'ack_ref', 'ack_digest']
    .every((field) => typeof operation[field] === 'string' && operation[field].length > 0);
}

/**
 * The part of a lifecycle rejection worth carrying into the launcher's own failure. The CLI already
 * distinguishes a self-review, a requester that is not Claude-native, an invalid target topology,
 * an unavailable retained bridge or resolver, an unavailable retained worker and an owner mismatch;
 * collapsing all seven into one sentence is what made a live rejection unactionable.
 * @param {*} result
 * @returns {string} '' when there is nothing more specific to say.
 */
function describeLifecycleRejection(result) {
  if (!result || typeof result !== 'object') return ' (no result envelope)';
  const parts = [];
  if (typeof result.command === 'string') parts.push('command=' + result.command);
  if (result.ok !== undefined) parts.push('ok=' + String(result.ok));
  if (typeof result.status === 'string') parts.push('status=' + result.status);
  if (typeof result.reason === 'string' && result.reason.length > 0) parts.push('reason=' + result.reason);
  return parts.length > 0 ? ' (' + parts.join(', ') + ')' : '';
}

function handleP5LifecycleResult(result) {
  if (!p5Scenario) return;
  if (p5Stage === 'mixed-review-request') {
    const intentId = result.operation && result.operation.operation_id;
    if (result.command !== 'mixed-review-request' || result.ok !== true
        || result.status !== 'WAITING' || !/^[0-9a-f]{32}$/.test(intentId || '')) {
      return fail('INVALID_P5_MIXED_REVIEW',
        'mixed-review-request did not publish one correlated WAITING intent'
        + describeLifecycleRejection(result) + '.');
    }
    state.p5_mixed_review_request = { intent_id: intentId, request_id: result.operation.request_id };
    p5Stage = 'mixed-review-readback';
    state.p5_stage = p5Stage;
    p5BeginReadback(intentId);
    return;
  }
  if (p5Stage === 'docs-consult') {
    const intentId = result.operation && result.operation.operation_id;
    if (result.command !== 'consult-root' || result.ok !== true
        || result.status !== 'WAITING' || !/^[0-9a-f]{32}$/.test(intentId || '')) {
      return fail('INVALID_P5_DOCS_MCP',
        'consult-root did not publish one correlated WAITING intent'
        + describeLifecycleRejection(result) + '.');
    }
    state.p5_docs_mcp = { intent_id: intentId, request_id: result.operation.request_id };
    p5Stage = 'docs-status';
    state.p5_stage = p5Stage;
    dispatchManagedLifecycle(p5DocsStatusTokens(intentId), 'consult-root-status', 'arch-platform',
      sha256String(`consult-root-status:${intentId}`), 'p5-docs-status-1',
      p5CommandPrompt(p5DocsStatusCommand(intentId),
        'read the current durable status of the same documentation consultation.'));
    return;
  }
  if (p5Stage === 'docs-status') {
    if (result.command !== 'consult-root-status') {
      return fail('INVALID_P5_DOCS_MCP', 'Unexpected lifecycle command while awaiting docs MCP result.');
    }
    if (result.ok === true && result.status === 'READY' && p5OperationHasSixRefs(result.operation)) {
      state.p5_docs_mcp = { ...state.p5_docs_mcp, operation: result.operation, validated: true };
      writeJson(path.join(runRoot, 'p5-docs-mcp-evidence.json'), {
        schema: 'androidcommondoc/p5-docs-mcp-evidence/v1',
        intent_id: state.p5_docs_mcp.intent_id,
        request_id: state.p5_docs_mcp.request_id,
        operation: result.operation,
        same_session_id_digest: sha256String(sessionId),
      });
      p5Stage = 'completed';
      state.p5_stage = p5Stage;
      state.status = 'P5_SCENARIO_COMPLETED';
      state.protocol_completed_at = new Date().toISOString();
      writeState();
      closeMainAfterDirectRoles();
      return;
    }
    if (!['WAITING', 'BLOCKED'].includes(result.status) || ++p5DocsPollCount > 80) {
      return fail('INVALID_P5_DOCS_MCP', `consult-root-status ended as ${result.status}.`);
    }
    setTimeout(() => {
      const statusIntentId = state.p5_docs_mcp.intent_id;
      dispatchManagedLifecycle(p5DocsStatusTokens(statusIntentId), 'consult-root-status', 'arch-platform',
        sha256String(`consult-root-status:${statusIntentId}`),
        `p5-docs-status-${p5DocsPollCount + 1}`,
        p5CommandPrompt(p5DocsStatusCommand(statusIntentId),
          'read the current durable status of the same documentation consultation.'));
    }, 250);
  }
}

function validTerminalArtifactRef(value) {
  return typeof value === 'string'
    && /^(?!\/)(?![A-Za-z]:)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+$/.test(value);
}

function validateTerminalResult(result) {
  return result !== null && typeof result === 'object' && !Array.isArray(result)
    && canonicalJSONStringify(Object.keys(result).sort()) === canonicalJSONStringify([
      'accepted_result_digest', 'accepted_result_ref', 'ack_digest', 'ack_ref',
      'result_digest', 'result_ref',
    ])
    && validTerminalArtifactRef(result.result_ref)
    && /^[a-f0-9]{64}$/.test(result.result_digest)
    && validTerminalArtifactRef(result.accepted_result_ref)
    && /^[a-f0-9]{64}$/.test(result.accepted_result_digest)
    && validTerminalArtifactRef(result.ack_ref)
    && /^[a-f0-9]{64}$/.test(result.ack_digest);
}

function scheduleEmptyActionPoll(entrypointName) {
  // The ramp is 1, 2, 4, 5, 5 and then stays at its 5-second cap; the budget is the last relayed
  // action set's own expiry. With no expiry to honour -- nothing with an expires_at has been
  // relayed yet -- the ramp's length remains the bound, so this can never poll unbounded.
  const delaySeconds = pollScheduleSeconds[Math.min(emptyPollCount, pollScheduleSeconds.length - 1)];
  if (lastRelayedActionExpiryMs === null) {
    if (emptyPollCount >= pollScheduleSeconds.length) {
      return fail('UNSTARTED_RETRY_EXHAUSTED', 'Empty ACTION_REQUIRED polling exhausted the bounded 1/2/4/5/5 schedule.');
    }
  } else if (Date.now() + (delaySeconds * 1000) >= lastRelayedActionExpiryMs) {
    return fail('UNSTARTED_RETRY_EXHAUSTED',
      'Empty ACTION_REQUIRED polling reached the last relayed action set expiry '
      + new Date(lastRelayedActionExpiryMs).toISOString() + '.');
  }
  emptyPollCount += 1;
  state.status = 'WAITING';
  state.waiting_detail = 'ACTION_REQUIRED_EMPTY';
  state.poll_delays_seconds = [...(state.poll_delays_seconds || []), delaySeconds];
  writeState();
  setTimeout(() => {
    if (state.status !== 'WAITING') return;
    state.status = 'ACTIVE';
    const step = managedStepForEntrypoint(entrypointName);
    if (managedConductor && step) managedEntrypointSteps[step]();
    else queueUserMessage(`${entrypointName}-poll-${emptyPollCount}`, commandPrompt(entrypointName));
    writeState();
  }, delaySeconds * offlinePollScaleMs);
}

// P4-U1 full-scenario role-actor continuity evidence (closed behavior #5/#7):
// a per-role sorted digest set of every SubagentStart seen so far for the
// five canonical support roles. Used to prove the idempotent second
// init-session start and resume-work never introduce another Agent start
// (and that monitor-docs never mutates the owned role plane) for those roles.
function p4RoleActorSnapshot() {
  if (managedConductor) {
    const snapshot = {};
    for (const role of P4_SUPPORT_ROLES) {
      snapshot[role] = state.direct_role_hosts
        .filter((host) => host.persistent === true && host.role === role)
        .map((host) => host.session_digest)
        .sort();
    }
    return snapshot;
  }
  const rows = entrypointObserverEvents();
  const starts = rows.filter((row) => row.hook_event_name === 'SubagentStart');
  const snapshot = {};
  for (const role of P4_SUPPORT_ROLES) {
    snapshot[role] = starts
      .filter((row) => row.agent_type === role)
      .map((row) => sha256String(String(row.agent_id)))
      .sort();
  }
  return snapshot;
}

function p4RoleActorSnapshotsEqual(before, after) {
  return canonicalJSONStringify(before) === canonicalJSONStringify(after);
}

function p4ResumeSnapshotProvesSameActors(before, after) {
  if (managedConductor) return p4RoleActorSnapshotsEqual(before, after)
    && P4_SUPPORT_ROLES.every((role) => Array.isArray(after && after[role]) && after[role].length === 1);
  return P4_SUPPORT_ROLES.every((role) => {
    const original = before && before[role];
    const resumed = after && after[role];
    return Array.isArray(original) && original.length === 1
      && Array.isArray(resumed) && resumed.length === 2
      && resumed[0] === original[0] && resumed[1] === original[0];
  });
}

function setP4Stage(next) {
  p4Stage = next;
  state.p4_stage = next;
}

function recordP4Step(name, envelope, extra) {
  state.p4_steps = state.p4_steps || [];
  state.p4_steps.push({
    name,
    entrypoint: envelope.entrypoint,
    status: envelope.status,
    detail: envelope.detail,
    sequence: state.sequence,
    ...(extra || {}),
  });
}

// The closed P4-U1 stage table (PLAN.md ~L677-682): each stage's expected
// terminal entrypoint/status. Bootstrap's own ACTION_REQUIRED/Agent-fanout
// cycle stays on the generic, entrypoint-agnostic path above unchanged; this
// table only governs the terminal result that ends each stage.
const P4_STAGE_TABLE = {
  bootstrap: { entrypoint: 'init-session', status: 'READY' },
  'second-ensure': { entrypoint: 'init-session', status: 'READY' },
  resume: { entrypoint: 'resume-work', status: 'READY' },
  work: { entrypoint: 'work', status: 'COMPLETED' },
  'ingest-denied': { entrypoint: 'ingest-content', status: 'BLOCKED' },
  'ingest-approved': { entrypoint: 'ingest-content', status: 'COMPLETED' },
  monitor: { entrypoint: 'monitor-docs', status: 'COMPLETED' },
};

function advanceBootstrap(envelope) {
  if (envelope.actions.length !== 0) {
    return fail('INVALID_P4_SEQUENCE', 'bootstrap READY unexpectedly carried actions.');
  }
  state.p4_role_actor_digests = p4RoleActorSnapshot();
  recordP4Step('bootstrap', envelope);
  setP4Stage('second-ensure');
  dispatchManagedEntrypoint('init-session', 'p4-second-ensure', directCommandPrompt(initCommand));
}

function advanceSecondEnsure(envelope) {
  if (envelope.actions.length !== 0) {
    return fail('INVALID_P4_SEQUENCE', 'idempotent second init-session start unexpectedly proposed new actions.');
  }
  if (!p4RoleActorSnapshotsEqual(state.p4_role_actor_digests, p4RoleActorSnapshot())) {
    return fail('INVALID_P4_SEQUENCE', 'idempotent second init-session start introduced another Agent start for an owned role.');
  }
  recordP4Step('second-ensure', envelope);
  setP4Stage('resume');
  dispatchManagedEntrypoint('resume-work', 'p4-resume', directCommandPrompt(resumeCommand));
}

function advanceResume(envelope) {
  if (envelope.actions.length !== 0) {
    return fail('INVALID_P4_SEQUENCE', 'resume-work unexpectedly proposed recovery actions.');
  }
  const resumedSnapshot = p4RoleActorSnapshot();
  if (!p4ResumeSnapshotProvesSameActors(state.p4_role_actor_digests, resumedSnapshot)) {
    return fail('INVALID_P4_SEQUENCE', 'resume-work replaced an owned role actor instead of resuming it in place.');
  }
  if (state.p4_resume_sendmessage_action_count !== P4_SUPPORT_ROLES.length) {
    return fail('INVALID_P4_SEQUENCE', 'resume-work did not execute exactly one correlated SendMessage action per support role.');
  }
  state.p4_role_actor_resumed_digests = resumedSnapshot;
  recordP4Step('resume', envelope);
  setP4Stage('work');
  dispatchManagedEntrypoint('work', 'p4-work', directCommandPrompt(workCommand));
}

function advanceWork(envelope) {
  if (!validateTerminalResult(envelope.result)) {
    return fail('INVALID_TERMINAL_RESULT', 'COMPLETED lacked a complete result/accepted-result/ACK digest chain.');
  }
  state.completion_result = envelope.result ? {
    role: 'toolkit-specialist', subject_ref: workSubjectRef, ...envelope.result,
  } : null;
  recordP4Step('work', envelope, { subject_ref: workSubjectRef });
  setP4Stage('ingest-denied');
  dispatchManagedEntrypoint('ingest-denied', 'p4-ingest-denied', directCommandPrompt(ingestDeniedCommand));
}

function advanceIngestDenied(envelope) {
  if (envelope.detail !== 'approval-required' || envelope.actions.length !== 0 || envelope.result !== null) {
    return fail('INVALID_P4_SEQUENCE', 'denied ingestion did not fail closed with zero action and zero accepted write.');
  }
  recordP4Step('ingest-denied', envelope);
  setP4Stage('ingest-approved');
  dispatchManagedEntrypoint('ingest-approved', 'p4-ingest-approved', directCommandPrompt(ingestApprovedCommand));
}

function advanceIngestApproved(envelope) {
  const result = envelope.result;
  const validShape = result !== null && typeof result === 'object' && !Array.isArray(result)
    && result.request_ref === ingestRequestRefArg
    && result.approval_ref === ingestApprovalRefArg
    && result.request_digest === ingestRequestRefArg.slice('request:'.length)
    && result.approval_digest === ingestApprovalRefArg.slice('approval:'.length)
    && typeof result.result_ref === 'string' && result.result_ref.length > 0
    && typeof result.result_digest === 'string' && /^[a-f0-9]{64}$/.test(result.result_digest)
    && ['written', 'deduplicated'].includes(result.disposition)
    && typeof result.audit_status === 'string' && result.audit_status.length > 0;
  if (!validShape || envelope.actions.length !== 0) {
    return fail('INVALID_P4_SEQUENCE', 'approved ingestion lacked or mismatched the canonical request/approval digest chain.');
  }
  recordP4Step('ingest-approved', envelope, { ingestion_result: result });
  setP4Stage('monitor');
  dispatchManagedEntrypoint('monitor-docs', 'p4-monitor', directCommandPrompt(monitorCommand));
}

function advanceMonitor(envelope) {
  const result = envelope.result;
  if (envelope.actions.length !== 0 || !result || !Array.isArray(result.observations) || !Array.isArray(result.proposals)) {
    return fail('INVALID_P4_SEQUENCE', 'monitor-docs did not complete as a read-only observation/proposal report.');
  }
  if (!p4RoleActorSnapshotsEqual(state.p4_role_actor_resumed_digests, p4RoleActorSnapshot())) {
    return fail('INVALID_P4_SEQUENCE', 'monitor-docs mutated the owned role plane.');
  }
  recordP4Step('monitor', envelope, {
    observations_count: result.observations.length,
    proposals_count: result.proposals.length,
  });
  setP4Stage('cleanup');
  dispatchManagedLifecycle(stopOwnedTokens[0], 'stop-owned', P4_SUPPORT_ROLES[0],
    sha256String(`stop-owned:${P4_SUPPORT_ROLES[0]}:session-close`),
    'p4-cleanup-1', directCommandPrompt(stopOwnedCommands[0]));
}

const P4_STAGE_HANDLERS = {
  bootstrap: advanceBootstrap,
  'second-ensure': advanceSecondEnsure,
  resume: advanceResume,
  work: advanceWork,
  'ingest-denied': advanceIngestDenied,
  'ingest-approved': advanceIngestApproved,
  monitor: advanceMonitor,
};

function advanceP4Stage(envelope) {
  const expected = P4_STAGE_TABLE[p4Stage];
  if (!expected || envelope.entrypoint !== expected.entrypoint || envelope.status !== expected.status) {
    return fail('INVALID_P4_SEQUENCE', `expected ${expected ? `${expected.entrypoint}/${expected.status}` : 'no further result'} for stage "${p4Stage}", saw ${envelope.entrypoint}/${envelope.status}.`);
  }
  if (typeof envelope.detail !== 'string' || envelope.detail.length === 0) {
    return fail('INVALID_P4_SEQUENCE', `stage "${p4Stage}" result carried no detail.`);
  }
  P4_STAGE_HANDLERS[p4Stage](envelope);
}

// P4-U1 owned cleanup (closed behavior #2 last bullet): the product exposes
// no collaboration-entrypoint cleanup command, so this drives the existing
// action-driven owned stop path (runtime-role-lifecycle.cjs stop-owned) for
// each of the five owned support roles and requires a durable STOPPED result
// before ever closing stdin -- never a raw kill of a healthy child.
function handleP4CleanupResult(result) {
  if (p4Stage !== 'cleanup') {
    return fail('INVALID_P4_SEQUENCE', `unexpected stop-owned result outside the cleanup stage (currently "${p4Stage}").`);
  }
  const expectedRole = P4_SUPPORT_ROLES[p4CleanupIndex];
  const action = Array.isArray(result.actions) ? result.actions[0] : null;
  const valid = result.command === 'stop-owned'
    && result.ok === true
    && result.status === 'STOPPED'
    && action && action.kind === 'role-stop-owned'
    && action.role === expectedRole;
  if (!valid) {
    return fail('INVALID_P4_SEQUENCE', `owned cleanup for role ${expectedRole} did not reach a durable STOPPED state.`);
  }
  state.p4_cleanup = state.p4_cleanup || [];
  state.p4_cleanup.push({ role: expectedRole, status: result.status, sequence: state.sequence });
  p4CleanupIndex += 1;
  if (p4CleanupIndex < P4_SUPPORT_ROLES.length) {
    const nextRole = P4_SUPPORT_ROLES[p4CleanupIndex];
    dispatchManagedLifecycle(stopOwnedTokens[p4CleanupIndex], 'stop-owned', nextRole,
      sha256String(`stop-owned:${nextRole}:session-close`),
      `p4-cleanup-${p4CleanupIndex + 1}`, directCommandPrompt(stopOwnedCommands[p4CleanupIndex]));
    return;
  }
  recordP4Step('cleanup', { entrypoint: 'stop-owned', status: 'STOPPED', detail: 'owned-cleanup-completed' });
  state.status = 'P4_FULL_SCENARIO_COMPLETED';
  state.protocol_completed_at = new Date().toISOString();
  writeState();
  closeMainAfterDirectRoles();
}

function handleEntrypointEnvelope(envelope) {
  state.last_entrypoint = envelope.entrypoint;
  state.last_entrypoint_status = envelope.status;
  if (envelope.status !== 'ACTION_REQUIRED') {
    managedProgressEpoch += 1;
    state.managed_progress_epoch = managedProgressEpoch;
  }
  if (envelope.status === 'ACTION_REQUIRED') {
    if (!Array.isArray(envelope.actions)) {
      return fail('INVALID_ACTION_RELAY', 'ACTION_REQUIRED actions must be an array.');
    }
    // The bound travels with the actions themselves. An empty projection carries none, so it
    // leaves whatever the last real set established untouched.
    const relayedExpiryMs = envelope.actions
      .map((action) => Date.parse(action && action.expires_at))
      .filter((value) => Number.isFinite(value))
      .reduce((max, value) => (value > max ? value : max), 0);
    if (relayedExpiryMs > 0) {
      lastRelayedActionExpiryMs = relayedExpiryMs;
      state.last_relayed_action_expiry = new Date(relayedExpiryMs).toISOString();
    }
    if (envelope.actions.length === 0) {
      return scheduleEmptyActionPoll(envelope.entrypoint);
    }
    if (envelope.actions.some((action) => actionOperation(action) === null)) {
      return fail('INVALID_ACTION_RELAY', 'ACTION_REQUIRED contained an unsupported or contradictory host action.');
    }
    if (pending) return fail('INVALID_ACTION_RELAY', 'A second action list arrived before the first settled.');
    // Every action in this batch is a supervisor-start this run already launched: the bridge
    // is still coming up, so this is the same WAITING projection an empty action list is,
    // never a fresh delivery. Route it into the existing bounded poll instead of recording it
    // as a repeat or executing it again.
    if (managedConductor && envelope.actions.length > 0
        && envelope.actions.every((action) => actionOperation(action) === 'Bash'
          && executedSupervisorStartActionIds.has(action.action_id))) {
      state.supervisor_start_inflight_polls = (state.supervisor_start_inflight_polls || 0) + 1;
      return scheduleEmptyActionPoll(envelope.entrypoint);
    }
    let relayEnvelope = envelope;
    if (managedConductor) {
      const semanticActionSetDigest = digestObject({
        actions: envelope.actions.map((action) => {
          const { action_id: ignoredActionId, ...semanticAction } = action;
          return semanticAction;
        }),
        entrypoint: envelope.entrypoint,
      });
      if (deliveredManagedActionSetDigests.has(semanticActionSetDigest)) {
        return fail('INVALID_ACTION_RELAY',
          `${envelope.entrypoint} repeated a semantically identical action set without terminal progress.`);
      }
      deliveredManagedActionSetDigests.add(semanticActionSetDigest);
      state.managed_action_set_digests = [...deliveredManagedActionSetDigests];
      // The digest above only sees a byte-identical envelope, so a producer that re-mints
      // the same delivery with fresh transient fields defeats it completely -- which is how
      // one approved-ingestion notify was redelivered to the same role with no result and
      // no stage transition until the run was killed. Key progress on what is delivered
      // (role, operation family, artifact ref/kind, message bytes) within one progress
      // epoch, never on the action id, argv/authority digests or expiry.
      const deliveredIdentityDigest = digestObject({
        entrypoint: envelope.entrypoint,
        progress_epoch: managedProgressEpoch,
        actions: envelope.actions.map(semanticActionIdentity),
      });
      const previouslyDelivered = managedDeliveredIdentities.get(deliveredIdentityDigest);
      if (previouslyDelivered) {
        state.managed_action_no_progress = {
          detector: 'delivered-identity',
          entrypoint: envelope.entrypoint,
          stage: fullScenario ? p4Stage : null,
          progress_epoch: managedProgressEpoch,
          roles: previouslyDelivered.roles,
          identity_digest: deliveredIdentityDigest,
          occurrences: previouslyDelivered.occurrences + 1,
        };
        return fail('INVALID_ACTION_RELAY',
          `${envelope.entrypoint} redelivered an equivalent action set for [${previouslyDelivered.roles.join(', ')}] with no lifecycle progress (NO_PROGRESS).`);
      }
      managedDeliveredIdentities.set(deliveredIdentityDigest, {
        occurrences: 1,
        roles: semanticActionSetRoles(envelope.actions),
      });
      state.managed_delivered_identity_digests = [...managedDeliveredIdentities.keys()];
      writeJson(path.join(runRoot, 'managed-pending-action-set.json'), envelope);
      executeManagedNativeActions(envelope);
      return;
    }
    pending = {
      entrypoint: relayEnvelope.entrypoint,
      actions: relayEnvelope.actions,
      proposals: [],
      sendMessageProposals: [],
      supervisorStartProposals: [],
      deliveredSendMessageToolUseIds: new Set(),
      nonAgentDelivered: false,
      assistantText: [],
    };
    queueActionRelayInterrupt(relayEnvelope);
    return;
  }
  if (!fullScenario) {
    if (envelope.entrypoint === 'init-session' && envelope.status === 'READY') {
      if (p5Scenario) {
        if (envelope.actions.length !== 0) {
          return fail('INVALID_P5_BOOTSTRAP', 'P5 init-session READY unexpectedly carried actions.');
        }
        p5Stage = 'mixed-review-request';
        state.p5_stage = p5Stage;
        dispatchManagedLifecycle(p5MixedReviewTokens, 'mixed-review-request', 'arch-testing',
          sha256String(`mixed-review-request:${p5MixedIntentValue}`), 'p5-mixed-review-request',
          p5CommandPrompt(p5MixedReviewCommand,
            'submit one immutable mixed-review subject from the retained Claude requester to the retained Codex reviewer.'));
        return;
      }
      dispatchManagedEntrypoint('work', 'work-1', p6Scenario ? p6WorkPrompt() : commandPrompt('work'));
      return;
    }
    if (envelope.entrypoint === 'work' && envelope.status === 'COMPLETED') {
      if (!validateTerminalResult(envelope.result)) {
        return fail('INVALID_TERMINAL_RESULT', 'COMPLETED lacked a complete result/accepted-result/ACK digest chain.');
      }
      state.status = p6Scenario ? 'P6_MANAGED_CONSUMER_COMPLETED' : 'PROTOCOL_COMPLETED';
      state.completion_result = envelope.result ? {
        role: 'toolkit-specialist', subject_ref: workSubjectRef, ...envelope.result,
      } : null;
      state.protocol_completed_at = new Date().toISOString();
      writeState();
      closeMainAfterDirectRoles();
    }
    return;
  }
  advanceP4Stage(envelope);
}

// Realpath BOTH ends of the boundary. This is not a string-normalization
// relaxation: a directory outside the run root still canonicalizes to a
// different real path and is still rejected (MACOS-CANON-02), and an
// unresolvable path yields null and fails closed rather than comparing equal.
function canonicalDirOrNull(candidate) {
  if (typeof candidate !== 'string' || candidate.length === 0) return null;
  try { return fs.realpathSync(path.resolve(candidate)); } catch { return null; }
}

function sameCanonicalDir(actual, expected) {
  const canonicalActual = canonicalDirOrNull(actual);
  const canonicalExpected = canonicalDirOrNull(expected);
  return canonicalActual !== null && canonicalExpected !== null && canonicalActual === canonicalExpected;
}

// Same boundary rule for a FILE both sides name: canonicalize the containing
// directory and require an exact basename match. The directory is canonicalized
// rather than the file itself so a not-yet-created file fails closed on the
// basename instead of throwing, and an unresolvable directory yields null and
// still fails closed.
function sameCanonicalFile(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string') return false;
  if (actual === expected) return true;
  if (path.basename(actual) !== path.basename(expected)) return false;
  return sameCanonicalDir(path.dirname(actual), path.dirname(expected));
}

function validateInit(event) {
  const tools = Array.isArray(event.tools) ? event.tools : [];
  const expectedCwd = transportProfile === 'native-claude-cli' && operation === 'host-contract-probe' ? runRoot : projectRoot;
  return event.session_id === sessionId
    && sameCanonicalDir(event.cwd, expectedCwd)
    && typeof event.model === 'string' && event.model.length > 0
    && tools.includes('Bash') && tools.includes('SendMessage')
    && (tools.includes('Agent') || tools.includes('Task'))
    && Array.isArray(event.mcp_servers);
}

function handleFrame(event) {
  if (typeof event.session_id === 'string' && event.session_id !== sessionId) {
    return fail('INVALID_STREAM_SESSION', 'A stream frame belonged to a foreign session.');
  }
  state.last_event_at = new Date().toISOString();
  state.last_event_type = event.type || null;
  if (transportProfile === 'native-claude-cli' && operation === 'entrypoint-protocol'
      && event.type === 'assistant') {
    const observedEffort = typeof event.effort === 'string' ? event.effort : null;
    if (observedEffort !== null) {
      state.effort_profile.observed = observedEffort;
      if (state.cli_pin) state.cli_pin.effort_observed = observedEffort;
    }
    if (observedEffort !== null && observedEffort !== state.effort_profile.expected_observed) {
      return fail('HOST_PIN_MISMATCH',
        `Observed effort ${observedEffort || 'absent'} did not match the pinned default ${state.effort_profile.expected_observed}.`);
    }
  }
  if (event.type === 'system' && event.subtype === 'init' && !state.host_identity_observation) {
    if (!validateInit(event)) return fail('INVALID_SYSTEM_INIT_EVIDENCE', 'system/init failed the bounded offline host-shape contract.');
    if (transportProfile === 'native-claude-cli' && operation === 'entrypoint-protocol') {
      const availableAgents = new Set(Array.isArray(event.agents) ? event.agents : []);
      if (!P4_NATIVE_AGENT_ROLES.every((role) => availableAgents.has(role))) {
        return fail('INVALID_SYSTEM_INIT_EVIDENCE', 'system/init did not expose every canonical P4 Agent type.');
      }
    }
    if (nativeClaudeExecutable && operation === 'entrypoint-protocol') {
      let recorded;
      try {
        recorded = require('../lib/runtime-host-claude.cjs')
          .recordProductionSessionIdentity({
            projectRoot,
            event,
            hostPin: {
              executablePath: fs.realpathSync(nativeClaudeExecutable),
              cliVersion: state.cli_pin.version,
              observerPath: path.join(toolkitRoot, 'scripts', 'tests', 'fixtures', 'claude-host-contract-probe.cjs'),
              transportProfile: 'native-claude-cli',
              os: process.platform,
            },
          });
      } catch {
        recorded = { ok: false };
      }
      if (!recorded.ok) return fail('INVALID_SYSTEM_INIT_EVIDENCE', 'system/init could not establish the signed current-session host identity.');
    }
    state.host_identity_observation = 'system-init-stream';
    state.init = {
      session_digest: sha256String(sessionId),
      model: event.model,
      claude_code_version: event.claude_code_version || null,
      tools: [...event.tools],
      agents: Array.isArray(event.agents) ? [...event.agents] : [],
      mcp_server_count: event.mcp_servers.length,
      capabilities: Array.isArray(event.capabilities) ? [...event.capabilities] : [],
    };
    if (managedConductor) {
      state.managed_conductor = true;
      state.model_host_command_count = 0;
      state.managed_handshake = 'SYSTEM_INIT_VALIDATED_AWAITING_IDLE_RESULT';
    }
  }
  if (operation === 'host-contract-probe'
      && event.type === 'system' && event.subtype === 'fake_host_probe_complete') {
    finalizeHostContractProbe();
    writeState();
    return;
  }
  if (operation === 'host-contract-probe') {
    // Turn semantics belong to the PROFILE, not to whether the binary happens to
    // be the real one -- otherwise this path is unreachable offline and ships
    // unverified, which is exactly how the first-result defect survived.
    if (transportProfile === 'native-claude-cli' && event.type === 'result') {
      state.probe_terminal_results = (state.probe_terminal_results || 0) + 1;
      if (hostProbeSequenceObservable() || state.probe_terminal_results >= HOST_PROBE_MAX_TERMINAL_RESULTS) {
        finalizeHostContractProbe();
      } else {
        // The resume and the second peer are still outstanding. Keep stdin and
        // the session open so later turns can still be observed, bounded by a
        // deadline -- never finalize an unfinished sequence here.
        armHostProbeContinuation();
      }
    }
    writeState();
    return;
  }
  if (event.type === 'control_response') {
    if (!actionInterrupt) {
      return fail('INVALID_ACTION_INTERRUPT',
        'An unsolicited action-interrupt control_response was observed.');
    }
    const response = event.response;
    if (!response || response.request_id !== actionInterrupt.requestId) {
      return fail('INVALID_ACTION_INTERRUPT',
        'The action-interrupt control_response request_id was absent or foreign.');
    }
    if (response.subtype !== 'success') {
      return fail('INVALID_ACTION_INTERRUPT',
        'The action-interrupt control_response was not successful.');
    }
    if (!response.response || !Array.isArray(response.response.still_queued)) {
      return fail('INVALID_ACTION_INTERRUPT',
        'The interrupt_receipt_v1 response did not contain still_queued.');
    }
    if (response.response.still_queued.length !== 0) {
      return fail('INVALID_ACTION_INTERRUPT',
        'The action-interrupt receipt retained an unexpected queued user message.');
    }
    actionInterrupt.record.receipt_observed = true;
    actionInterrupt.record.transition = 'ACTION_REQUIRED->INTERRUPT_RECEIPT';
    state.action_interrupt_receipt_count += 1;
    writeState();
    return;
  }
  if (event.type === 'assistant' && event.message && Array.isArray(event.message.content)) {
    if (pending) {
      for (const block of event.message.content) {
        if (block && block.type === 'text' && typeof block.text === 'string') {
          pending.assistantText.push(block.text);
        }
      }
    }
    for (const block of event.message.content) {
      if (!block || block.type !== 'tool_use') continue;
      const nestedParentToolUseId = typeof event.parent_tool_use_id === 'string'
        ? event.parent_tool_use_id
        : null;
      if (nestedParentToolUseId) {
        const protocol = rootSourceNestedProtocols.get(nestedParentToolUseId);
        if (protocol) {
          // Native Claude may stream multiple model proposals while their
          // PreToolUse hooks execute concurrently. Proposal order therefore
          // cannot prove execution order. The Agent-result boundary below is
          // the closed observation point: it requires a PostToolUse record for
          // this first tool_use_id whose executed command is the exact
          // action-derived publish_command (plus its genuine one-use grant).
          protocol.nested_tool_count += 1;
          if (!protocol.first_tool_observed) {
            protocol.first_tool_observed = true;
            const command = block.input && block.input.command;
            protocol.first_tool_use_id = block.id;
            protocol.first_tool_proposal_exact = block.name === 'Bash'
              && command === protocol.expected_publish_command;
            if (block.name !== 'Bash') {
              return fail('INVALID_ROOT_SOURCE_PROTOCOL',
                'The root-source Agent first nested tool proposal was not Bash.');
            }
          }
          if (block.name === 'SendMessage') {
            protocol.nested_sendmessage_count += 1;
            state.root_source_nested_sendmessage_count =
              (state.root_source_nested_sendmessage_count || 0) + 1;
          }
        }
        // A nested subagent tool is never a top-level owning-action proposal.
        // Its production hooks remain the execution authority.
        continue;
      }
      if (managedConductor && block.name === 'Bash') {
        state.model_host_command_count += 1;
        return fail('INVALID_MODEL_HOST_COMMAND',
          'A managed certification model attempted a conductor-owned host command.');
      }
      if (operation === 'entrypoint-protocol' && !firstToolObserved) {
        if (managedConductor) {
          firstToolObserved = true;
          if (!pending || !['Agent', 'SendMessage'].includes(block.name)) {
            return fail('INVALID_FIRST_ACTION',
              'The first model tool in managed mode was not a pending native action relay.');
          }
          state.first_action_exact = true;
        } else {
        if (p6Scenario && ['Read', 'Glob', 'Grep'].includes(block.name)) {
          state.p6_preflight_reads = (state.p6_preflight_reads || 0) + 1;
          writeState();
          continue;
        }
        firstToolObserved = true;
        const command = block.input && block.input.command;
        if (block.name !== 'Bash' || command !== initCommand) {
          return fail('INVALID_FIRST_ACTION', 'The first emitted tool call was not the exact required init-session Bash command.');
        }
        state.first_action_exact = true;
        }
      }
      if (block.name === 'Agent') {
        if (!pending || !pending.actions.some((action) => actionOperation(action) === 'Agent')) {
          return fail('INVALID_AGENT_ACTIONS', 'Agent call appeared without a pending owning action.');
        }
        const pendingAgentActions = pending.actions.filter((action) => actionOperation(action) === 'Agent');
        const owningAction = pendingAgentActions[pending.proposals.length];
        if (owningAction && owningAction.kind === 'root-source-spawn') {
          const expectedPublishCommand = rootSourcePublishCommand(owningAction);
          if (!expectedPublishCommand) {
            return fail('INVALID_ROOT_SOURCE_PROTOCOL',
              'The pending root-source action did not contain one closed publish_command.');
          }
          rootSourceNestedProtocols.set(block.id, {
            expected_publish_command: expectedPublishCommand,
            first_tool_observed: false,
            first_tool_exact: false,
            first_tool_proposal_exact: false,
            first_tool_use_id: null,
            nested_tool_count: 0,
            nested_sendmessage_count: 0,
          });
          state.root_source_first_nested_tool_exact = false;
          state.root_source_nested_sendmessage_count = 0;
        }
        pending.proposals.push({ tool_use_id: block.id, input: block.input || {} });
      } else if (block.name === 'SendMessage') {
        if (!pending || !pending.actions.some((action) => actionOperation(action) === 'SendMessage')) {
          return fail('INVALID_ACTION_RELAY', 'SendMessage call appeared without a pending owning action.');
        }
        const actionIndex = pending.sendMessageProposals.length;
        const action = pending.actions.filter((candidate) => actionOperation(candidate) === 'SendMessage')[actionIndex];
        const input = block.input || {};
        const expectedInput = canonicalSendMessageInput(action);
        const validation = validatePinnedSendMessageProposal(input, expectedInput);
        if (!validation.ok) {
          return fail('INVALID_ACTION_RELAY', 'SendMessage call did not match the pending owning action.');
        }
        state.sendmessage_proposals = state.sendmessage_proposals || [];
        state.sendmessage_proposals.push({
          action_id: action.action_id,
          role: action.role,
          projection: validation.projection,
          proposed_input_digest: digestObject(input),
          canonical_input_digest: digestObject(expectedInput),
        });
        pending.sendMessageProposals.push({ tool_use_id: block.id, input });
      } else if (block.name === 'Bash' && pending
          && pending.actions.some((action) => actionOperation(action) === 'Bash')) {
        const actionIndex = pending.supervisorStartProposals.length;
        const action = pending.actions.filter((candidate) => actionOperation(candidate) === 'Bash')[actionIndex];
        const expectedInput = canonicalSupervisorStartInput(action);
        const input = block.input || {};
        if (!expectedInput || input.command !== expectedInput.command
            || input.run_in_background !== expectedInput.run_in_background) {
          return fail('INVALID_SUPERVISOR_START_ACTIONS',
            'Bash call did not match the pending supervisor-start action.');
        }
        pending.supervisorStartProposals.push({ tool_use_id: block.id, input });
      }
    }
  }
  if (event.type === 'system' && event.subtype === 'fake_sendmessage_delivered'
      && pending && (offlineFakeChild || nativeFixtureChild)) {
    const expected = pending.actions.filter((action) => actionOperation(action) === 'SendMessage').length;
    while (pending.sendMessageProposals.length < expected) {
      const toolUseId = `offline-fake-sendmessage-${pending.sendMessageProposals.length}`;
      pending.sendMessageProposals.push({ tool_use_id: toolUseId, input: null });
      pending.deliveredSendMessageToolUseIds.add(toolUseId);
    }
    pending.nonAgentDelivered = true;
  }
  if (event.type === 'user' && event.message && Array.isArray(event.message.content)) {
    for (const block of event.message.content) {
      if (pending && block && block.type === 'tool_result'
          && pending.sendMessageProposals.some((proposal) => proposal.tool_use_id === block.tool_use_id)) {
        const content = typeof block.content === 'string'
          ? block.content
          : (Array.isArray(block.content)
            ? block.content.filter((item) => item && item.type === 'text').map((item) => item.text).join('\n')
            : '');
        let successful = block.is_error !== true;
        try {
          const parsed = JSON.parse(content);
          successful = successful && parsed.success === true;
        } catch {
          successful = false;
        }
        if (!successful) return fail('INVALID_ACTION_RELAY', 'SendMessage tool result did not prove successful delivery.');
        pending.deliveredSendMessageToolUseIds.add(block.tool_use_id);
        pending.nonAgentDelivered = pending.deliveredSendMessageToolUseIds.size
          === pending.actions.filter((action) => actionOperation(action) === 'SendMessage').length;
      }
      const envelope = parseToolResultEnvelope(block);
      if (envelope) handleEntrypointEnvelope(envelope);
      const lifecycleResult = parseLifecycleCliResultEnvelope(block);
      if (lifecycleResult) {
        if (fullScenario && lifecycleResult.command === 'stop-owned') {
          handleP4CleanupResult(lifecycleResult);
        } else if (p5Scenario) {
          handleP5LifecycleResult(lifecycleResult);
        }
      }
    }
  }
  if (event.type === 'result' && managedHandshakePending && !pending) {
    managedHandshakePending = false;
    state.managed_handshake = 'COMPLETED';
    dispatchManagedEntrypoint('init-session', 'unused-managed-init', '');
    writeState();
    return;
  }
  if (event.type === 'result' && actionInterrupt) {
    if (!actionInterrupt.record.receipt_observed) {
      return fail('INVALID_ACTION_INTERRUPT',
        'The interrupted result arrived before its correlated interrupt receipt.');
    }
    actionInterrupt.record.interrupted_result_observed = true;
    actionInterrupt.record.transition = 'ACTION_REQUIRED->INTERRUPT_RECEIPT->INTERRUPTED_RESULT';

    queueInterruptedActionRelay();
    writeState();
    return;
  }
  if (event.type === 'result' && pending) {
    const hasAgentActions = pending.actions.some((action) => actionOperation(action) === 'Agent');
    const hasSupervisorStartActions = pending.actions.some((action) => actionOperation(action) === 'Bash');
    if (hasAgentActions && hasSupervisorStartActions) {
      const entrypointName = pending.entrypoint;
      finalizeAgentActions({ deferReentry: true });
      if (String(state.status).startsWith('INVALID_')) return;
      finalizeSupervisorStartActions({ deferReentry: true });
      if (String(state.status).startsWith('INVALID_')) return;
      state.verdict = 'MIXED_HOST_ACTIONS_ACCEPTED';
      pending = null;
      dispatchEntrypointReentry(entrypointName);
      writeState();
    } else if (hasAgentActions && pending.proposals.length === 0) {
      closeModelDeclinedActionSet();
      return;
    } else if (hasAgentActions && pending.proposals.length > 0) {
      const expectedCount = pending.actions.filter((action) => actionOperation(action) === 'Agent').length;
      if (pending.proposals.length < expectedCount) {
        state.premature_result_ignored = (state.premature_result_ignored || 0) + 1;
        if (!pending.incompleteFinalizationScheduled) {
          pending.incompleteFinalizationScheduled = true;
          const pendingBatch = pending;
          setTimeout(() => {
            if (pending === pendingBatch && pending.proposals.length < expectedCount) {
              finalizeAgentActions();
            }
          }, incompleteAgentFrameGraceMs);
        }
      } else {
        finalizeAgentActions();
      }
    } else if (hasSupervisorStartActions) {
      const expectedCount = pending.actions.filter((action) => actionOperation(action) === 'Bash').length;
      if (pending.supervisorStartProposals.length !== expectedCount) {
        return fail('INVALID_SUPERVISOR_START_ACTIONS',
          'Supervisor-start action batch ended without the exact Bash proposal count.');
      }
      finalizeSupervisorStartActions();
    } else if (pending.actions.some((action) => actionOperation(action) === 'SendMessage')) {
      const expectedCount = pending.actions.filter((action) => actionOperation(action) === 'SendMessage').length;
      if (pending.sendMessageProposals.length === 0) {
        state.premature_nonagent_result_ignored = (state.premature_nonagent_result_ignored || 0) + 1;
      } else if (!pending.nonAgentDelivered || pending.sendMessageProposals.length !== expectedCount) {
        return fail('INVALID_ACTION_RELAY', 'SendMessage action batch ended without successful correlated delivery evidence.');
      } else {
        const entrypointName = pending.entrypoint;
        if (fullScenario && entrypointName === 'resume-work') {
          state.p4_resume_sendmessage_action_count = expectedCount;
          state.p4_resume_action_order = pending.actions
            .filter((action) => actionOperation(action) === 'SendMessage')
            .map((action) => action.role);
        }
        pending = null;
        dispatchEntrypointReentry(entrypointName);
      }
    }
  }
  writeState();
}

const feed = createJsonlFrameFeeder(handleFrame, (reason, rawLine) => {
  state.parse_errors.push({ reason, raw_line_digest: rawLine === null ? null : sha256String(rawLine) });
  fail('INVALID_STREAM', reason);
}, () => String(state.status).startsWith('INVALID_'));

child.stdout.on('data', (chunk) => {
  fs.appendFileSync(transcriptPath, chunk);
  process.stdout.write(chunk);
  feed(chunk);
});
child.stderr.on('data', (chunk) => {
  fs.appendFileSync(stderrPath, chunk);
  process.stderr.write(chunk);
  stderrBuffer += chunk.toString('utf8');
  state.stderr_line_count = stderrBuffer.split(/\r?\n/).filter(Boolean).length;
  writeState();
});
child.stdin.on('error', (error) => {
  handleStdinWriteError(error);
});
child.on('error', (error) => fail('INVALID_CHILD_SPAWN', error.message));

pendingWrites += 1;
writeJsonlFrame(child.stdin, firstMessage, (error) => {
  pendingWrites -= 1;
  if (error) handleStdinWriteError(error);
});

child.on('exit', (code, signal) => {
  if (terminalShutdownTimer) clearTimeout(terminalShutdownTimer);
  if (transportProfile === 'native-claude-cli') {
    try {
      state.transcript_cleanup = cleanupNativeSessionTranscripts();
    } catch (error) {
      state.status = 'HOST_TRANSCRIPT_CLEANUP_FAILED';
      state.invalidation_reason = error.message;
      state.transcript_cleanup = { complete: false, error: error.message, removed: [] };
    }
  }
  if (transportProfile === 'native-claude-cli' && operation === 'entrypoint-protocol') {
    try {
      state.native_session_authority_retirement = retireNativeSessionAuthority();
    } catch (error) {
      state.native_session_authority_retirement = { complete: false, error: error.message };
      if (!String(state.status).startsWith('INVALID_')) {
        state.status = 'NATIVE_SESSION_RETIREMENT_FAILED';
        state.invalidation_reason = error.message;
      }
    }
  }
  if (p5Scenario) {
    try {
      state.p5_owned_teardown = settleP5OwnedSupervisor();
      if (!state.p5_owned_teardown.complete) {
        state.status = 'P5_OWNED_CLEANUP_FAILED';
        state.invalidation_reason = 'Retained Codex supervisor remained live after exact session retirement.';
      }
    } catch (error) {
      state.p5_owned_teardown = { complete: false, error: error.message };
      state.status = 'P5_OWNED_CLEANUP_FAILED';
      state.invalidation_reason = error.message;
    }
  }
  const preservedFailure = String(state.status).startsWith('INVALID_')
    || state.status === 'UNSTARTED_RETRY_EXHAUSTED'
    || state.status === 'MODEL_DECLINED_ACTION_SET'
    || state.status === 'P5_OWNED_CLEANUP_FAILED'
    || state.status.startsWith('HOST_');
  const successful = state.status === 'PROTOCOL_COMPLETED'
    || state.status === 'HOST_CONTRACT_PROBE_COMPLETED'
    || state.status === 'P4_FULL_SCENARIO_COMPLETED'
    || state.status === 'P5_SCENARIO_COMPLETED'
    || state.status === 'P6_MANAGED_CONSUMER_COMPLETED';
  if (!preservedFailure && !successful) {
    state.status = code === 0 && !signal ? 'UNEXPECTED_EOF' : 'ABNORMAL_CHILD_EXIT';
  }
  state.exit_code = code ?? 1;
  state.finished_at = new Date().toISOString();
  state.source_snapshot_after = sourceSnapshot();
  state.source_unchanged = canonicalJSONStringify(state.source_snapshot_after) === canonicalJSONStringify(state.source_snapshot_before);
  state.stdin_closed_after_terminal = stdinClosedAfterTerminal || state.stdin_closed_after_terminal === true;
  state.writers_settled = pendingWrites === 0;
  if ((state.status === 'PROTOCOL_COMPLETED' || state.status === 'P4_FULL_SCENARIO_COMPLETED'
      || state.status === 'P6_MANAGED_CONSUMER_COMPLETED') && state.actions.length > 0) {
    state.verdict = 'AGENT_ACTIONS_ACCEPTED';
  }
  const runRecord = {
    schema: 'runtime/claude-functional-certification-run/v1',
    operation,
    transport_profile: transportProfile,
    evidence_mode: state.evidence_mode,
    host_capability: state.host_capability,
    session_transcript_policy: state.session_transcript_policy || null,
    transcript_cleanup: state.transcript_cleanup || null,
    child: {
      command: childCommand,
      args: childArgs,
      executable_realpath: fs.realpathSync(childCommand),
      executable_sha256: crypto.createHash('sha256').update(fs.readFileSync(childCommand)).digest('hex'),
    },
    init: state.init || null,
    effort_profile: state.effort_profile || null,
    actions: state.actions,
    verdict: state.verdict || state.status,
    parse_errors: state.parse_errors,
    stderr_line_count: state.stderr_line_count,
    stdin_closed_after_terminal: state.stdin_closed_after_terminal,
    writers_settled: state.writers_settled,
    attempts: state.attempts,
    started_at: state.started_at,
    ended_at: state.finished_at,
  };
  writeJson(runRecordPath, runRecord);
  writeState();
  const finalCode = successful ? 0 : ((code && code !== 0) ? code : 1);
  process.exit(finalCode);
});
