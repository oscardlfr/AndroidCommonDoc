#!/usr/bin/env node
/* eslint-disable no-console */

'use strict';

// PreToolUse Write|Edit gate:
//   - blocks non-planner agents from writing .planning/wave-*/PLAN.md
//   - confines planner writes to PLAN.md/CLASS for the active wave
// Side-effect (BL-W47-prep-3 F2): when planner writes PLAN.md, auto-creates
//   .claude/wave-quality-gates/<slug>.md stub so the wave sentinel exists before any specialist commits.
// Identity resolved from stdin JSON data.agent_type (empirically verified: architect-bash-write-gate.js:51).
// Escape hatch: CLAUDE_SKIP_PLANNER=1.
// Fail-open on bad input (exit 0) per BL-W31.7-09 protocol.

const fs = require('fs');
const path = require('path');
const { getWaveSlug } = require('./hook-control-plane-utils.js');

function block(reason) {
  process.stdout.write(JSON.stringify({ decision: 'block', reason }));
  process.exit(2);
}

function confinedRelativePath(projectRoot, requestedPath) {
  const root = path.resolve(projectRoot);
  const absolute = path.isAbsolute(requestedPath)
    ? path.resolve(requestedPath)
    : path.resolve(root, requestedPath);
  const relative = path.relative(root, absolute);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return null;
  }

  // An existing symlink in any path component could redirect the write after
  // lexical confinement. New components are safe because their first existing
  // ancestor has already been checked.
  let cursor = root;
  for (const segment of relative.split(path.sep)) {
    cursor = path.join(cursor, segment);
    try {
      if (fs.lstatSync(cursor).isSymbolicLink()) return null;
    } catch (error) {
      if (error && error.code === 'ENOENT') break;
      return null;
    }
  }
  return relative.split(path.sep).join('/');
}

// M67-RS-HARNESS-SUFFIX-IDENTITY-01: mirrors the harnessSuffixCandidateRole
// helper of context-provider-gate.js, agent-spawn-execution-gate.js and
// subagent-start-context-bundle.js exactly (duplicated by their precedent:
// parsing private to each hook). Claude Code names a second canonical
// Agent(subagent_type="planner") in the same session "planner-2" -- the
// documented planner Pass B. Only "<role>-<N>" with canonical decimal N>=2.
function harnessSuffixCandidateRole(name) {
  const m = /^(.+)-([1-9][0-9]*)$/.exec(name);
  if (!m) return null;
  const digits = m[2];
  if (digits.length === 1 && digits < '2') return null; // excludes "-1" (N must be >=2)
  return m[1];
}

let input = '';
const stdinTimeout = setTimeout(() => process.exit(0), 5000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => (input += chunk));
process.stdin.on('end', () => {
  clearTimeout(stdinTimeout);

  let data;
  try {
    data = JSON.parse(input);
  } catch {
    process.exit(0);
  }

  const toolName = data.tool_name || '';
  if (toolName !== 'Write' && toolName !== 'Edit') process.exit(0);

  const projectRoot = path.resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd());
  const requestedPath = data.tool_input?.file_path ?? '';
  const filePath = confinedRelativePath(projectRoot, requestedPath);
  const agentType = (data.agent_type ?? '').toLowerCase();
  const isPlanner = agentType === 'planner' || harnessSuffixCandidateRole(agentType) === 'planner';

  // The escape hatch skips mandatory planner delegation for a trivial main-agent
  // change. It must never disable confinement once the active actor is a planner.
  if (process.env.CLAUDE_SKIP_PLANNER === '1' && !isPlanner) process.exit(0);

  if (isPlanner) {
    const activeSlug = getWaveSlug(projectRoot, { protectedEnvReturnsNull: true });
    if (!activeSlug) {
      block('[planner-gate] planner write denied: active wave slug is unavailable; switch to the wave branch (git switch -c feature/<slug>) or set CLAUDE_WAVE_SLUG before dispatch.');
    }
    const allowedPlan = `.planning/wave-${activeSlug}/PLAN.md`;
    const allowedClass = `.planning/wave-${activeSlug}/CLASS`;
    if (filePath !== allowedPlan && filePath !== allowedClass) {
      block(`[planner-gate] planner writes are confined to ${allowedPlan} and ${allowedClass}; the active wave comes from the current branch (<prefix>/${activeSlug}) or CLAUDE_WAVE_SLUG, so plan a new wave on its own branch (git switch -c feature/<slug>); cross-wave, external, symlinked, and unrelated writes are denied.`);
    }

    // Auto-create wave-quality-gates sentinel stub for this wave.
    if (filePath === allowedPlan) {
      const slug = activeSlug;
      const sentinelDir = path.join(projectRoot, '.claude', 'wave-quality-gates');
      const sentinelPath = path.join(sentinelDir, `${slug}.md`);
      try {
        if (!fs.existsSync(sentinelPath)) {
          const timestamp = new Date().toISOString();
          const content = [
            `# Wave Quality Gate: ${slug}`,
            `# Auto-created by plan-md-write-gate.js at PLAN.md write time`,
            `# timestamp: ${timestamp}`,
            `# status: PASS (stub — overwritten by QG verdict at pre-PR time)`,
            '',
          ].join('\n');
          fs.mkdirSync(sentinelDir, { recursive: true });
          fs.writeFileSync(sentinelPath, content, 'utf8');
        }
      } catch {
        // Fail-open: sentinel creation failure must not block the planner write.
      }
    }
    process.exit(0);
  }

  // Match .planning/wave-<slug>/PLAN.md or .planning/wave-<slug>/PLAN-W<digits>.md
  if (!filePath || !/^\.planning\/wave-[^/]+\/PLAN(-W\d+)?\.md$/.test(filePath)) process.exit(0);

  block('[planner-gate] team-lead/architects/specialists may NOT write .planning/wave-*/PLAN.md — that file is the planner peer\'s exclusive work-product. Spawn planner via Agent(subagent_type="planner") and dispatch the planning task. Escape hatch: CLAUDE_SKIP_PLANNER=1.');
});
