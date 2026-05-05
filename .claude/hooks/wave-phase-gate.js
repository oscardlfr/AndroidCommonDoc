#!/usr/bin/env node
// wave-phase-gate.js — Layer 3 wave phase enforcement
//
// TWO RULES, both PreToolUse:
//   Rule A — Bash: git push / gh pr create blocked if quality-gate sentinel missing
//   Rule B — Task|Agent: arch-* spawn blocked if PLAN.md missing
//
// Sentinel location (FIND-17 fix): .claude/wave-quality-gates/{slug}.md
// (moved from gitignored .planning/wave-{slug}/quality-gate.md)
//
// Wave slug detection (FIND-18 fix):
//   1. CLAUDE_WAVE_SLUG env var (canonical — export before session start)
//   2. git branch parsing: feature/{slug} → slug = branch minus "feature/" prefix
//   3. Alias scan fallback: scan .planning/wave-*/ dirs for PLAN.md presence;
//      if exactly one wave dir exists with PLAN.md, infer slug from dir name
// If slug cannot be determined → exit 0 (fail-open)
//
// Fail-open: catch(e) -> exit 0 (never block due to script error)

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function getWaveSlug(projectRoot) {
  // Priority 1: explicit env var
  if (process.env.CLAUDE_WAVE_SLUG) return process.env.CLAUDE_WAVE_SLUG;

  // Priority 2: git branch parsing
  try {
    const result = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: projectRoot,
      timeout: 5000,
      encoding: 'utf8',
    });
    if (result.status === 0) {
      const branch = (result.stdout || '').trim();
      if (branch && branch !== 'HEAD' && branch !== 'develop' && branch !== 'master' && branch !== 'main') {
        if (branch.startsWith('feature/')) {
          return branch.slice('feature/'.length);
        }
        return branch;
      }
    }
  } catch {
    // fall through to alias scan
  }

  // Priority 3: alias scan — infer from .planning/wave-*/ dirs with PLAN.md
  try {
    const planningDir = path.join(projectRoot, '.planning');
    if (!fs.existsSync(planningDir)) return null;
    const entries = fs.readdirSync(planningDir);
    const waveDirsWithPlan = entries.filter(e => {
      if (!/^wave-/.test(e)) return false;
      return fs.existsSync(path.join(planningDir, e, 'PLAN.md'));
    });
    if (waveDirsWithPlan.length === 1) {
      // e.g. "wave-bl-w42-pr1" → slug = "bl-w42-pr1"
      return waveDirsWithPlan[0].slice('wave-'.length);
    }
  } catch {
    // fall through
  }

  return null;
}

function getSentinelPath(projectRoot, slug) {
  // FIND-17 fix: sentinel is now in tracked .claude/wave-quality-gates/ dir
  return path.join(projectRoot, '.claude', 'wave-quality-gates', slug + '.md');
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
    const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();

    // ── Rule A: Bash — block git push / gh pr create if sentinel missing ──
    if (toolName === 'Bash') {
      const command = data.tool_input?.command || '';
      if (!/git push|gh pr create/.test(command)) process.exit(0);

      const slug = getWaveSlug(projectRoot);
      if (!slug) process.exit(0); // cannot determine wave context — fail-open

      const sentinelPath = getSentinelPath(projectRoot, slug);

      if (!fs.existsSync(sentinelPath)) {
        process.stdout.write(JSON.stringify({
          decision: 'block',
          reason: '[wave-phase-gate] Rule A: quality-gate sentinel missing for wave "' + slug + '".\n'
            + 'Expected: .claude/wave-quality-gates/' + slug + '.md\n'
            + 'Create the quality-gate sentinel before pushing or creating a PR.\n'
            + '(Sentinel moved from gitignored .planning/wave-' + slug + '/quality-gate.md — FIND-17 fix)'
        }));
        process.exit(2);
      }

      process.exit(0);
    }

    // ── Rule B: Task|Agent — block arch-* spawn if PLAN.md missing ───────────
    if (toolName !== 'Task' && toolName !== 'Agent') process.exit(0);

    const subagentType = data.tool_input?.subagent_type || '';
    if (!/^arch-/.test(subagentType)) process.exit(0);

    const slug = getWaveSlug(projectRoot);
    if (!slug) process.exit(0); // cannot determine wave context — fail-open

    const waveDir = path.join(projectRoot, '.planning', `wave-${slug}`);
    const planPath = path.join(waveDir, 'PLAN.md');

    if (!fs.existsSync(planPath)) {
      process.stdout.write(JSON.stringify({
        decision: 'block',
        reason: '[wave-phase-gate] Rule B: PLAN.md missing for wave "' + slug + '".\n'
          + 'Expected: .planning/wave-' + slug + '/PLAN.md\n'
          + 'Create the PLAN.md before dispatching to arch-* agents.'
      }));
      process.exit(2);
    }

    process.exit(0);

  } catch {
    // Fail-open — never block due to script error
    process.exit(0);
  }
});
