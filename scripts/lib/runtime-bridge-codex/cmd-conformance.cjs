'use strict';

// `conformance` CLI command controller: shared argv/project-root prologue, dispatching to the byte-identical mcp-mode stub or the real app-server conformance run.

function createCmdConformance({
  RC,
  cmdConformanceAppServer,
  fs,
  path,
  resolveAppServerSpawnCommand,
  usageError,
}) {
// ── conformance (PLAN.md ~L880, "Conformance evidence") ──

const CONFORMANCE_SPEC = Object.freeze({
  '--mode': { required: true, repeatable: false },
  '--project-root': { required: true, repeatable: false },
});
const CONFORMANCE_MODES = Object.freeze(['app-server', 'mcp']);

/** @param {string[]} rawArgv @returns {{ok:true,value:{mode:string,projectRoot:string}}|{ok:false,reason:string}} */
function parseConformanceArgv(rawArgv) {
  const out = { mode: null, projectRoot: null };
  const seen = {};
  let i = 0;
  while (i < rawArgv.length) {
    const flag = rawArgv[i];
    const spec = CONFORMANCE_SPEC[flag];
    if (!spec) return { ok: false, reason: 'unknown-flag: ' + flag };
    if (i + 1 >= rawArgv.length) return { ok: false, reason: 'missing-value-for: ' + flag };
    const value = rawArgv[i + 1];
    if (seen[flag] && !spec.repeatable) return { ok: false, reason: 'duplicate-flag: ' + flag };
    seen[flag] = true;
    if (flag === '--mode') out.mode = value;
    else if (flag === '--project-root') out.projectRoot = value;
    i += 2;
  }
  const missing = Object.keys(CONFORMANCE_SPEC).filter((flag) => CONFORMANCE_SPEC[flag].required && !seen[flag]);
  if (missing.length > 0) return { ok: false, reason: 'missing-required-flag: ' + missing[0] };
  if (!CONFORMANCE_MODES.includes(out.mode)) return { ok: false, reason: 'invalid-mode: ' + out.mode };
  return { ok: true, value: out };
}

/**
 * PLAN.md ~L880/~L884: accepts only `app-server|mcp`. Shared argv/project-
 * root prologue only -- kept a plain (non-async) top-level function, never
 * renamed, so its own literal declaration line stays a stable structural
 * anchor. `--mode mcp` stays the pre-existing, byte-identical fail-closed
 * placeholder and never enters the app-server implementation below
 * (sequence95-codex-decision.json GO_WITH_CLOSED_BINDING: this sequence's
 * closed scope is `--mode app-server` only).
 */
function cmdConformance(rawArgv) {
  const parsed = parseConformanceArgv(rawArgv);
  if (!parsed.ok) return usageError(parsed.reason);
  if (typeof parsed.value.projectRoot !== 'string' || !path.isAbsolute(parsed.value.projectRoot)) {
    return usageError('project-root-not-absolute');
  }
  let st;
  try {
    st = fs.lstatSync(parsed.value.projectRoot);
  } catch (err) {
    st = null;
  }
  if (!st || !st.isDirectory()) {
    process.stderr.write('[conformance] rejected: project-root-not-found\n');
    process.exit(RC.CAPABILITY_SCHEMA_DRIFT);
  }
  if (parsed.value.mode === 'mcp') {
    return cmdConformanceMcpStub(parsed.value.mode);
  }
  return cmdConformanceAppServer(parsed.value.projectRoot);
}

/**
 * Byte-identical to the pre-Sequence-99 stub verdict/exit shape: proves
 * only the pinned-binary capability session-run itself resolves, never a
 * live child/model turn.
 * @returns {never}
 */
function cmdConformanceMcpStub(mode) {
  let spawnCommand;
  try {
    spawnCommand = resolveAppServerSpawnCommand();
  } catch (err) {
    spawnCommand = null;
  }
  const capabilityProven = !!(spawnCommand && typeof spawnCommand.command === 'string' && spawnCommand.command.length > 0);
  const verdict = {
    schema: 'coordination/bridge-result/v1', command: 'conformance', ok: false,
    mode,
    capability_proven: capabilityProven,
    reason: 'live-conformance-not-attempted-by-this-implementation-pass',
  };
  process.stdout.write(JSON.stringify(verdict) + '\n');
  process.exit(RC.LIVE_CONFORMANCE_FAILURE);
}

  return Object.freeze({
    CONFORMANCE_MODES,
    CONFORMANCE_SPEC,
    cmdConformance,
    cmdConformanceMcpStub,
    parseConformanceArgv,
  });
}

module.exports = Object.freeze({ createCmdConformance });
