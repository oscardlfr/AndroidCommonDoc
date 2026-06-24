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
const { getWaveSlug } = require('./hook-control-plane-utils');

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
      if (process.env.WAVE_PHASE_GATE_BYPASS === '1') process.exit(0);
      function isGatedCommand(cmd) {
        const stripped = cmd.trim()
          .replace(/^(?:[A-Z_][A-Z0-9_]*=[^\s]+\s+)+/, "")
          .replace(/^rtk\s+/, "")
          .replace(/^sudo\s+/, "");
        return /^git\s+push\b/.test(stripped) || /^gh\s+pr\s+create\b/.test(stripped);
      }
      if (!isGatedCommand(command)) process.exit(0);

      const slug = getWaveSlug(projectRoot, { protectedEnvReturnsNull: true });
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

    const slug = getWaveSlug(projectRoot, { protectedEnvReturnsNull: true });
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
