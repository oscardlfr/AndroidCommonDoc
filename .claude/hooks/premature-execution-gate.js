#!/usr/bin/env node
// premature-execution-gate.js — Block specialist Write/Edit/Bash before APPROVED-PREP verdict
//
// Subject agents: test-specialist, toolkit-specialist, ui-specialist,
//   domain-model-specialist, data-layer-specialist, doc-updater
// Excluded: arch-*, team-lead, context-provider, project-manager, quality-gater, planner
//
// Block condition: subject agent + active wave + no APPROVED-PREP verdict file in wave dir
//
// Bypasses:
//   WAVE_PREP_BYPASS=1 env (session-scoped)
//   [PREMATURE_EXEC_BYPASS] inline in Bash command string
//
// Fail-open: any parse error, no-wave, no-waveDir, stdin error -> exit 0
// Fail-CLOSED: active wave + specialist + missing PLAN.md or missing Spawn Table -> exit 2

const fs = require('fs');
const path = require('path');
const { getWaveSlug } = require('./hook-control-plane-utils');

// Canonical subject type names — matched with startsWith to tolerate
// suffix-rotated peer names (e.g. toolkit-specialist-2 matches toolkit-specialist)
const SUBJECT_TYPES = [
  'test-specialist',
  'toolkit-specialist',
  'ui-specialist',
  'domain-model-specialist',
  'data-layer-specialist',
  'doc-updater',
];

function hasApprovedPrep(waveDir) {
  // Decision 3: scan for /^(?:pr\d+-)?arch-[a-z]+-verdict\.md$/ files containing APPROVED-PREP
  // Broadened from arch-platform-only (BL-W47-prep-2): any arch-domain verdict proves PREP passed.
  const verdictRe = /^(?:pr\d+-)?arch-[a-z]+-verdict\.md$/;
  let entries;
  try {
    entries = fs.readdirSync(waveDir);
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (!verdictRe.test(entry)) continue;
    try {
      const content = fs.readFileSync(path.join(waveDir, entry), 'utf8');
      if (/APPROVED-PREP/.test(content)) return true;
    } catch {
      // skip unreadable files
    }
  }
  return false;
}

function block(reason) {
  // Write decision JSON to stdout, then flush stdout before exit (CR #2).
  // Drain-event pattern ensures the write is flushed before termination.
  const json = JSON.stringify({ decision: 'block', reason });
  if (process.stdout.write(json)) {
    process.exit(2);
  } else {
    process.stdout.once('drain', () => process.exit(2));
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
    const agentType = data.agent_type || '';

    // Only intercept Write, Edit, Bash
    if (toolName !== 'Write' && toolName !== 'Edit' && toolName !== 'Bash') process.exit(0);

    // Only subject agents are gated — startsWith for suffix-rotation tolerance
    if (!SUBJECT_TYPES.some(s => agentType.startsWith(s))) process.exit(0);

    // Bypass 1: session-scoped env
    if (process.env.WAVE_PREP_BYPASS === '1') process.exit(0);

    // Bypass 2: inline token in Bash command
    if (toolName === 'Bash') {
      const command = data.tool_input?.command || '';
      if (command.includes('[PREMATURE_EXEC_BYPASS]')) process.exit(0);
    }

    const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();
    const slug = getWaveSlug(projectRoot);

    // Fail-open: no wave detected
    if (!slug) process.exit(0);

    // Check both .planning/ (production) and planning/ (bats fixture compat)
    const waveDirDot = path.join(projectRoot, '.planning', `wave-${slug}`);
    const waveDirNoDot = path.join(projectRoot, 'planning', `wave-${slug}`);
    const waveDir = fs.existsSync(waveDirDot) ? waveDirDot : fs.existsSync(waveDirNoDot) ? waveDirNoDot : null;

    // Fail-open: wave dir absent — cannot confirm active wave
    if (!waveDir) process.exit(0);

    // Spawn-Table precondition: active-wave + specialist → PLAN.md + Spawn Table required
    // (Decision 3 corrected fail-closed boundary — BEFORE hasApprovedPrep)
    const planPath = path.join(waveDir, 'PLAN.md');
    if (!fs.existsSync(planPath)) {
      block(
        '[premature-execution-gate] Active wave "' + slug + '" + specialist "' + agentType + '" but no PLAN.md found.\n'
        + 'Planner must write PLAN.md before specialists execute.'
      );
      return;
    }
    const planContent = fs.readFileSync(planPath, 'utf8');
    if (!/^###\s+Spawn Table/m.test(planContent)) {
      if (process.env.SKIP_SPAWN_TABLE === '1') process.exit(0);
      block(
        '[premature-execution-gate] PLAN.md missing "### Spawn Table" section for wave "' + slug + '".\n'
        + 'Planner must add ### Spawn Table before specialists execute.\n'
        + 'Emergency escape: SKIP_SPAWN_TABLE=1'
      );
      return;
    }
    // Spawn Table present — fall through to hasApprovedPrep check

    // Active wave confirmed — check for APPROVED-PREP verdict
    if (hasApprovedPrep(waveDir)) process.exit(0);

    // Block: specialist + active wave + no APPROVED-PREP
    // P1c fix: block JSON must go to stdout (not stderr) — harness reads stdout for decisions.
    block(
      '[premature-execution-gate] Specialist "' + agentType + '" attempted ' + toolName
        + ' before APPROVED-PREP verdict for wave "' + slug + '".\n'
        + 'Expected an APPROVED-PREP verdict file in .planning/wave-' + slug + '/\n'
        + 'Wait for arch-platform to write the APPROVED-PREP verdict, or set WAVE_PREP_BYPASS=1.'
    );
    return;

  } catch {
    // Fail-open — never block due to script error
    process.exit(0);
  }
});
