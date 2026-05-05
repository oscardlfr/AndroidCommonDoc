#!/usr/bin/env node
// team-topology-gate.js — Layer 2 topology enforcement
//
// TWO-HOOK DESIGN:
//   PostToolUse (Agent): records which peers have been spawned for a session-* team
//   PreToolUse (Task|Agent for arch-* subagent_type): checks mandatory peer coverage
//
// Flag file: os.tmpdir()/claude-team-topology-{sessionId}.flag (JSON)
// Escape hatch: CLAUDE_TOPOLOGY_GATE_DISABLED=1
// Fail-open: catch(e) -> exit 0 (never block due to script error)
//
// CP gotcha 1: uses os.tmpdir() flag pattern ONLY — no reads from .claude/teams/
// (stale after re-spawn). Flag is session-scoped and not persisted across sessions.

const fs = require('fs');
const os = require('os');
const path = require('path');

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

function writeFlag(flagPath, data) {
  try {
    fs.writeFileSync(flagPath, JSON.stringify(data), 'utf8');
  } catch { /* fail-open */ }
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
    const sessionId = data.session_id || process.env.CLAUDE_SESSION_ID || 'unknown';
    const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();
    const flagPath = getFlagPath(sessionId);

    // ── PostToolUse: record peers spawned for session-* teams ────────────────
    if (data.hook_event_name === 'PostToolUse' || toolName === 'Agent') {
      // Only record on PostToolUse Agent events
      if (data.hook_event_name !== 'PostToolUse') process.exit(0);

      try {
        const teamName = data.tool_result?.team_name
          || data.tool_input?.team_name
          || '';
        if (!String(teamName).startsWith('session-')) process.exit(0);

        const canonicalName = data.tool_input?.subagent_type
          || data.tool_input?.name
          || '';
        if (!canonicalName) process.exit(0);

        const existing = readFlag(flagPath) || { sessionId, peers: [], ts: Date.now() };
        if (!existing.peers.includes(canonicalName)) {
          existing.peers.push(canonicalName);
        }
        writeFlag(flagPath, existing);
      } catch { /* fail-open */ }
      process.exit(0);
    }

    // ── PreToolUse: check mandatory peers before arch-* spawns ───────────────
    if (toolName !== 'Task' && toolName !== 'Agent') process.exit(0);

    const subagentType = data.tool_input?.subagent_type || '';
    if (!/^arch-/.test(subagentType)) process.exit(0);

    if (process.env.CLAUDE_TOPOLOGY_GATE_DISABLED === '1') process.exit(0);

    const flagData = readFlag(flagPath);
    if (!flagData) process.exit(0); // no session yet — fail-open

    let topology;
    try {
      const yaml = require(path.join(projectRoot, 'mcp-server', 'node_modules', 'yaml'));
      const topoPath = path.join(projectRoot, '.claude', 'registry', 'wave-topology.yaml');
      topology = yaml.parse(fs.readFileSync(topoPath, 'utf8'));
    } catch {
      process.exit(0); // fail-open if topology config unreadable
    }

    const mandatoryPeers = (topology && Array.isArray(topology.mandatory_peers))
      ? topology.mandatory_peers
      : [];
    if (mandatoryPeers.length === 0) process.exit(0);

    const seenPeers = flagData.peers || [];
    const missing = mandatoryPeers.filter(p => !seenPeers.includes(p));

    if (missing.length > 0) {
      process.stdout.write(JSON.stringify({
        decision: 'block',
        reason: '[team-topology-gate] Cannot spawn "' + subagentType + '": mandatory peers not yet in session.\n'
          + 'Missing: ' + missing.join(', ') + '\n'
          + 'Seen: ' + (seenPeers.length ? seenPeers.join(', ') : '(none)') + '\n'
          + 'Ensure all mandatory_peers from wave-topology.yaml are spawned before dispatching to arch-* agents.\n'
          + 'Emergency escape: CLAUDE_TOPOLOGY_GATE_DISABLED=1'
      }));
      process.exit(2);
    }

    process.exit(0);

  } catch {
    // Fail-open — never block due to script error
    process.exit(0);
  }
});
