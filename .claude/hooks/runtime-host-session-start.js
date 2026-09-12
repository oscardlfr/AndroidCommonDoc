#!/usr/bin/env node
'use strict';

// SessionStart is intentionally not promoted to full host identity. The
// recorder accepts only the richer system/init frame observed by the live
// conductor; this hook merely forwards genuine SessionStart fields so the
// same fail-closed validator can reject any attempt to fabricate model/tools.

let input = '';
const timeout = setTimeout(() => process.exit(0), 20000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  clearTimeout(timeout);
  try {
    const event = JSON.parse(input);
    const projectRoot = process.env.CLAUDE_PROJECT_DIR || event.cwd;
    const context = require('../../scripts/lib/runtime-project-context.cjs')
      .verifyRuntimeConsumerInstallation(projectRoot, { verifyContent: true });
    if (!context.ok) process.exit(0);
    require('../../scripts/lib/runtime-host-claude.cjs')
      .recordInteractiveSessionPin({ projectRoot, event });
  } catch {
    // SessionStart cannot block. A missing observation remains fail-closed at
    // the later collaboration entrypoint PreToolUse gate.
  }
  process.exit(0);
});
