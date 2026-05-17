#!/usr/bin/env node
// team-completeness-gate.js — PreToolUse hook for Bash, Edit, Write.
//
// Uses os.tmpdir() flag (set by team-topology-gate.js PostToolUse) to detect
// session team spawn state. Reads wave-topology.yaml for mandatory_peers list.
//
// Block condition: active session team flag exists, known peers are fewer than
// mandatory_peers, AND the flag has been alive > N minutes (grace period).
//
// Bypasses:
//   TEAM_COMPLETENESS_BYPASS=1 env (session-scoped)
//
// Fail-open: any parse error, missing flag, missing topology config,
//   no session team, or stdin error -> exit 0
//
// Canonical reference: team-topology-gate.js (same flag pattern + yaml loading)

const fs = require('fs');
const os = require('os');
const path = require('path');

const GRACE_PERIOD_MS = 30 * 60 * 1000; // 30 minutes

function getTmpDir() {
  return process.env.TMPDIR || process.env.TMP || os.tmpdir();
}

function getFlagPath(sessionId) {
  const safe = String(sessionId).replace(/[^a-zA-Z0-9_-]/g, '-');
  return path.join(getTmpDir(), `claude-team-topology-${safe}.flag`);
}

function readFlag(flagPath) {
  if (!fs.existsSync(flagPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(flagPath, 'utf8'));
  } catch {
    return null;
  }
}

let input = '';
const t = setTimeout(() => process.exit(0), 5000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', c => input += c);
process.stdin.on('end', () => {
  clearTimeout(t);
  try {
    const data = JSON.parse(input);
    const toolName = data.tool_name || '';

    // Only intercept Bash, Edit, Write
    if (toolName !== 'Bash' && toolName !== 'Edit' && toolName !== 'Write') process.exit(0);

    // Bypass: session env
    if (process.env.TEAM_COMPLETENESS_BYPASS === '1') process.exit(0);

    const sessionId = data.session_id || process.env.CLAUDE_SESSION_ID || 'unknown';
    const flagPath = getFlagPath(sessionId);
    const flagData = readFlag(flagPath);

    // Fail-open: no session flag — either solo session or team not yet spawned
    if (!flagData) process.exit(0);

    const flagAge = Date.now() - (flagData.ts || 0);

    // Within grace period — don't block yet
    if (flagAge < GRACE_PERIOD_MS) process.exit(0);

    // Read mandatory_peers from wave-topology.yaml
    const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();
    let mandatoryPeers;
    try {
      const yaml = require(path.join(projectRoot, 'mcp-server', 'node_modules', 'yaml'));
      const topoPath = path.join(projectRoot, '.claude', 'registry', 'wave-topology.yaml');
      const topology = yaml.parse(fs.readFileSync(topoPath, 'utf8'));
      mandatoryPeers = Array.isArray(topology.mandatory_peers) ? topology.mandatory_peers : [];
    } catch {
      process.exit(0); // fail-open if topology config unreadable
    }

    if (mandatoryPeers.length === 0) process.exit(0);

    const seenPeers = flagData.peers || [];
    const missing = mandatoryPeers.filter(p => !seenPeers.includes(p));

    if (missing.length === 0) process.exit(0);

    const ageMins = Math.round(flagAge / 60000);
    process.stderr.write(
      `[team-completeness-gate] BLOCKED: session team incomplete after ${ageMins} min.\n` +
      `Missing mandatory peers: ${missing.join(', ')}\n` +
      `Seen peers: ${seenPeers.length ? seenPeers.join(', ') : '(none)'}\n` +
      `Mandatory peers (from wave-topology.yaml): ${mandatoryPeers.join(', ')}\n` +
      `Spawn all mandatory peers before continuing, or set TEAM_COMPLETENESS_BYPASS=1.\n`
    );
    process.exit(2);

  } catch {
    // Fail-open — never block due to script error
    process.exit(0);
  }
});
