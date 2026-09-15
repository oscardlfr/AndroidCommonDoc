#!/usr/bin/env node
// Bash CLI Spawn Gate — PreToolUse hook (T-BUG-031-00 + WP3 supervisor-start
// background-launch authorization boundary).
//
// Part 1 (T-BUG-031-00 + WP3 correction #1): blocks attempts to spawn Claude OR
// Codex agents via CLI flags/subcommands inside Bash tool calls -- Claude:
// --agent-id, --team-name, -p "you are, --print "you are; Codex: an inline
// persona-assignment prompt via its non-interactive `exec`/`e` subcommand or a
// bare positional prompt (verified via `codex exec --help` on this Mac: the
// prompt is a POSITIONAL argument, not a flag -- `-p`/`--profile` in `codex
// exec` means config profile, unlike Claude's `-p`). False-positive guard:
// `claude --help` must NOT be blocked.
//
// Part 2 (WP3, PLAN.md "Host-native lifecycle action boundary" ~L162): a
// `supervisor-start` action's `bridge_command` is the ONLY sanctioned way a
// `runtime-bridge-codex.cjs` process may ever be launched in the background
// ("the top-level copies that value verbatim into the sanctioned background
// host-action surface ... No model/caller-authored shell string,
// daemonization ... or out-of-band launch exists"). This gate is a POSITIVE
// allowlist, not a heuristic blocklist (see
// docs memory: "Write-gate = concrete argv allowlist"): a Bash command that
// references the bridge script or its `session-run` subcommand is authorized
// ONLY when it (a) is invoked via the tool's own `run_in_background:true`
// (never a self-daemonizing shell string), (b) comes from the top-level
// orchestrator (empty `agent_type` — the same convention
// context-provider-gate.js/push-authorization-gate.js already use), (c)
// round-trips byte-for-byte through `parsePosixDirect`/`renderPosixDirect`
// back to a CURRENT, unexpired, `supervisor-start`-kind action's own
// `payload.bridge_argv` — a single structural check that, by construction,
// rejects assignments/pipes/redirects/substitutions/heredocs/metacharacter
// variants/alternate quoting/extra flags without enumerating each one, and
// (d) has never authorized a launch before (one-use — a no-clobber
// consumption marker, mirroring the lifecycle-command-grant idiom). This gate
// NEVER executes the bridge itself; it only validates the authorizing
// boundary of a Bash tool call that has not run yet.

const path = require('path');
const rll = require(path.join(__dirname, '..', '..', 'scripts', 'lib', 'runtime-role-lifecycle.cjs'));

const FORBIDDEN_PATTERNS = [
  /--agent-id/,
  /--team-name/,
  /-p\s+"you are/i,
  /--print\s+"you are/i,
  // WP3 correction #1: Codex's non-interactive equivalent. `codex exec`/`codex e`
  // (aliases confirmed via --help) and the bare `codex "<prompt>"` form both take
  // the prompt as a positional argument -- either quote style is a live vector.
  /\bcodex\s+(?:exec|e)\b[^|;&]*?["']you are/i,
  /\bcodex\s+["']you are/i,
];

const SAFE_COMMANDS = [
  /^claude\s+--help\b/,
  /^claude\s+-h\b/,
];

const BRIDGE_MARKER_RE = /runtime-bridge-codex\.cjs|session-run/;

function arraysEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

function extractFlagValue(argv, flag) {
  const idx = argv.indexOf(flag);
  if (idx === -1 || idx + 1 >= argv.length) return null;
  return argv[idx + 1];
}

/**
 * Validates a Bash command being FORCED INTO BACKGROUND that references the
 * sanctioned supervisor-start bridge surface. Returns `null` when the
 * command is unrelated to this surface (`run_in_background` not requested at
 * all -- a foreground mention of the bridge script, e.g. manual inspection,
 * `git log`, `grep`, is out of THIS gate's scope, since a foreground call
 * cannot achieve the detached/daemonized process this boundary exists to
 * prevent; or no bridge/session-run marker present -- ordinary background
 * dev commands are never touched by this gate) or fully authorized; returns
 * `{reason}` when it must be blocked.
 * @param {string} cmd
 * @param {boolean} runInBackground
 * @param {string} agentType
 * @returns {{reason:string}|null}
 */
function validateSupervisorStartLaunch(cmd, runInBackground, agentType) {
  const trimmed = cmd.trim();
  if (!runInBackground || !BRIDGE_MARKER_RE.test(trimmed)) return null;

  if (agentType) {
    return { reason: 'Only the top-level orchestrator (empty agent_type) may force a supervisor-start background launch; a subagent/peer attempted it.' };
  }

  const argv = rll.parsePosixDirect(trimmed);
  if (!argv) {
    return { reason: 'Command is not the canonical renderPosixDirect(bridge_argv) form -- no assignments, pipes, redirects, substitutions, heredocs, metacharacter variants, or alternate quoting are ever legal here.' };
  }

  const actionId = extractFlagValue(argv, '--action');
  if (!actionId) {
    return { reason: 'No --action <id> found in the parsed argv.' };
  }

  let found;
  try {
    found = rll.findActionAcrossRepos(actionId);
  } catch (err) {
    return { reason: 'Action lookup failed.' };
  }
  if (!found.ok || found.absent) {
    return { reason: 'No current lifecycle action matches this --action id.' };
  }
  const action = found.action;
  if (action.kind !== 'supervisor-start') {
    return { reason: 'The referenced action is not a supervisor-start action.' };
  }
  if (Date.now() >= Date.parse(action.expires_at)) {
    return { reason: 'The referenced supervisor-start action has expired.' };
  }

  const expectedArgv = action.payload && action.payload.bridge_argv;
  if (!arraysEqual(argv, expectedArgv)) {
    return { reason: 'Parsed argv does not deep-equal the minted action\'s own bridge_argv.' };
  }
  let rerendered;
  try {
    rerendered = rll.renderPosixDirect(argv);
  } catch (err) {
    return { reason: 'argv failed to re-render canonically.' };
  }
  if (rerendered !== trimmed) {
    return { reason: 'Command does not round-trip through renderPosixDirect(parsePosixDirect(command)).' };
  }

  // One-use: a no-clobber consumption marker. EEXIST == replay.
  const repoDescriptor = { repoId: action.repo_id };
  const markerPath = path.join(rll.registryRepoDir(repoDescriptor), 'actions', actionId + '.background-launch-consumed.json');
  const dirResult = rll.ensureSecureRegistryDir(path.dirname(markerPath));
  if (!dirResult.ok) {
    return { reason: 'Could not secure the consumption-marker directory.' };
  }
  try {
    rll.publishNoClobber(markerPath, Buffer.from(JSON.stringify({ consumed_at: new Date().toISOString() }), 'utf8'), {});
  } catch (err) {
    return { reason: 'This supervisor-start action already authorized one background launch (one-use, replay rejected).' };
  }

  return null;
}

let input = '';
const stdinTimeout = setTimeout(() => process.exit(0), 5000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  clearTimeout(stdinTimeout);
  try {
    const data = JSON.parse(input);
    if (data.tool_name !== 'Bash') { process.exit(0); }
    const cmd = (data.tool_input && data.tool_input.command) || '';

    // Safe commands always pass
    if (SAFE_COMMANDS.some(re => re.test(cmd.trim()))) { process.exit(0); }

    // Check forbidden patterns
    if (FORBIDDEN_PATTERNS.some(re => re.test(cmd))) {
      const output = {
        decision: 'block',
        reason: 'FORBIDDEN: CLI agent spawn via Bash. Use Agent() with correct subagent_type (T-BUG-031-00).'
      };
      process.stdout.write(JSON.stringify(output));
      process.exit(0);
    }

    const runInBackground = !!(data.tool_input && data.tool_input.run_in_background === true);
    const agentType = data.agent_type || '';
    const violation = validateSupervisorStartLaunch(cmd, runInBackground, agentType);
    if (violation) {
      const output = {
        decision: 'block',
        reason: '[bash-cli-spawn-gate] ' + violation.reason,
      };
      process.stdout.write(JSON.stringify(output));
      process.exit(0);
    }
  } catch (_) { /* silent */ }
  process.exit(0);
});
