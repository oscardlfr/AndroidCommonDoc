#!/usr/bin/env node
// premature-execution-gate.js — Block specialist Write/Edit/Bash before a CURRENT PREP + dispatch
//
// Subject agents: test-specialist, toolkit-specialist, ui-specialist,
//   domain-model-specialist, data-layer-specialist, doc-updater
// Excluded: arch-*, team-lead, context-provider, project-manager, quality-gater, planner
//
// Block condition: subject agent + active wave + (no current PREP verdict OR, for non-doc-updater
//   specialists, no current dispatch artifact OR a Write/Edit target outside dispatch files[])
//
// Currency (WS-3, disk-first, ancestry-bound):
//   - PREP: an arch-*-verdict.md with APPROVED-PREP whose **PLAN_SHA256** matches sha256(PLAN.md)
//     and whose **PREP-HEAD** is an ancestor of (or equal to) current HEAD.
//   - Dispatch: specialist-dispatches/<canonical>/*.json whose plan_sha256 matches sha256(PLAN.md)
//     and whose head is an ancestor of (or equal to) current HEAD.
//   - Write/Edit: target file must be in the union of files[] across all current dispatches
//     (in-repo targets only — out-of-repo paths are exempt).
//   - doc-updater is PREP-gated only — exempt from the dispatch/files[] requirement (D4).
//
// Bypasses:
//   WAVE_PREP_BYPASS=1 env (session-scoped)
//   [PREMATURE_EXEC_BYPASS] inline in Bash command string
//
// Fail-open: any parse error, no-wave, no-waveDir, stdin error -> exit 0
// Fail-CLOSED: active wave + specialist + missing PLAN.md, missing Spawn Table, unresolvable HEAD,
//   no current PREP verdict, no current dispatch (non-doc-updater), or Write/Edit target outside
//   dispatch files[] -> exit 2

const fs = require('fs');
const path = require('path');
const { getWaveSlug } = require('./hook-control-plane-utils');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

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

// Resolve current HEAD (40-hex) or '' — fail-closed at the call site (D5).
function getGitHead(projectRoot) {
  const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: projectRoot, timeout: 3000, encoding: 'utf8' });
  return r.status === 0 ? (r.stdout || '').trim() : '';
}
// sha256 of a file's RAW BYTES — byte-for-byte match with bash sha256sum/shasum (F2).
function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}
// True iff <ancestor> is an ancestor of (or equal to) <descendant> in projectRoot git history.
function isAncestor(projectRoot, ancestor, descendant) {
  const r = spawnSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], { cwd: projectRoot, timeout: 3000 });
  return r.status === 0;
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
    // (Decision 3 corrected fail-closed boundary — BEFORE the PREP/dispatch currency check)
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
    // Spawn Table present — fall through to the PREP + dispatch currency check

    // ── WS-3: disk-first PREP + dispatch currency (ancestry-bound) ──
    const currentHead = getGitHead(projectRoot);
    if (!/^[0-9a-f]{40}$/.test(currentHead)) {
      block('[premature-execution-gate] Active wave "' + slug + '" + specialist "' + agentType + '": git HEAD is unresolvable, cannot verify PREP/dispatch currency (fail-closed).');
      return;
    }
    const planHash = sha256File(planPath);

    // (3) PREP currency: an arch-*-verdict.md with APPROVED-PREP + matching PLAN_SHA256 + PREP-HEAD ancestor-of-HEAD.
    const verdictRe = /^(?:pr\d+-)?arch-[a-z]+-verdict\.md$/;
    let prepCurrent = false;
    let vEntries;
    try { vEntries = fs.readdirSync(waveDir); } catch { vEntries = []; }
    for (const entry of vEntries) {
      if (!verdictRe.test(entry)) continue;
      let content;
      try { content = fs.readFileSync(path.join(waveDir, entry), 'utf8'); } catch { continue; }
      if (!/APPROVED-PREP/.test(content)) continue;
      const planM = content.match(/^\*\*PLAN_SHA256\*\*:\s*([0-9a-f]{64})\s*$/m);
      const headM = content.match(/^\*\*PREP-HEAD\*\*:\s*([0-9a-f]{40})\s*$/m);
      if (!planM || !headM) continue;
      if (planM[1] !== planHash) continue;
      if (!isAncestor(projectRoot, headM[1], currentHead)) continue;
      prepCurrent = true;
      break;
    }
    if (!prepCurrent) {
      block('[premature-execution-gate] Specialist "' + agentType + '" attempted ' + toolName + ' but no CURRENT PREP verdict for wave "' + slug + '" (needs APPROVED-PREP with a **PREP-HEAD** ancestor of HEAD and **PLAN_SHA256** matching the current PLAN.md). A stale or generic APPROVED-PREP does not authorize execution.');
      return;
    }

    // (4) doc-updater is PREP-gated only — exempt from the dispatch requirement (D4).
    const canonical = SUBJECT_TYPES.find(s => agentType.startsWith(s));
    if (canonical === 'doc-updater') process.exit(0);

    // (5) Dispatch currency: specialist-dispatches/<canonical>/*.json. LOCAL try/catch — a missing dir
    //     (never dispatched) → [] → BLOCK, never crash-to-allow via the outer fail-open catch.
    const dispatchDir = path.join(waveDir, 'specialist-dispatches', canonical);
    let dEntries;
    try { dEntries = fs.readdirSync(dispatchDir); } catch { dEntries = []; }
    const currentDispatches = [];
    for (const f of dEntries) {
      if (!f.endsWith('.json')) continue;
      let obj;
      try { obj = JSON.parse(fs.readFileSync(path.join(dispatchDir, f), 'utf8')); } catch { continue; }
      if (obj && typeof obj.plan_sha256 === 'string' && typeof obj.head === 'string'
          && obj.plan_sha256 === planHash && /^[0-9a-f]{40}$/.test(obj.head)
          && isAncestor(projectRoot, obj.head, currentHead)) {
        currentDispatches.push(obj);
      }
    }
    if (currentDispatches.length === 0) {
      block('[premature-execution-gate] Specialist "' + canonical + '" attempted ' + toolName + ' with no CURRENT architect dispatch for wave "' + slug + '". An architect must materialize a dispatch artifact (write-specialist-dispatch.sh) bound to the current HEAD + PLAN before this specialist may execute.');
      return;
    }

    // (6) Write/Edit: target must be in the UNION of files[] across current dispatches. Out-of-repo exempt.
    if (toolName === 'Write' || toolName === 'Edit') {
      const fp = data.tool_input?.file_path || '';
      const rel = path.relative(projectRoot, path.resolve(projectRoot, fp));
      const outOfRepo = rel.startsWith('..') || path.isAbsolute(rel);
      if (!outOfRepo) {
        const allowed = new Set();
        for (const d of currentDispatches) {
          for (const wf of (Array.isArray(d.files) ? d.files : [])) {
            allowed.add(path.relative(projectRoot, path.resolve(projectRoot, wf)));
          }
        }
        if (!allowed.has(rel)) {
          block('[premature-execution-gate] Target "' + rel + '" is outside the authorized files[] of any current dispatch for specialist "' + canonical + '". Ask the orchestrator/architect for a dispatch covering this file, or stay within scope.');
          return;
        }
      }
      process.exit(0);
    }

    // (7) Bash: a current dispatch is required (confirmed above); the command is NOT parsed for file targets.
    process.exit(0);

  } catch {
    // Fail-open — never block due to script error
    process.exit(0);
  }
});
