#!/usr/bin/env node
// architect-scope-gate.js -- PreToolUse hook
// Blocks arch-* agents from Write/Edit on files not in current wave scope.
// Scope source: .planning/PLAN.md -- lines matching `- \`path\`` in "Scope files" sections.
// Escape hatch: SCOPE_GATE_DISABLE=1 allows but logs to .planning/scope-gate-bypasses.log

const fs = require('fs');
const path = require('path');

const t = setTimeout(() => process.exit(0), 5000);
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', c => input += c);
process.stdin.on('end', () => {
  clearTimeout(t);
  try {
    const data = JSON.parse(input);
    const agentType = data.agent_type || '';
    const toolName = data.tool_name || '';
    const sessionId = data.session_id || 'unknown';

    if (!agentType.startsWith('arch-')) process.exit(0);

    const targetPath = toolName === 'Write'
      ? (data.tool_input?.path || '')
      : (data.tool_input?.file_path || '');
    if (!targetPath) process.exit(0);

    const projectRoot = process.env.PROJECT_ROOT || process.cwd();

    const planPath = path.join(projectRoot, '.planning', 'PLAN.md');
    const planContent = fs.readFileSync(planPath, 'utf8');
    const scopePattern = /^- `([^`]+)`/gm;
    const scopeFiles = new Set();
    let match;
    while ((match = scopePattern.exec(planContent)) !== null) {
      scopeFiles.add(match[1].replace(/^\.\//, ''));
    }

    let normalizedTarget = targetPath;
    if (path.isAbsolute(targetPath)) {
      normalizedTarget = path.relative(projectRoot, targetPath);
    }
    normalizedTarget = normalizedTarget.replace(/\\/g, '/').replace(/^\.\//, '');

    if (scopeFiles.has(normalizedTarget)) process.exit(0);

    if (process.env.SCOPE_GATE_DISABLE === '1') {
      const logPath = path.join(projectRoot, '.planning', 'scope-gate-bypasses.log');
      const entry = `${new Date().toISOString()} | agent=${agentType} | session=${sessionId} | file=${normalizedTarget}
`;
      try { fs.appendFileSync(logPath, entry); } catch {}
      process.exit(0);
    }

    process.stdout.write(JSON.stringify({
      decision: 'block',
      reason: `File \`${normalizedTarget}\` is not in the current wave scope (PLAN.md). SendMessage team-lead with blocker + proposed fix + file + wave for authorization. Or set SCOPE_GATE_DISABLE=1 to bypass (logged).`
    }));
    process.exit(2);

  } catch (e) {
    process.exit(0);
  }
});
