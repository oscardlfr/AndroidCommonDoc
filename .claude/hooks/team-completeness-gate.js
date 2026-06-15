#!/usr/bin/env node
// team-completeness-gate.js — PreToolUse hook for Bash, Edit, Write.
//
// Uses os.tmpdir() flag (set by team-topology-gate.js PostToolUse) to detect
// session team spawn state. Reads wave-topology.yaml for class_floors role-list
// resolved from the active wave's CLASS sentinel.
//
// Block condition: active session team flag exists, known peers are fewer than
// the class floor role-list, AND the flag has been alive > N minutes (grace period).
//
// Bypasses:
//   TEAM_COMPLETENESS_BYPASS=1 env (session-scoped)
//
// Fail-open: any parse error, missing flag, missing topology config,
//   no session team, no active wave, or stdin error -> exit 0
//
// Canonical reference: team-topology-gate.js (same flag pattern + yaml loading)

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

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

  // Look up class_floors[waveClass]; fall back to mandatory_peers (deprecated alias)
  const classFloors = topology.class_floors;
  if (classFloors && Array.isArray(classFloors[waveClass])) {
    return classFloors[waveClass];
  }
  // Deprecated alias fallback
  return Array.isArray(topology.mandatory_peers) ? topology.mandatory_peers : [];
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

    const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();

    // Resolve wave slug + waveDir for CLASS sentinel lookup
    const slug = getWaveSlug(projectRoot);
    const waveDir = slug
      ? (fs.existsSync(path.join(projectRoot, '.planning', `wave-${slug}`))
          ? path.join(projectRoot, '.planning', `wave-${slug}`)
          : fs.existsSync(path.join(projectRoot, 'planning', `wave-${slug}`))
            ? path.join(projectRoot, 'planning', `wave-${slug}`)
            : null)
      : null;

    // Read topology + resolve floor peers
    let mandatoryPeers;
    try {
      const yaml = require(path.join(__dirname, '..', '..', 'mcp-server', 'node_modules', 'yaml'));
      const topoPath = path.join(projectRoot, '.claude', 'registry', 'wave-topology.yaml');
      const topology = yaml.parse(fs.readFileSync(topoPath, 'utf8'));
      // Use class_floors if waveDir known; fall back to mandatory_peers if no active wave
      mandatoryPeers = waveDir
        ? resolveFloorPeers(topology, waveDir)
        : (Array.isArray(topology.mandatory_peers) ? topology.mandatory_peers : []);
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
      `Mandatory peers (wave class floor from wave-topology.yaml): ${mandatoryPeers.join(', ')}\n` +
      `Spawn all mandatory peers before continuing, or set TEAM_COMPLETENESS_BYPASS=1.\n`
    );
    process.exit(2);

  } catch {
    // Fail-open — never block due to script error
    process.exit(0);
  }
});
