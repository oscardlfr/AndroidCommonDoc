#!/usr/bin/env node
// wave-phase-gate.js — Layer 3 wave phase enforcement
//
// TWO RULES, both PreToolUse:
//   Rule A — Bash: git push / gh pr create blocked if quality-gate.md missing
//   Rule B — Task|Agent: arch-* spawn blocked if PLAN.md missing
//
// Wave slug detection: CLAUDE_WAVE_SLUG env var, else git branch parsing.
// Branch pattern: feature/{slug} → slug = branch minus "feature/" prefix.
// If slug cannot be determined (detached HEAD, develop, etc.) → exit 0.
//
// Fail-open: catch(e) -> exit 0 (never block due to script error)

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function getWaveSlug(projectRoot) {
  if (process.env.CLAUDE_WAVE_SLUG) return process.env.CLAUDE_WAVE_SLUG;
  try {
    const result = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: projectRoot,
      timeout: 5000,
      encoding: 'utf8',
    });
    if (result.status !== 0) return null;
    const branch = (result.stdout || '').trim();
    if (!branch || branch === 'HEAD' || branch === 'develop' || branch === 'master' || branch === 'main') {
      return null;
    }
    if (branch.startsWith('feature/')) {
      return branch.slice('feature/'.length);
    }
    return branch;
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
    const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();

    // ── Rule A: Bash — block git push / gh pr create if quality-gate.md missing ──
    if (toolName === 'Bash') {
      const command = data.tool_input?.command || '';
      if (!/git push|gh pr create/.test(command)) process.exit(0);

      const slug = getWaveSlug(projectRoot);
      if (!slug) process.exit(0); // cannot determine wave context — fail-open

      const waveDir = path.join(projectRoot, '.planning', `wave-${slug}`);
      const qualityGatePath = path.join(waveDir, 'quality-gate.md');

      if (!fs.existsSync(qualityGatePath)) {
        process.stdout.write(JSON.stringify({
          decision: 'block',
          reason: '[wave-phase-gate] Rule A: quality-gate.md missing for wave "' + slug + '".\n'
            + 'Expected: .planning/wave-' + slug + '/quality-gate.md\n'
            + 'Create the quality-gate sentinel before pushing or creating a PR.'
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
