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
// Fail-open: any parse error, missing PLAN.md, stdin error -> exit 0

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const SUBJECT_TYPES = new Set([
  'test-specialist',
  'toolkit-specialist',
  'ui-specialist',
  'domain-model-specialist',
  'data-layer-specialist',
  'doc-updater',
]);

// Copied verbatim from wave-phase-gate.js lines 24-66 (Decision 2)
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

function hasApprovedPrep(waveDir) {
  // Decision 3: scan for /^(?:pr\d+-)?arch-platform-verdict\.md$/ files containing APPROVED-PREP
  // Note: verdict spec has a typo (`prd+`) — use `pr\d+` per PLAN.md (authoritative)
  const verdictRe = /^(?:pr\d+-)?arch-platform-verdict\.md$/;
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

    // Only subject agents are gated
    if (!SUBJECT_TYPES.has(agentType)) process.exit(0);

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

    // Active wave confirmed — check for APPROVED-PREP verdict
    if (hasApprovedPrep(waveDir)) process.exit(0);

    // Block: specialist + active wave + no APPROVED-PREP
    process.stderr.write(JSON.stringify({
      decision: 'block',
      reason: '[premature-execution-gate] Specialist "' + agentType + '" attempted ' + toolName
        + ' before APPROVED-PREP verdict for wave "' + slug + '".\n'
        + 'Expected an APPROVED-PREP verdict file in .planning/wave-' + slug + '/\n'
        + 'Wait for arch-platform to write the APPROVED-PREP verdict, or set WAVE_PREP_BYPASS=1.',
    }) + '\n');
    process.exit(2);

  } catch {
    // Fail-open — never block due to script error
    process.exit(0);
  }
});
