'use strict';

// A whole documented wave in a consumer, with the REAL hooks and CLIs, the toolkit and the consumer being different
// directories. It is the net that must catch the next failure before a live acceptance run does.
//
//   Pass A draft -> orchestrate -> mediated consult -> accept -> Pass B final PLAN -> orchestrate (rebind to the final
//   digest) -> PREP verdict requests and verdicts x3 -> EXECUTE -> specialist passes the mediated gate and commits ->
//   VERIFY_FINAL --rebind-head -> verdicts x3 (inline evidence) -> QG (pre-pr stamp, mint, verify) -> COMPLETE.
//
// Every step runs the production code: hooks are spawned with real PreToolUse/PostToolUse events, the rewritten command
// they return is executed, the launcher is the consumer's installed one. What no process can produce without a model or
// a live Claude session is simulated, and each simulation is named where it is used:
//   SIM-MODEL  what the planner, an architect or a specialist WRITES (the PLAN text, a verdict rationale, the commit) is
//              authored by the test, always through the same file, launcher and hook surface the agent uses;
//   SIM-ID01   the CLAUDE-ID-01 bounded-proof trace of each agent (primeClaudeId01Trace: the real observation functions);
//   SIM-CP     context-provider's lifecycle binding (a spawn would create it in SubagentStart);
//   SIM-HOST   /init-session's host-composition admission needs a live Claude process, so the control-plane effect of
//              orchestrating (wave-control init) is run through the launcher and the entrypoint PLANNING layer is
//              exercised directly (planEntrypointStep), which is where the draft re-binding decision is taken;
//   SIM-SCAN   the secret scanner is an external binary: a stub stands in for it (TRUFFLEHOG_BIN).
// The test needs the signed Claude host contract of the platform, which the toolkit ships for darwin and win32.

const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

const rll = require('../lib/runtime-role-lifecycle.cjs');
const entrypoints = require('../lib/runtime-collaboration-entrypoints.cjs');
const { installConsumerFixture, toolkitHostContractAvailable } = require('./lib/consumer-runtime-fixture.cjs');
const { primeClaudeId01V2ActorProof, claudeId01V2SessionEvidenceFor } = require('./fixtures/runtime-claude-id01-v2-fixture.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const IMPL_RC = path.join(ROOT, 'scripts', 'lib', 'runtime-consultation.cjs');
const HOOKS = Object.freeze({
  gate: path.join(ROOT, '.claude', 'hooks', 'context-provider-gate.js'),
  target: path.join(ROOT, '.claude', 'hooks', 'runtime-consultation-target-gate.js'),
  consulted: path.join(ROOT, '.claude', 'hooks', 'context-provider-consulted.js'),
});
const IDENTITY_PRELOAD = path.join(__dirname, 'fixtures', 'runtime-claude-session-identity-preload.cjs');
const DRAFT_MARKER = 'STATUS: DRAFT-CONTEXT-PENDING';
const SKIP = toolkitHostContractAvailable()
  ? false
  : `no signed Claude host contract for ${process.platform} in this toolkit; consumer host composition is unavailable here by design`;

// ── harness ────────────────────────────────────────────────────────────────────────────────────────────────────────

// The injectable clock: every child process sees `now + clock.offsetMs` (fixtures/clock-offset-preload.cjs).
const CLOCK_PRELOAD = path.join(__dirname, 'fixtures', 'clock-offset-preload.cjs');
// The injectable clock: children get it through the preload; this process (which primes the simulated agent starts) follows
// the same offset through its own Date.
const RealDate = Date;
const clock = {
  offsetMs: 0,
  advance(ms) { this.offsetMs += ms; },
};
class OffsetDate extends RealDate {
  constructor(...args) { if (args.length === 0) super(RealDate.now() + clock.offsetMs); else super(...args); }
  static now() { return RealDate.now() + clock.offsetMs; }
}
global.Date = OffsetDate;
const HOUR = 3600 * 1000;

function childEnv(root, extra = {}) {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: root, CLAUDE_WAVE_SLUG: '', ...extra };
  if (clock.offsetMs !== 0) {
    env.ACD_TEST_CLOCK_OFFSET_MS = String(clock.offsetMs);
    env.NODE_OPTIONS = [env.NODE_OPTIONS, '--require', CLOCK_PRELOAD].filter(Boolean).join(' ');
  }
  return env;
}

function run(root, command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', input: options.input, env: childEnv(root, options.env) });
  return { exit: result.status, stdout: result.stdout, stderr: result.stderr };
}

function git(root, ...args) {
  const result = run(root, 'git', args);
  assert.strictEqual(result.exit, 0, `git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
}

function hook(root, file, event) {
  const env = childEnv(root);
  if (env.RUNTIME_TEST_CLAUDE_SESSION_EVIDENCE) env.NODE_OPTIONS = [env.NODE_OPTIONS, '--require', IDENTITY_PRELOAD].filter(Boolean).join(' ');
  const result = spawnSync('node', ['--require', IDENTITY_PRELOAD, file], { input: JSON.stringify(event), env, encoding: 'utf8', cwd: root });
  assert.strictEqual(result.status, 0, `${path.basename(file)}: ${result.stderr}`);
  return result.stdout ? JSON.parse(result.stdout).hookSpecificOutput || null : null;
}

function bashEvent(command, agentType, session, agentId) {
  return { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, session_id: session, agent_type: agentType, agent_id: agentId || agentType };
}

/** The hook rewrites the command (it mints and injects the grant); the rewritten command is what the host runs. */
function runThroughGate(root, file, command, agentType, session, agentId) {
  const out = hook(root, file, bashEvent(command, agentType, session, agentId));
  assert.ok(out && out.permissionDecision === 'allow' && out.updatedInput && out.updatedInput.command,
    `the hook must allow and rewrite: ${JSON.stringify(out)}\n  ${command}`);
  const tokens = rll.parsePosixDirect(out.updatedInput.command);
  assert.ok(tokens, 'the rewritten command is a canonical direct command');
  const result = run(root, tokens[0], ['--require', IDENTITY_PRELOAD, ...tokens.slice(1)]);
  return { ...result, rewritten: out.updatedInput.command };
}

function envelope(result, label) {
  const last = result.stdout.trim().split('\n').pop();
  let parsed;
  try { parsed = JSON.parse(last); } catch { assert.fail(`${label}: no JSON envelope: ${result.stdout}${result.stderr}`); }
  assert.strictEqual(parsed.status, 'SUCCESS', `${label}: ${result.stdout}${result.stderr}`);
  return parsed;
}

function launcher(root, operation, args, env) {
  return run(root, process.execPath, ['.claude/runtime/l0-toolkit-launcher.cjs', 'run', operation, '--project-root', root, '--', ...args], { env });
}

function waveControl(root, ...args) {
  const result = launcher(root, 'wave-control', args);
  let body = null;
  try { body = JSON.parse(result.stdout.trim().split('\n').pop()); } catch { /* non-JSON output keeps body null */ }
  return { ...result, body };
}

// SIM-ID01
function primeClaudeId01Trace(root, agentType, session, agentId) {
  const generation = rll.resolveSessionGeneration(root, { ok: true, provider: 'claude-hook', runtime_session_key: session });
  assert.strictEqual(generation.ok, true, JSON.stringify(generation));
  const plan = rll.discoverPlan(root);
  assert.strictEqual(plan.ok, true, JSON.stringify(plan));
  const mintAction = (suffix) => {
    const actionId = rll.generateActionId();
    const minted = rll.mintRoleLifecycleAction(root, actionId, 'role-spawn', 'claude-native', rll.computeRepoId(root),
      rll.computeWorktreeId(root), plan.planDigest, crypto.createHash('sha256').update('full-wave:' + suffix).digest('hex'),
      generation.generationId, agentType, rll.buildRoleSpawnPayload('claude-id01-probe', agentType, agentType, 'fixture', 'fixture'),
      new Date(Date.now() + 600000).toISOString().replace(/\.\d{3}Z$/, 'Z'));
    assert.strictEqual(minted.ok, true, JSON.stringify(minted));
    return actionId;
  };
  const actionA = mintAction('a-' + agentId);
  const actionB = mintAction('b-' + agentId);
  const observe = { sessionId: session, agentId, agentType };
  rll.recordClaudeId01SubagentStartObservation(root, { ...observe, actionId: actionA });
  rll.recordClaudeId01PreToolUseObservation(root, { ...observe, toolUseId: 'fw-tu-1-' + session + agentId });
  rll.recordClaudeId01PreToolUseObservation(root, { ...observe, toolUseId: 'fw-tu-2-' + session + agentId });
  rll.recordClaudeId01SubagentStartObservation(root, { ...observe, actionId: actionA });
  rll.recordClaudeId01PreToolUseObservation(root, { ...observe, toolUseId: 'fw-tu-3-' + session + agentId });
  rll.recordClaudeId01SubagentStartObservation(root, { sessionId: session, agentId: agentId + '-distinct-peer-b', agentType, actionId: actionB });
  primeClaudeId01V2ActorProof({ projectRoot: root, agentType, sessionId: session, agentId, actionId: actionA, prefix: 'full-wave-v2', actorBindingTtlSeconds: 3600 }); // 3600 is the TTL subagent-start-context-bundle.js mints with
  const evidence = claudeId01V2SessionEvidenceFor(root, session);
  process.env.RUNTIME_TEST_CLAUDE_SESSION_EVIDENCE = Buffer.from(JSON.stringify({
    projectRoot: root, repoId: rll.computeRepoId(root), sessionId: session, record: evidence.record,
  })).toString('base64url');
}

function scannerStub(directory) {
  const bin = path.join(directory, 'trufflehog');
  fs.writeFileSync(bin, '#!/bin/sh\n[ "$1" = "--version" ] && { echo "stub 1.0"; exit 0; }\nexit 0\n', { mode: 0o755 });
  return bin;
}

const planText = (slug, { draft, extra = '' }) => (draft ? DRAFT_MARKER + '\n' : '')
  + `# ${slug}\n\n### Wave Class\n\n- **Class**: HARNESS\n\n### Path-Manifest\n\n- src/feature.txt\n\n### Acceptance\n\n- the feature file exists\n\n## Spawn Table\n\n| Specialist | Architect | Task |\n|---|---|---|\n| test-specialist | arch-testing | add src/feature.txt |\n${extra}`;

function newWave(slug) {
  const fixture = installConsumerFixture('L2');
  assert.notStrictEqual(fixture.consumerRoot, fixture.toolkitRoot, 'toolkit and consumer roots must differ');
  const root = fixture.consumerRoot;
  // Two earlier waves live in the same consumer: the branch names the active one.
  for (const earlier of ['earlier-a', 'earlier-b']) {
    fs.mkdirSync(path.join(root, '.planning', 'wave-' + earlier), { recursive: true });
    fs.writeFileSync(path.join(root, '.planning', 'wave-' + earlier, 'PLAN.md'), '# ' + earlier + '\n');
  }
  git(root, 'switch', '-q', '-c', 'feature/' + slug);
  const waveDir = path.join(root, '.planning', 'wave-' + slug);
  fs.mkdirSync(waveDir, { recursive: true });
  fs.writeFileSync(path.join(waveDir, 'CLASS'), 'HARNESS\n');
  return { fixture, root, waveDir, slug, planPath: path.join(waveDir, 'PLAN.md') };
}

function cleanup(wave) {
  try { fs.rmSync(rll.registryRepoDir(wave.root), { recursive: true, force: true }); } catch { /* best effort */ }
  fs.rmSync(wave.root, { recursive: true, force: true });
}

/** Runs the real plan-md-write-gate for a planner Write of this wave's PLAN.md and asserts it is allowed. */
function assertPlannerWriteAllowed(wave, agentType) {
  const result = spawnSync('node', [path.join(ROOT, '.claude', 'hooks', 'plan-md-write-gate.js')], {
    input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: wave.planPath, content: 'x' },
      session_id: SESSION_PLANNING, agent_type: agentType, agent_id: agentType }),
    encoding: 'utf8', cwd: wave.root, env: { ...childEnv(wave.root), CLAUDE_PROJECT_DIR: wave.root },
  });
  assert.strictEqual(result.status, 0, `plan-md-write-gate must allow ${agentType}'s PLAN write: ${result.stdout}${result.stderr}`);
}
const SESSION_PLANNING = 'fw-session-planning';

test('a consumer wave runs from the Pass A draft to the Pass B final PLAN, with the control plane following the final digest', { skip: SKIP }, () => {
  const wave = newWave('full-wave-a');
  try {
    const { root } = wave;

    // ── Pass A: the planner (SIM-MODEL) writes the draft; the orchestrator revalidates the marker on disk. ──
    assertPlannerWriteAllowed(wave, 'planner');
    fs.writeFileSync(wave.planPath, planText(wave.slug, { draft: true }));
    assert.ok(fs.readFileSync(wave.planPath, 'utf8').startsWith(DRAFT_MARKER + '\n'), 'the draft carries the marker on its first line');
    // The wave directory is working-tree planning state, never committed: HEAD stays the baseline of the wave.

    // ── orchestrate over the draft: the planning layer and the control plane bind the draft digest. ──
    const intent = { mode: 'start', wave_slug: wave.slug };
    const draftPlan = entrypoints.planEntrypointStep('init-session', intent, root); // SIM-HOST: planning layer only
    const draftScope = entrypoints.plannedEntrypointWaveScope(draftPlan);
    assert.strictEqual(draftScope.initializeAfterAdmission, true);
    const initDraft = waveControl(root, 'init', '--slug', wave.slug);
    assert.strictEqual(initDraft.body.plan_draft, true, JSON.stringify(initDraft));
    assert.strictEqual(initDraft.body.plan_sha256, draftScope.planDigest);
    assert.strictEqual(initDraft.body.phase, 'PREP');

    // ── Pass B: the planner finalizes the PLAN (marker removed, context added). ──
    // Consumer trace: the documented Pass B is a second Agent(subagent_type="planner") in the same session, which
    // Claude Code names "planner-2" while the Pass A planner is kept. The real gate must treat it as the planner.
    assertPlannerWriteAllowed(wave, 'planner-2');
    fs.writeFileSync(wave.planPath, planText(wave.slug, { draft: false, extra: '\n## Context\n\n- an accepted context-provider answer informed this plan\n' }));

    // The documented step 6 runs orchestrate again: it must re-bind, once, to the final digest.
    const finalPlan = entrypoints.planEntrypointStep('init-session', intent, root);
    const finalScope = entrypoints.plannedEntrypointWaveScope(finalPlan);
    assert.notStrictEqual(finalScope.planDigest, draftScope.planDigest, 'the final PLAN has its own digest');
    assert.strictEqual(finalScope.initializeAfterAdmission, true, 'the pending re-binding is part of the admission');
    const rebound = waveControl(root, 'init', '--slug', wave.slug);
    assert.strictEqual(rebound.body.plan_draft, false, JSON.stringify(rebound));
    assert.strictEqual(rebound.body.plan_sha256, finalScope.planDigest);
    assert.strictEqual(rebound.body.revision, 0);
    assert.strictEqual(waveControl(root, 'status', '--slug', wave.slug).body.current, true, 'the control plane now follows the final PLAN');

    // Only that one re-binding exists: a later edit is drift again.
    fs.appendFileSync(wave.planPath, '\nA later edit.\n');
    assert.strictEqual(waveControl(root, 'init', '--slug', wave.slug).body.reason, 'PHASE_STATE_INPUT_DRIFT');
    assert.throws(() => entrypoints.planEntrypointStep('init-session', intent, root), /wave-control-plan-drift/);
  } finally { cleanup(wave); }
});

const SESSION = 'fw-session';
const CP_SESSION = 'fw-cp-session';
// The agents started after Pass B (PREP architects and the specialists) run in the session of that stage.
const FINAL_SESSION = 'fw-session-final';
const ARCHITECTS = Object.freeze(['arch-platform', 'arch-testing', 'arch-integration']);

const launcherCommand = (root, operation, args) => rll.renderPosixDirect(
  ['node', '.claude/runtime/l0-toolkit-launcher.cjs', 'run', operation, '--project-root', root, '--'].concat(args));

/**
 * One mediated consult against the PLAN the wave currently has: arch-testing asks context-provider, context-provider
 * claims, renews and answers through the target gate, arch-testing awaits and accepts, and hands the answer on.
 */
function consultAndAccept(wave, question, handOffTo, { archAgent = 'arch-testing', session = SESSION } = {}) {
  const { root } = wave;
  const coord = path.join(root, '.planning', 'coordination');
  const consulted = envelope(runThroughGate(root, HOOKS.gate,
    launcherCommand(root, 'runtime-consult', ['consult', '--coordination-root', coord, '--question', question]),
    'arch-testing', session, archAgent), 'consult');
  const request = consulted.artifact_ref;
  const requestObj = JSON.parse(fs.readFileSync(request, 'utf8'));
  const activationDir = path.join(path.dirname(request), 'activations');
  const activation = JSON.parse(fs.readFileSync(path.join(activationDir, fs.readdirSync(activationDir)[0]), 'utf8'));

  // SIM-CP: the lifecycle identity context-provider would get from its SubagentStart, for THIS plan digest.
  const cpSession = CP_SESSION + '-' + requestObj.request_id.slice(0, 8);
  const generation = rll.resolveSessionGeneration(root, { ok: true, provider: 'claude-hook', runtime_session_key: cpSession });
  const planDigest = rll.discoverPlan(root).planDigest;
  const worktreeId = rll.computeWorktreeId(root);
  const binding = activation.selected_driver === 'claude-agent'
    ? rll.createClaudeOneShotBinding(root, cpSession, generation.generationId, 'context-provider', 'context-provider',
      consulted.activation_action.spawn_action_id, requestObj.request_id, requestObj.initial_attempt_id, 0, 'context-provider', worktreeId, planDigest, 600)
    : rll.createRoleActorBinding(root, 'context-provider', worktreeId, planDigest, generation.generationId, 600);
  assert.strictEqual(binding.ok, true, `${activation.selected_driver}: ${JSON.stringify(binding)}`);

  const target = (argv) => envelope(runThroughGate(root, HOOKS.target, rll.renderPosixDirect(['node', IMPL_RC].concat(argv)),
    'context-provider', cpSession), argv[0]);
  const claim = target(['claim', '--coordination-root', coord, '--request', request, '--role', 'context-provider']);
  target(['lease-heartbeat', '--coordination-root', coord, '--request', request, '--claim', claim.artifact_ref]);
  target(['publish-result', '--coordination-root', coord, '--request', request, '--claim', claim.artifact_ref,
    '--content', Buffer.from('For a one-file change run the docs checks only.', 'utf8').toString('base64url')]);

  const again = (operation, extra) => envelope(runThroughGate(root, HOOKS.gate,
    launcherCommand(root, 'runtime-consult', [operation, '--coordination-root', coord, '--request', request].concat(extra)),
    'arch-testing', session, archAgent), operation);
  assert.ok(again('await-result', ['--timeout', '30']).artifact_ref, 'await-result names the result');
  again('accept-result', []);
  const txnDir = path.dirname(request);
  const accepted = JSON.parse(fs.readFileSync(path.join(txnDir, 'accepted-result.json'), 'utf8'));
  const resultFile = path.join(txnDir, accepted.candidate_result_path);
  assert.ok(fs.existsSync(resultFile), 'the accepted result is on disk');
  assert.ok(request.includes(planDigest), 'the consultation lives under the digest of the PLAN it was run against');

  // The architect hands the answer on (SendMessage): the real PostToolUse hook records the mediated chain.
  if (handOffTo) {
    hook(root, HOOKS.consulted, { hook_event_name: 'PostToolUse', tool_name: 'SendMessage', tool_input: { to: handOffTo, message: resultFile },
      session_id: session, agent_type: 'arch-testing', agent_id: archAgent });
  }
  return { coord, request, resultFile, planDigest };
}

/** Pass A -> orchestrate -> mediated consult -> accept: what happens before the PLAN is finalized. */
function planningPhase(wave) {
  const { root } = wave;
  fs.writeFileSync(wave.planPath, planText(wave.slug, { draft: true }));
  const initDraft = waveControl(root, 'init', '--slug', wave.slug);
  assert.strictEqual(initDraft.body.plan_draft, true, JSON.stringify(initDraft));
  primeClaudeId01Trace(root, 'arch-testing', SESSION, 'arch-testing'); // SIM-ID01
  primeClaudeId01Trace(root, 'planner', SESSION, 'planner');
  // The Pass B consult runs against the draft; the planner reads the answer afterwards.
  return consultAndAccept(wave, 'Which rules apply to a one-file change?', 'planner');
}

test('planning phase: draft, orchestrate, mediated consult and accept in a consumer with sibling waves', { skip: SKIP }, () => {
  const wave = newWave('full-wave-b');
  try {
    const planning = planningPhase(wave);
    assert.ok(planning.request.startsWith(wave.root), 'coordination evidence stays under the consumer root');
  } finally { cleanup(wave); }
});

// The PreToolUse Bash hooks the consumer installs, in matrix order, plus the L0 architect write gates (not part of a
// consumer's matrix, so they are exercised as the toolkit hooks they are).
const CONSUMER_BASH_HOOKS = ['premature-execution-gate.js', 'bash-cli-spawn-gate.js', 'runtime-consultation-target-gate.js',
  'context-provider-write-gate.js', 'context-provider-gate.js', 'runtime-host-boundary.js'];
const ARCHITECT_WRITE_GATES = ['architect-bash-write-gate.js', 'architect-self-edit-gate.js'];

function assertNoHookDenies(root, command, agentType, session, hooks = CONSUMER_BASH_HOOKS) {
  for (const file of hooks) {
    const hookPath = path.join(ROOT, '.claude', 'hooks', file);
    const result = spawnSync('node', ['--require', IDENTITY_PRELOAD, hookPath], {
      input: JSON.stringify(bashEvent(command, agentType, session)), encoding: 'utf8', cwd: root, env: childEnv(root),
    });
    const denied = /"permissionDecision":"deny"|"decision":"block"/.test(result.stdout || '') || result.status === 2;
    assert.ok(!denied, `${file} must not deny ${agentType}'s ${command.slice(0, 90)}: ${result.stdout}${result.stderr}`);
  }
}

function assertArchitectCannotWriteVerdictByHand(root, slug, role) {
  const forged = `cat > .planning/wave-${slug}/${role}-verdict-prep.json <<'EOF'\n{}\nEOF`;
  const result = spawnSync('node', [path.join(ROOT, '.claude', 'hooks', 'architect-bash-write-gate.js')], {
    input: JSON.stringify(bashEvent(forged, role, SESSION)), encoding: 'utf8', cwd: root,
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
  });
  assert.ok(result.status === 2 || /block/.test(result.stdout), `${role} must not be able to write its verdict by hand: ${result.stdout}`);
}

/** The orchestrator creates each request through the launcher; each architect records its verdict through it. */
function verdictRound(wave, phase, { evidenceText } = {}) {
  const { root, slug } = wave;
  const verdicts = {};
  for (const role of ARCHITECTS) {
    const requestCommand = launcherCommand(root, 'verdict-request-write', ['--role', role, '--phase', phase, '--slug', slug]);
    assertNoHookDenies(root, requestCommand, '', SESSION);
    const request = launcher(root, 'verdict-request-write', ['--role', role, '--phase', phase, '--slug', slug]);
    assert.strictEqual(request.exit, 0, `${role} ${phase} request: ${request.stdout}${request.stderr}`);
    const line = request.stdout.trim().split('\n').pop();
    const requestPath = line.slice(0, line.lastIndexOf(' '));
    const requestSha = line.slice(line.lastIndexOf(' ') + 1);
    assert.match(requestSha, /^[0-9a-f]{64}$/, line);

    // The architect (SIM-MODEL: its rationale) records the verdict through the launcher, as one standalone command with
    // its rationale piped in; no hook may stand in its way, and it still cannot write the verdict file by hand.
    const verdictArgs = ['--role', role, '--phase', phase, '--slug', slug, '--request', requestPath, '--request-sha256', requestSha, '--decision', 'approve'];
    if (evidenceText) verdictArgs.push('--evidence-text', `${role}: ${evidenceText}`);
    const pipeline = `printf '%s\\n' 'approved after reading the plan' | ${launcherCommand(root, 'verdict-write', verdictArgs)}`;
    assertNoHookDenies(root, pipeline, role, SESSION);
    assertNoHookDenies(root, pipeline, role, SESSION, ARCHITECT_WRITE_GATES);
    assertArchitectCannotWriteVerdictByHand(root, slug, role);
    const written = run(root, 'bash', ['-c', pipeline]);
    assert.strictEqual(written.exit, 0, `${role} ${phase} verdict: ${written.stdout}${written.stderr}`);
    verdicts[role] = path.join(wave.waveDir, `${role}-verdict-${phase}.json`);
    assert.ok(fs.existsSync(verdicts[role]), `${role}'s ${phase} verdict is on disk`);
  }
  return verdicts;
}

const verdictFlags = (verdicts) => Object.entries(verdicts).flatMap(([role, file]) => ['--verdict', `${role}=${file}`]);

test('PREP: Pass B rebinds the digest, three architects record verdicts through the launcher, the wave enters EXECUTE', { skip: SKIP }, () => {
  const wave = newWave('full-wave-c');
  try {
    const { root, slug } = wave;
    planningPhase(wave);
    // Pass B (SIM-MODEL): the final PLAN. The documented step 6 re-runs orchestrate, which re-binds once.
    fs.writeFileSync(wave.planPath, planText(slug, { draft: false, extra: '\n## Context\n\n- context-provider answered the Pass B consult\n' }));
    const rebound = waveControl(root, 'init', '--slug', slug);
    assert.strictEqual(rebound.body.plan_draft, false, JSON.stringify(rebound));
    assert.strictEqual(waveControl(root, 'status', '--slug', slug).body.current, true);

    const prep = verdictRound(wave, 'prep');
    const toExecute = waveControl(root, 'transition', '--slug', slug, '--to', 'EXECUTE', ...verdictFlags(prep));
    assert.strictEqual(toExecute.body.phase, 'EXECUTE', JSON.stringify(toExecute));
    assert.strictEqual(toExecute.body.transitions[0].evidence.length, 3, 'three architect verdicts are the evidence');
  } finally { cleanup(wave); }
});

/** EXECUTE: a specialist the architect hands the accepted answer to passes the mediated gate and commits. */
function executePhase(wave) {
  const { root } = wave;
  const specialist = 'test-specialist'; // reports to arch-testing, the architect that accepted the consult
  const search = `grep -rn "registry" ${root}/src | head -5`;
  const after = hook(root, HOOKS.gate, bashEvent(search, specialist, FINAL_SESSION));
  const diagnose = () => ['test-specialist', 'arch-testing-prep'].map((agent) => {
    const r = rll.checkClaudeId01ProofComplete(root, FINAL_SESSION, rll.computeWorktreeId(root), rll.discoverPlan(root).planDigest, agent === 'arch-testing-prep' ? 'arch-testing' : agent, agent);
    return agent + ':' + (r.ok ? 'ok' : r.reason);
  }).join(' ');
  assert.ok(!after || after.permissionDecision !== 'deny', `the specialist passes the mediated gate after the hand-off: ${JSON.stringify(after)} proofs: ${diagnose()}`);

  // The architect dispatches the specialist: the dispatch artifact is written through the launcher (task body on stdin).
  const dispatchArgs = ['--architect', 'arch-testing', '--specialist', specialist, '--file', 'src/feature.txt', '--slug', wave.slug];
  const dispatch = `printf '%s\\n' 'add src/feature.txt' | ${launcherCommand(root, 'specialist-dispatch-write', dispatchArgs)}`;
  assertNoHookDenies(root, dispatch, 'arch-testing', FINAL_SESSION);
  const dispatched = run(root, 'bash', ['-c', dispatch]);
  assert.strictEqual(dispatched.exit, 0, `dispatch: ${dispatched.stdout}${dispatched.stderr}`);

  // SIM-MODEL: the trivial change. The Write and the commit go through the same hooks a specialist's tools do.
  const file = path.join(root, 'src', 'feature.txt');
  for (const hookFile of ['premature-execution-gate.js', 'plan-md-write-gate.js']) {
    const result = spawnSync('node', [path.join(ROOT, '.claude', 'hooks', hookFile)], {
      input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: file, content: 'feature\n' },
        session_id: FINAL_SESSION, agent_type: specialist, agent_id: specialist }),
      encoding: 'utf8', cwd: root, env: childEnv(root),
    });
    assert.ok(!/"permissionDecision":"deny"|"decision":"block"/.test(result.stdout || '') && result.status !== 2, `${hookFile} must allow the specialist's Write in EXECUTE: ${result.stdout}${result.stderr}`);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'feature\n');
  const commit = 'git add src/feature.txt && git -c user.email=specialist@test.local -c user.name=Specialist commit -qm "feat(src): add the feature file"';
  assertNoHookDenies(root, commit, specialist, FINAL_SESSION);
  const committed = run(root, 'bash', ['-c', commit]);
  assert.strictEqual(committed.exit, 0, committed.stderr);
  return git(root, 'rev-parse', 'HEAD');
}

/** QG -> COMPLETE in a consumer: pre-pr stamp, mint, verify, then the control plane verifies the proof. */
function qualityGatePhase(wave, scannerDir) {
  const { root, slug } = wave;
  const env = { TRUFFLEHOG_BIN: scannerStub(scannerDir) }; // SIM-SCAN
  const stamp = launcher(root, 'runtime-consumer-qg', ['pre-pr', '--slug', slug, '--project-gate', 'PASS'], env);
  assert.strictEqual(stamp.exit, 0, `pre-pr: ${stamp.stdout}${stamp.stderr}`);
  const minted = launcher(root, 'runtime-consumer-qg', ['mint', '--slug', slug], env);
  assert.strictEqual(minted.exit, 0, `mint: ${minted.stdout}${minted.stderr}`);
  const head = git(root, 'rev-parse', 'HEAD');
  const verified = launcher(root, 'runtime-consumer-qg', ['verify', '--slug', slug, '--head', head], env);
  assert.strictEqual(verified.exit, 0, `verify: ${verified.stdout}${verified.stderr}`);
  // The fixture's installed toolkit files and the wave plan are untracked by construction; what the QG and the wave state
  // write (.androidcommondoc/, reports) must not add to the status.
  const status = git(root, 'status', '--porcelain').split('\n');
  assert.deepStrictEqual(status.filter((line) => /\.androidcommondoc\/|report/i.test(line)), [], 'the QG stamps, proofs and reports stay out of the consumer status');
}

/**
 * The whole wave, draft to COMPLETE. `gapMs` is how much injected time passes before PREP and again before VERIFY_FINAL.
 */
function wholeWave(t, slug, gapMs, gaps = [gapMs, gapMs], { activity = false } = {}) {
  const wave = newWave(slug);
  const scannerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'full-wave-scanner-'));
  clock.offsetMs = 0;
  t.after(() => { clock.offsetMs = 0; fs.rmSync(scannerDir, { recursive: true, force: true }); cleanup(wave); });
  const { root } = wave;
  // Time passes. With `activity` the live roles keep working every 30 minutes (a verified tool call of each through the real
  // gate, which is where the hook renews the sliding session); without it the clock just jumps.
  const idle = (ms) => {
    if (!activity) { clock.advance(ms); return; }
    for (let left = ms; left > 0; left -= 30 * 60 * 1000) {
      clock.advance(Math.min(left, 30 * 60 * 1000));
      for (const [agentType, agentId] of [['arch-testing', 'arch-testing-prep'], ['test-specialist', 'test-specialist']]) {
        hook(root, HOOKS.gate, bashEvent('git status', agentType, FINAL_SESSION, agentId));
      }
    }
  };

  const planning = planningPhase(wave);
  fs.writeFileSync(wave.planPath, planText(slug, { draft: false, extra: '\n## Context\n\n- context-provider answered the Pass B consult\n' }));
  assert.strictEqual(waveControl(root, 'init', '--slug', slug).body.plan_draft, false, 'Pass B re-bound the state to the final digest');

  // A draft-bound consultation is planning input only: the specialist needs one accepted against the FINAL digest.
  // The PREP architect is a NEW single-use agent started after Pass B, so its CLAUDE-ID-01 startup trace is bound to the final
  // digest (SIM-ID01); it is the one that consults and then hands the answer to its specialist.
  primeClaudeId01Trace(root, 'arch-testing', FINAL_SESSION, 'arch-testing-prep');
  // The specialist it dispatches has its own trace; the gate authenticates its validation of the accepted chain with it.
  primeClaudeId01Trace(root, 'test-specialist', FINAL_SESSION, 'test-specialist');
  const finalConsult = consultAndAccept(wave, 'Does the final plan need anything beyond the docs checks?', 'test-specialist', { archAgent: 'arch-testing-prep', session: FINAL_SESSION });
  assert.notStrictEqual(finalConsult.planDigest, planning.planDigest, 'the final consult is bound to the final digest');

  // Risk: a long planning session. More than an hour passes before PREP; nothing may die of time alone.
  idle(gaps[0]);
  const prep = verdictRound(wave, 'prep');
  assert.strictEqual(waveControl(root, 'transition', '--slug', slug, '--to', 'EXECUTE', ...verdictFlags(prep)).body.phase, 'EXECUTE');

  const committedHead = executePhase(wave);

  // Risk: a long EXECUTE. More than an hour passes before VERIFY_FINAL.
  idle(gaps[1]);
  const verifyFinal = waveControl(root, 'transition', '--slug', slug, '--to', 'VERIFY_FINAL', '--rebind-head', 'true');
  assert.strictEqual(verifyFinal.body.phase, 'VERIFY_FINAL', JSON.stringify(verifyFinal));
  assert.strictEqual(verifyFinal.body.head, committedHead, 'the wave follows the specialist commit');
  const final = verdictRound(wave, 'verify-final', { evidenceText: 'target tests pass; the diff is inside the Path-Manifest' });
  assert.strictEqual(waveControl(root, 'transition', '--slug', slug, '--to', 'QG', ...verdictFlags(final)).body.phase, 'QG');

  qualityGatePhase(wave, scannerDir);
  const complete = waveControl(root, 'transition', '--slug', slug, '--to', 'COMPLETE');
  assert.strictEqual(complete.body.phase, 'COMPLETE', JSON.stringify(complete));
  assert.strictEqual(complete.body.transitions.length, 4, 'PREP, EXECUTE, VERIFY_FINAL and QG each advanced exactly once');
}

test('a whole consumer wave: draft to COMPLETE', { skip: SKIP }, (t) => wholeWave(t, 'full-wave-d', 0));

// Sliding session: with the roles active every 30 minutes the wave runs +2 h and then +3 h later (+5 h in all) to COMPLETE,
// with no re-orchestrate and no respawn.
test('a whole consumer wave with periodic activity across +2 h and +5 h: draft to COMPLETE', { skip: SKIP }, (t) =>
  wholeWave(t, 'full-wave-g', 0, [2 * HOUR, 3 * HOUR], { activity: true }));

// A long wave inside the session generation (one hour): the roles stay alive, nothing may die of time alone.
test('a whole consumer wave with 10 and 40 minutes between phases: draft to COMPLETE', { skip: SKIP }, (t) => wholeWave(t, 'full-wave-e', 0, [10 * 60 * 1000, 40 * 60 * 1000]));

// Without activity the proof must die, and say why: an hour of silence after the consult is a new start, not a resume.
test('a specialist silent for more than an hour is refused; re-orchestrating and restarting the roles restores it, at +65 min and +3 h', { skip: SKIP }, (t) => {
  const wave = newWave('full-wave-f');
  clock.offsetMs = 0;
  t.after(() => { clock.offsetMs = 0; cleanup(wave); });
  const { root, slug } = wave;
  planningPhase(wave);
  fs.writeFileSync(wave.planPath, planText(slug, { draft: false, extra: '\n## Context\n\n- context-provider answered the Pass B consult\n' }));
  waveControl(root, 'init', '--slug', slug);
  primeClaudeId01Trace(root, 'arch-testing', FINAL_SESSION, 'arch-testing-prep');
  primeClaudeId01Trace(root, 'test-specialist', FINAL_SESSION, 'test-specialist');
  consultAndAccept(wave, 'Does the final plan need anything beyond the docs checks?', 'test-specialist', { archAgent: 'arch-testing-prep', session: FINAL_SESSION });
  clock.advance(HOUR + 5 * 60 * 1000);
  const denied = hook(root, HOOKS.gate, bashEvent(`grep -rn "registry" ${root}/src | head -5`, 'test-specialist', FINAL_SESSION));
  assert.ok(denied && denied.permissionDecision === 'deny', `a silent specialist is denied: ${JSON.stringify(denied)}`);
  assert.match(String(denied.permissionDecisionReason || denied.reason || ''), /identity proof expired \(session generation rotated\); re-run \/init-session --orchestrate full-wave-f and execute the returned role actions, then retry/);

  // The way out is the documented one: the orchestrator re-runs orchestrate (the session generation rotates after an hour; the
  // wave state and the final PLAN are unchanged and still current), the roles are started again (SIM-RESPAWN: new traces in the
  // new generation) and consult again. This repeats across a three-hour wave.
  const intent = { mode: 'start', wave_slug: slug };
  for (const jump of [0, 3 * HOUR]) {
    clock.advance(jump);
    const replan = entrypoints.planEntrypointStep('init-session', intent, root);
    assert.strictEqual(entrypoints.plannedEntrypointWaveScope(replan).planDigest, rll.discoverPlan(root).planDigest, 're-orchestrate follows the unchanged final PLAN');
    assert.strictEqual(waveControl(root, 'init', '--slug', slug).body.phase, 'PREP', 'the control plane state survives the session generation');
    primeClaudeId01Trace(root, 'arch-testing', FINAL_SESSION, 'arch-testing-prep');
    primeClaudeId01Trace(root, 'test-specialist', FINAL_SESSION, 'test-specialist');
    consultAndAccept(wave, 'Anything new after the long pause?', 'test-specialist', { archAgent: 'arch-testing-prep', session: FINAL_SESSION });
    const after = hook(root, HOOKS.gate, bashEvent(`grep -rn "registry" ${root}/src | head -5`, 'test-specialist', FINAL_SESSION));
    assert.ok(!after || after.permissionDecision !== 'deny', `after re-orchestrating (+${jump / HOUR} h) the specialist is admitted again: ${JSON.stringify(after)}`);
  }
});

// Absolute timeout: even a role that never stops working loses the session 12 hours after it was created.
test('a role active every 30 minutes still loses the session at the 12 hour absolute limit, with the actionable message', { skip: SKIP }, (t) => {
  const wave = newWave('full-wave-h');
  clock.offsetMs = 0;
  t.after(() => { clock.offsetMs = 0; cleanup(wave); });
  const { root, slug } = wave;
  planningPhase(wave);
  fs.writeFileSync(wave.planPath, planText(slug, { draft: false, extra: '\n## Context\n\n- context-provider answered the Pass B consult\n' }));
  waveControl(root, 'init', '--slug', slug);
  primeClaudeId01Trace(root, 'arch-testing', FINAL_SESSION, 'arch-testing-prep');
  primeClaudeId01Trace(root, 'test-specialist', FINAL_SESSION, 'test-specialist');
  consultAndAccept(wave, 'Does the final plan need anything beyond the docs checks?', 'test-specialist', { archAgent: 'arch-testing-prep', session: FINAL_SESSION });
  const probe = () => hook(root, HOOKS.gate, bashEvent(`grep -rn "registry" ${root}/src | head -5`, 'test-specialist', FINAL_SESSION));
  for (let minutes = 30; minutes <= 11 * 60 + 30; minutes += 30) {
    clock.offsetMs = minutes * 60 * 1000;
    hook(root, HOOKS.gate, bashEvent('git status', 'test-specialist', FINAL_SESSION, 'test-specialist'));
    hook(root, HOOKS.gate, bashEvent('git status', 'arch-testing', FINAL_SESSION, 'arch-testing-prep'));
  }
  const alive = probe();
  assert.ok(!alive || alive.permissionDecision !== 'deny', `still admitted at +11 h 30 min of continuous activity: ${JSON.stringify(alive)}`);
  clock.offsetMs = 12 * HOUR + 60 * 1000;
  const denied = probe();
  assert.ok(denied && denied.permissionDecision === 'deny', 'past the absolute limit the specialist is refused');
  assert.match(String(denied.permissionDecisionReason), /identity proof expired \(session generation rotated\); re-run \/init-session --orchestrate full-wave-h/);
});
