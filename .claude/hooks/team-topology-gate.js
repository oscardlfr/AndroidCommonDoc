#!/usr/bin/env node
// team-topology-gate.js — Layer 2 topology enforcement
//
// TWO-HOOK DESIGN:
//   PostToolUse (Agent): records which peers have been spawned for a session-* team
//   PreToolUse (Task|Agent for arch-* subagent_type): checks class floor peer coverage
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
const { spawnSync } = require('child_process');

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

// canonical: premature-execution-gate.js getWaveSlug
function getWaveSlug(projectRoot) {
  const envSlug = (process.env.CLAUDE_WAVE_SLUG || '').trim();
  if (envSlug && !['develop', 'master', 'main', 'HEAD'].includes(envSlug)) return envSlug;

  try {
    const symResult = spawnSync('git', ['symbolic-ref', '--short', 'HEAD'], {
      cwd: projectRoot, timeout: 5000, encoding: 'utf8',
    });
    const abbResult = symResult.status !== 0
      ? spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
          cwd: projectRoot, timeout: 5000, encoding: 'utf8',
        })
      : null;
    const branch = (symResult.status === 0 ? symResult : abbResult)?.stdout?.trim() || '';
    if (branch && branch !== 'HEAD' && branch !== 'develop' && branch !== 'master' && branch !== 'main') {
      const slug = branch.split('/').pop();
      if (slug && slug !== 'develop' && slug !== 'master' && slug !== 'main' && slug !== 'HEAD') {
        return slug;
      }
    }
  } catch {
    // fall through to alias scan
  }

  try {
    const planningDir = path.join(projectRoot, '.planning');
    if (!fs.existsSync(planningDir)) return null;
    const entries = fs.readdirSync(planningDir);
    const waveDirsWithPlan = entries.filter(e => {
      if (!/^wave-/.test(e)) return false;
      return fs.existsSync(path.join(planningDir, e, 'PLAN.md'));
    });
    if (waveDirsWithPlan.length === 1) {
      return waveDirsWithPlan[0].slice('wave-'.length);
    }
  } catch {
    // fall through
  }

  return null;
}

function resolveFloorPeers(topology, waveDir) {
  // Read CLASS sentinel; missing => HARNESS fail-safe (Decision 6)
  let waveClass = 'HARNESS';
  try {
    const classPath = path.join(waveDir, 'CLASS');
    if (fs.existsSync(classPath)) {
      const raw = fs.readFileSync(classPath, 'utf8').trim();
      if (raw) waveClass = raw;
    }
  } catch {
    // fail-safe to HARNESS
  }

  const classFloors = topology.class_floors;
  if (classFloors && Array.isArray(classFloors[waveClass])) {
    return classFloors[waveClass];
  }
  // Deprecated alias fallback
  return Array.isArray(topology.mandatory_peers) ? topology.mandatory_peers : [];
}

function loadYaml(projectRoot) {
  try { return require(path.join(__dirname, '..', '..', 'mcp-server', 'node_modules', 'yaml')); } catch {}
  try { return require(path.join(projectRoot, 'mcp-server', 'node_modules', 'yaml')); } catch {}
  return null;
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

    // ── PreToolUse: check class floor peers before arch-* spawns ─────────────
    if (toolName !== 'Task' && toolName !== 'Agent') process.exit(0);

    const subagentType = data.tool_input?.subagent_type || '';
    if (!/^arch-/.test(subagentType)) process.exit(0);

    if (process.env.CLAUDE_TOPOLOGY_GATE_DISABLED === '1') process.exit(0);

    const flagData = readFlag(flagPath);
    if (!flagData) process.exit(0); // no session yet — fail-open

    // Resolve wave slug + waveDir for CLASS sentinel lookup
    const slug = getWaveSlug(projectRoot);
    const waveDir = slug
      ? (fs.existsSync(path.join(projectRoot, '.planning', `wave-${slug}`))
          ? path.join(projectRoot, '.planning', `wave-${slug}`)
          : fs.existsSync(path.join(projectRoot, 'planning', `wave-${slug}`))
            ? path.join(projectRoot, 'planning', `wave-${slug}`)
            : null)
      : null;

    let topology;
    try {
      const yaml = loadYaml(projectRoot);
      if (!yaml) process.exit(0); // fail-open if yaml package unavailable
      const topoPath = path.join(projectRoot, '.claude', 'registry', 'wave-topology.yaml');
      topology = yaml.parse(fs.readFileSync(topoPath, 'utf8'));
    } catch {
      process.exit(0); // fail-open if topology config unreadable
    }

    const mandatoryPeers = waveDir
      ? resolveFloorPeers(topology, waveDir)
      : (topology && Array.isArray(topology.mandatory_peers) ? topology.mandatory_peers : []);

    if (mandatoryPeers.length === 0) process.exit(0);

    const seenPeers = flagData.peers || [];
    const missing = mandatoryPeers.filter(p => !seenPeers.includes(p));

    if (missing.length > 0) {
      process.stdout.write(JSON.stringify({
        decision: 'block',
        reason: '[team-topology-gate] Cannot spawn "' + subagentType + '": class floor peers not yet in session.\n'
          + 'Missing: ' + missing.join(', ') + '\n'
          + 'Seen: ' + (seenPeers.length ? seenPeers.join(', ') : '(none)') + '\n'
          + 'Ensure all class floor peers from wave-topology.yaml are spawned before dispatching to arch-* agents.\n'
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
