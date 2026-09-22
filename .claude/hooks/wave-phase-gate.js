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

const { getWaveSlug } = require('./hook-control-plane-utils');
const { hasIntent } = require('../../scripts/lib/shell-command-intent.cjs');
const waveControl = require('../../scripts/lib/wave-control-plane.cjs');

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
      if (!hasIntent(command, 'git-push') && !hasIntent(command, 'gh-pr-create')) process.exit(0);

      const slug = getWaveSlug(projectRoot, { protectedEnvReturnsNull: true });
      if (!slug) {
        process.stdout.write(JSON.stringify({
          decision: 'block',
          reason: '[wave-phase-gate] Rule A: active wave context cannot be resolved; push/PR intent fails closed.'
        }));
        process.exit(2);
      }

      let phaseState;
      try { phaseState = waveControl.status(projectRoot, slug); } catch (error) {
        process.stdout.write(JSON.stringify({
          decision: 'block', reason: '[wave-phase-gate] Rule A: phase state invalid for wave "' + slug + '": ' + error.message,
        }));
        process.exit(2);
      }
      if (!phaseState.current || phaseState.phase !== 'COMPLETE') {
        process.stdout.write(JSON.stringify({
          decision: 'block', reason: '[wave-phase-gate] Rule A: wave "' + slug + '" is at phase '
            + phaseState.phase + '; COMPLETE with current PLAN/HEAD binding is required.',
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

    let phaseState;
    try { phaseState = waveControl.status(projectRoot, slug); } catch (error) {
      process.stdout.write(JSON.stringify({
        decision: 'block',
        reason: '[wave-phase-gate] Rule B: phase state invalid for wave "' + slug + '": ' + error.message,
      }));
      process.exit(2);
    }
    if (!['PREP', 'VERIFY_FINAL'].includes(phaseState.phase) || !phaseState.required_roles.includes(subagentType)) {
      process.stdout.write(JSON.stringify({
        decision: 'block', reason: '[wave-phase-gate] Rule B: role "' + subagentType
          + '" is not required in phase ' + phaseState.phase + ' for class ' + phaseState.wave_class + '.',
      }));
      process.exit(2);
    }

    process.exit(0);

  } catch {
    // Fail-open — never block due to script error
    process.exit(0);
  }
});
