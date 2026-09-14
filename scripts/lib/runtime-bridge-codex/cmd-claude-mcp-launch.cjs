'use strict';

// `claude-mcp-launch` CLI command controller: discovers/attaches to the exact owner via the proven live-worker discovery primitive; the test-only deterministic-mcp-client frontend completes its rendezvous through the same descriptor registry the server side publishes.

function createCmdClaudeMcpLaunch({
  RC,
  completeDeterministicMcpRendezvous,
  deriveProjectRootFromCoordinationRoot,
  isTestCapability,
  readCanonicalRequestArtifact,
  resolveLiveCodexAppServerWorker,
  usageError,
}) {
// ── claude-mcp-launch (PLAN.md ~L877) ──

const CLAUDE_MCP_LAUNCH_SPEC = Object.freeze({
  '--coordination-root': { required: true, repeatable: false },
  '--request': { required: true, repeatable: false },
  '--test-frontend': { required: false, repeatable: false },
});

/** @param {string[]} rawArgv @returns {{ok:true,value:{coordinationRoot:string,request:string,testFrontend:string|null}}|{ok:false,reason:string}} */
function parseClaudeMcpLaunchArgv(rawArgv) {
  const out = { coordinationRoot: null, request: null, testFrontend: null };
  const seen = {};
  let i = 0;
  while (i < rawArgv.length) {
    const flag = rawArgv[i];
    const spec = CLAUDE_MCP_LAUNCH_SPEC[flag];
    if (!spec) return { ok: false, reason: 'unknown-flag: ' + flag };
    if (i + 1 >= rawArgv.length) return { ok: false, reason: 'missing-value-for: ' + flag };
    const value = rawArgv[i + 1];
    if (seen[flag] && !spec.repeatable) return { ok: false, reason: 'duplicate-flag: ' + flag };
    seen[flag] = true;
    if (flag === '--coordination-root') out.coordinationRoot = value;
    else if (flag === '--request') out.request = value;
    else if (flag === '--test-frontend') out.testFrontend = value;
    i += 2;
  }
  const missing = Object.keys(CLAUDE_MCP_LAUNCH_SPEC).filter((flag) => CLAUDE_MCP_LAUNCH_SPEC[flag].required && !seen[flag]);
  if (missing.length > 0) return { ok: false, reason: 'missing-required-flag: ' + missing[0] };
  return { ok: true, value: out };
}
/**
 * PLAN.md ~L877/~L884: discovers/attaches to the exact owner or creates
 * only the PLAN-permitted ephemeral supervisor; production accepts no
 * role/driver/endpoint/capability/executable/prompt/credential argument,
 * and the optional deterministic frontend is accepted only under the
 * existing double-gated test capability -- production argv carrying it is
 * rc 3. Composition: discovery reuses resolveLiveCodexAppServerWorker, the
 * SAME proof runtime-spawn/dispatch already consume. Actually spawning the
 * frozen `claude` launcher (exact argv/env, PLAN.md ~L944-948) or minting a
 * fresh ephemeral-supervisor supervisor-start action (exclusively
 * runtime-role-lifecycle.cjs `ensure`'s own hook-gated authority) are both
 * genuinely new, security-sensitive surfaces with no existing composable
 * primitive anywhere in this module to reuse -- building either here would
 * risk an uncontrolled live process launch as a side effect of completing
 * this wave's minimum ABI composition, or would invent a second authority
 * model. Composition therefore stops at the proven discovery step and
 * reports the honest gap rather than a weaker substitute.
 */
async function cmdClaudeMcpLaunch(rawArgv) {
  const parsed = parseClaudeMcpLaunchArgv(rawArgv);
  if (!parsed.ok) return usageError(parsed.reason);
  if (parsed.value.testFrontend !== null) {
    if (!isTestCapability() || parsed.value.testFrontend !== 'deterministic-mcp-client-v1') {
      process.stderr.write('[claude-mcp-launch] rejected: test-frontend-not-permitted\n');
      process.exit(RC.CAPABILITY_SCHEMA_DRIFT);
    }
  }
  const rootResult = deriveProjectRootFromCoordinationRoot(parsed.value.coordinationRoot);
  if (!rootResult.ok) {
    process.stderr.write('[claude-mcp-launch] rejected: ' + rootResult.reason + '\n');
    process.exit(RC.AUTH_ISOLATION);
  }
  const requestResult = readCanonicalRequestArtifact(rootResult.coordRootReal, parsed.value.request);
  if (!requestResult.ok) {
    process.stderr.write('[claude-mcp-launch] rejected: ' + requestResult.reason + '\n');
    process.exit(RC.CAPABILITY_SCHEMA_DRIFT);
  }
  let worker;
  try {
    worker = resolveLiveCodexAppServerWorker(rootResult.projectRoot, requestResult.targetRole);
  } catch (err) {
    worker = { ok: false, reason: 'worker-resolution-threw' };
  }
  if (worker.ok && worker.available) {
    if (parsed.value.testFrontend === 'deterministic-mcp-client-v1') {
      const attached = await completeDeterministicMcpRendezvous(rootResult.coordRootReal, requestResult, worker.worker);
      if (!attached.ok) {
        process.stderr.write('[claude-mcp-launch] rejected: ' + attached.reason + '\n');
        process.exit(RC.CAPABILITY_SCHEMA_DRIFT);
      }
      process.stdout.write(JSON.stringify({
        schema: 'coordination/bridge-result/v1',
        command: 'claude-mcp-launch',
        ok: true,
        reason: 'deterministic-mcp-rendezvous-attached',
        artifact_ref: attached.artifactPath,
        worker_session_id: attached.record.worker_session_id,
        supervisor_instance_id: attached.record.supervisor_instance_id,
        child_instance_id: attached.record.child_instance_id,
        child_pid_identity: attached.record.child_pid_identity,
        result_attempt_id: attached.record.result_attempt_id,
        result_sha256: attached.record.result_sha256,
      }) + '\n');
      process.exit(RC.OK);
    }
    process.stderr.write('[claude-mcp-launch] unavailable: claude-launcher-not-yet-composed\n');
    process.exit(RC.AUTH_ISOLATION);
  }
  process.stderr.write('[claude-mcp-launch] unavailable: ' + (worker.reason || 'ephemeral-supervisor-creation-unavailable') + '\n');
  process.exit(RC.AUTH_ISOLATION);
}

  return Object.freeze({
    CLAUDE_MCP_LAUNCH_SPEC,
    cmdClaudeMcpLaunch,
    parseClaudeMcpLaunchArgv,
  });
}

module.exports = Object.freeze({ createCmdClaudeMcpLaunch });
