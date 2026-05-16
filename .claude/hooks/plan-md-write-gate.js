#!/usr/bin/env node
/* eslint-disable no-console */

'use strict';

// PreToolUse Write|Edit gate: blocks non-planner agents from writing .planning/wave-*/PLAN.md.
// Side-effect (BL-W47-prep-3 F2): when planner writes PLAN.md, auto-creates
//   .claude/wave-quality-gates/<slug>.md stub so the wave sentinel exists before any specialist commits.
// Identity resolved from stdin JSON data.agent_type (empirically verified: architect-bash-write-gate.js:51).
// Escape hatch: CLAUDE_SKIP_PLANNER=1.
// Fail-open on bad input (exit 0) per BL-W31.7-09 protocol.

const fs = require('fs');
const path = require('path');

let input = '';
const stdinTimeout = setTimeout(() => process.exit(0), 5000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => (input += chunk));
process.stdin.on('end', () => {
  clearTimeout(stdinTimeout);

  if (process.env.CLAUDE_SKIP_PLANNER === '1') process.exit(0);

  let data;
  try {
    data = JSON.parse(input);
  } catch {
    process.exit(0);
  }

  const toolName = data.tool_name || '';
  if (toolName !== 'Write' && toolName !== 'Edit') process.exit(0);

  const filePath = (data.tool_input?.file_path ?? '').replace(/\\/g, '/');

  // Match .planning/wave-<slug>/PLAN.md or .planning/wave-<slug>/PLAN-W<digits>.md
  if (!/^\.planning\/wave-[^/]+\/PLAN(-W\d+)?\.md$/.test(filePath)) process.exit(0);

  const agentType = (data.agent_type ?? '').toLowerCase();
  if (agentType === 'planner') {
    // Auto-create wave-quality-gates sentinel stub for this wave.
    const slugMatch = filePath.match(/^\.planning\/wave-([^/]+)\/PLAN/);
    if (slugMatch) {
      const slug = slugMatch[1];
      const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();
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

  process.stdout.write(JSON.stringify({
    decision: 'block',
    reason: '[planner-gate] team-lead/architects/specialists may NOT write .planning/wave-*/PLAN.md — that file is the planner peer\'s exclusive work-product. Spawn planner via Agent(subagent_type="planner") and dispatch the planning task. Escape hatch: CLAUDE_SKIP_PLANNER=1.',
  }));
  process.exit(2);
});
