'use strict';

// Hermetic Claude-host-contract fixture for tests that need a REAL
// (non-mocked) runtimeHostClaude.recordProductionSessionIdentity admission
// against the ACTUAL repo root -- e.g. because a later step in the same test
// spawns the real hook subprocess with cwd=repoRoot and that subprocess must
// find the same session identity under the same registry entry.
//
// A plain `git init` fixture (runtime-host-claude.test.js's own
// writeHostContractFixture) cannot be reused here: it deliberately creates an
// UNRELATED git repo, so its registryRepoDir (keyed off --git-common-dir,
// runtime-identity.cjs:computeRepoId) never correlates with the real repo's
// own registry entries. `git worktree add` instead shares the real repo's
// --git-common-dir (only --show-toplevel differs per worktree), so a session
// minted here lands in the exact registry location the real hook subprocess
// already looks under -- while `setup/claude-host-contract.json` is the
// worktree's OWN checked-out copy, never the real repo's tracked file.
//
// No real Claude installation and no untracked local qualification evidence
// are used: the "executable" is throwaway synthetic bytes hashed fresh, and
// the observer/stream evidence is a minimal event sequence sized to exactly
// satisfy runtime-host-claude.cjs's own verifyHostProbeObservations checks.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

function sha256bytes(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function sha256hex(text) { return sha256bytes(Buffer.from(text, 'utf8')); }

/**
 * @param {string} repoRoot real repo root (the SAME one the caller's later
 *   real-hook-subprocess step will use as cwd)
 * @param {{rc: object, runtimeHostClaude: object, event: object}} deps
 *   rc: require('../lib/runtime-consultation.cjs') (canonicalJSONStringify)
 *   runtimeHostClaude: require('../lib/runtime-host-claude.cjs')
 *   event: the system/init event to record (session_id/model/cwd/tools/mcp_servers)
 * @returns {{result: object, worktreeRoot: string, cleanup: () => void}}
 */
function mintIsolatedHostContractSession(repoRoot, { rc, runtimeHostClaude, wakeInterleaved, initFrameCount, event }) {
  // realpath: the session identity minted below is recorded against this root
  // and the hook under test later runs with it as cwd. macOS spells the same
  // directory /var/folders/... and /private/var/folders/..., and the admission
  // chain canonicalises, so handing the raw spelling around would make the
  // recorded identity and the hook's own scope resolution disagree and the hook
  // would fail closed against a session that is in fact correctly admitted.
  const worktreeRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'host-contract-worktree-')));
  const add = spawnSync('git', ['worktree', 'add', '--quiet', '--detach', worktreeRoot, 'HEAD'], { cwd: repoRoot, encoding: 'utf8' });
  if (add.status !== 0) throw new Error('git worktree add failed: ' + add.stderr);
  const cleanup = () => {
    try { fs.rmSync(runtimeHostClaude.__testOnlyRegistryDirFor ? runtimeHostClaude.__testOnlyRegistryDirFor(worktreeRoot) : '', { recursive: true, force: true }); } catch { /* best-effort, path may not exist */ }
    spawnSync('git', ['worktree', 'remove', '--force', worktreeRoot], { cwd: repoRoot, encoding: 'utf8' });
    try { fs.rmSync(worktreeRoot, { recursive: true, force: true }); } catch { /* best-effort */ }
  };
  try {
    // The worktree already checks out every TRACKED file the real qualification
    // fixture needs (the observer probe script, .claude/model-profiles.json);
    // only the wave-plan directory is untracked (.gitignore'd local state) and
    // the throwaway executable/evidence are inherently not tracked anywhere.
    const waveSlug = path.basename(fs.readdirSync(path.join(repoRoot, '.planning')).filter((n) => n.startsWith('wave-'))[0]);
    fs.mkdirSync(path.join(worktreeRoot, '.planning', waveSlug), { recursive: true });
    fs.writeFileSync(path.join(worktreeRoot, '.planning', waveSlug, 'PLAN.md'), '# host contract fixture placeholder\n');

    const observerPath = path.join(worktreeRoot, 'scripts', 'tests', 'fixtures', 'claude-host-contract-probe.cjs');
    const executablePath = path.join(worktreeRoot, 'bin', 'claude-synthetic');
    const evidenceRoot = path.join(worktreeRoot, 'probe-evidence');
    fs.mkdirSync(path.dirname(executablePath), { recursive: true });
    fs.mkdirSync(path.join(evidenceRoot, 'observer'), { recursive: true });
    fs.writeFileSync(executablePath, Buffer.from('synthetic claude executable ' + crypto.randomBytes(8).toString('hex'), 'utf8'));

    // Exact event topology required by runtime-host-claude.cjs's own
    // verifyHostProbeObservations (sessionStarts=1, agentPre/Post=2,
    // SubagentStart/Stop=3, SendMessage pre/post=1) -- same shape as
    // runtime-host-claude.test.js's own writeHostContractFixture, proven
    // there; duplicated here rather than shared to avoid touching that
    // already-passing file's own fixture.
    const sessionId = event.session_id;
    const agentA = 'host-contract-agent-a-' + crypto.randomBytes(4).toString('hex');
    const agentB = 'host-contract-agent-b-' + crypto.randomBytes(4).toString('hex');
    const toolA = 'host-contract-tool-a-' + crypto.randomBytes(4).toString('hex');
    const toolWake = 'host-contract-tool-wake-' + crypto.randomBytes(4).toString('hex');
    const toolB = 'host-contract-tool-b-' + crypto.randomBytes(4).toString('hex');
    const inputA = { description: 'probe A', subagent_type: 'probe-peer', name: 'probe-peer-a', prompt: 'A', run_in_background: true };
    const inputB = { description: 'probe B', subagent_type: 'probe-peer', name: 'probe-peer-b', prompt: 'B', run_in_background: false };
    const probeEvent = (hook, extras = {}) => {
      const raw = Object.assign({ hook_event_name: hook, session_id: sessionId }, extras);
      return {
        schema: 'runtime/claude-host-contract-probe-event/v1', evidence_mode: 'genuine-pinned',
        producer: 'claude-host-contract-probe', hook_event_name: hook,
        session_digest: sha256hex(sessionId),
        tool_use_digest: raw.tool_use_id ? sha256hex(raw.tool_use_id) : null,
        prompt_id_digest: null,
        agent_id_digest: raw.agent_id ? sha256hex(raw.agent_id) : null,
        agent_type: raw.agent_type || null,
        tool_name: raw.tool_name || null,
        tool_input_digest: raw.tool_input === undefined ? null : sha256hex(rc.canonicalJSONStringify(raw.tool_input)),
        updated_input_digest: extras.updated_input_digest || null,
        raw_event: raw,
        observed_at: '2026-09-05T14:50:00.000Z',
      };
    };
    const events = [
      probeEvent('SessionStart', { source: 'startup' }),
      probeEvent('PreToolUse', { tool_name: 'Agent', tool_use_id: toolA, tool_input: inputA,
        updated_input_digest: sha256hex(rc.canonicalJSONStringify(inputA)) }),
      probeEvent('SubagentStart', { agent_id: agentA, agent_type: 'probe-peer' }),
      probeEvent('PreToolUse', { agent_id: agentA, agent_type: 'probe-peer', tool_name: 'Read', tool_use_id: 'read-a-1', tool_input: { file_path: 'a1' } }),
      probeEvent('PostToolUse', { agent_id: agentA, agent_type: 'probe-peer', tool_name: 'Read', tool_use_id: 'read-a-1', tool_input: { file_path: 'a1' } }),
      probeEvent('PreToolUse', { agent_id: agentA, agent_type: 'probe-peer', tool_name: 'Read', tool_use_id: 'read-a-2', tool_input: { file_path: 'a2' } }),
      probeEvent('PostToolUse', { agent_id: agentA, agent_type: 'probe-peer', tool_name: 'Read', tool_use_id: 'read-a-2', tool_input: { file_path: 'a2' } }),
      probeEvent('SubagentStop', { agent_id: agentA, agent_type: 'probe-peer' }),
      probeEvent('PostToolUse', { tool_name: 'Agent', tool_use_id: toolA, tool_input: inputA,
        tool_response: { isAsync: true, status: 'async_launched', agentId: agentA } }),
      probeEvent('PreToolUse', { tool_name: 'SendMessage', tool_use_id: toolWake, tool_input: { recipient: 'probe-peer-a', message: 'wake' } }),
      // A real host starts the resumed actor while the wake call is still in
      // flight, so SubagentStart can precede the wake PostToolUse. Observed on
      // darwin in both orders across runs, which is why the ordering is an
      // option here rather than a fixed idealised sequence.
      ...(wakeInterleaved ? [
        probeEvent('SubagentStart', { agent_id: agentA, agent_type: 'probe-peer' }),
        probeEvent('PostToolUse', { tool_name: 'SendMessage', tool_use_id: toolWake, tool_input: { recipient: 'probe-peer-a', message: 'wake' },
          tool_response: { success: true, resumedAgentId: agentA } }),
      ] : [
        probeEvent('PostToolUse', { tool_name: 'SendMessage', tool_use_id: toolWake, tool_input: { recipient: 'probe-peer-a', message: 'wake' },
          tool_response: { success: true, resumedAgentId: agentA } }),
        probeEvent('SubagentStart', { agent_id: agentA, agent_type: 'probe-peer' }),
      ]),
      probeEvent('PreToolUse', { agent_id: agentA, agent_type: 'probe-peer', tool_name: 'Read', tool_use_id: 'read-a-3', tool_input: { file_path: 'nonce' } }),
      probeEvent('PostToolUse', { agent_id: agentA, agent_type: 'probe-peer', tool_name: 'Read', tool_use_id: 'read-a-3', tool_input: { file_path: 'nonce' } }),
      probeEvent('SubagentStop', { agent_id: agentA, agent_type: 'probe-peer' }),
      probeEvent('PreToolUse', { tool_name: 'Agent', tool_use_id: toolB, tool_input: inputB,
        updated_input_digest: sha256hex(rc.canonicalJSONStringify(inputB)) }),
      probeEvent('SubagentStart', { agent_id: agentB, agent_type: 'probe-peer' }),
      probeEvent('PreToolUse', { agent_id: agentB, agent_type: 'probe-peer', tool_name: 'Read', tool_use_id: 'read-b-1', tool_input: { file_path: 'b1' } }),
      probeEvent('PostToolUse', { agent_id: agentB, agent_type: 'probe-peer', tool_name: 'Read', tool_use_id: 'read-b-1', tool_input: { file_path: 'b1' } }),
      probeEvent('SubagentStop', { agent_id: agentB, agent_type: 'probe-peer' }),
      probeEvent('PostToolUse', { tool_name: 'Agent', tool_use_id: toolB, tool_input: inputB,
        tool_response: { status: 'completed', agentId: agentB, totalToolUseCount: 1 } }),
    ];
    const observerBytes = Buffer.from(events.map((row) => JSON.stringify(row)).join('\n') + '\n', 'utf8');
    const streamRows = [{
      // verifyHostProbeObservations requires exactly this closed tool set on
      // the probe's OWN system/init stream row -- a different, fixed
      // requirement from recordProductionSessionIdentity's own event.tools
      // check (Agent-or-Task) below, never the caller's event.tools verbatim.
      type: 'system', subtype: 'init', session_id: sessionId, model: event.model,
      claude_code_version: '2.1.261', tools: ['Task', 'Bash', 'Read', 'SendMessage'], mcp_servers: event.mcp_servers,
    }];
    // A probe that legitimately spans turns emits one system/init per turn, all
    // for the SAME session. initFrameCount models that; the default of 1 keeps
    // every existing caller byte-identical.
    for (let extra = 1; extra < (initFrameCount || 1); extra += 1) {
      streamRows.push(Object.assign({}, streamRows[0]));
    }
    fs.writeFileSync(path.join(evidenceRoot, 'observer', 'events.jsonl'), observerBytes);
    fs.writeFileSync(path.join(evidenceRoot, 'claude-stream.jsonl'), streamRows.map((row) => JSON.stringify(row)).join('\n') + '\n');

    const qualification = {
      schema: 'androidcommondoc/p1-native-host-contract-qualification/v1',
      status: 'HOST_CONTRACT_OBSERVED',
      session_id: sessionId,
      qualified_at: '2026-09-05T14:58:31.667Z',
      transport_profile: 'native-claude-cli',
      cli: {
        version: '2.1.261', executable_realpath: fs.realpathSync(executablePath),
        executable_sha256: sha256bytes(fs.readFileSync(executablePath)), actual_model: event.model,
      },
      evidence_sha256: {
        'observer/events.jsonl': sha256bytes(observerBytes),
        'claude-stream.jsonl': sha256bytes(fs.readFileSync(path.join(evidenceRoot, 'claude-stream.jsonl'))),
      },
      observed_contract: {
        same_actor_resume: true, different_same_type_peer: true, required_tools_present: true,
        additional_tools_allowed: true, post_tool_use_exposes_executed_input: true,
        canonical_five_key_input_executed: true,
      },
    };
    const qualificationPath = path.join(worktreeRoot, 'qualification.json');
    fs.writeFileSync(qualificationPath, JSON.stringify(qualification));

    // The worktree's OWN checked-out copy of the certificate for THIS platform
    // (a separate file on disk from the real repo's copy) must be cleared first
    // -- publishClaudeHostContractPackage no-clobber-writes and would otherwise
    // report HOST_CONTRACT_PACKAGE_CONFLICT against the pre-existing,
    // differently-pinned tracked certificate that occupies the same
    // destination. Certificates for OTHER platforms are deliberately left in
    // place: they no longer collide, and leaving them keeps this fixture
    // exercising the real coexisting-certificates layout.
    for (const certificateName of ['claude-host-contract.' + process.platform + '.json', 'claude-host-contract.json']) {
      const certificatePath = path.join(worktreeRoot, 'setup', certificateName);
      let certificateOs = null;
      try { certificateOs = JSON.parse(fs.readFileSync(certificatePath, 'utf8')).certificate.os; } catch { certificateOs = null; }
      if (certificateOs === process.platform) fs.rmSync(certificatePath, { force: true });
    }

    const published = runtimeHostClaude.publishClaudeHostContractPackage({
      projectRoot: worktreeRoot, qualificationPath, evidenceRoot, observerPath,
    });
    if (!published.ok) throw new Error('publishClaudeHostContractPackage failed: ' + JSON.stringify(published));

    const result = runtimeHostClaude.recordProductionSessionIdentity({
      projectRoot: worktreeRoot,
      event: Object.assign({}, event, { cwd: worktreeRoot }),
      hostPin: {
        executablePath, cliVersion: qualification.cli.version, observerPath,
        transportProfile: qualification.transport_profile, os: process.platform,
      },
    });
    return { result, worktreeRoot, cleanup };
  } catch (err) {
    cleanup();
    throw err;
  }
}

module.exports = { mintIsolatedHostContractSession };
