#!/usr/bin/env node
'use strict';

// Interactive Claude does not expose the print-mode system/init frame. This
// hook records a signed, process-bound model/session pin from the host-owned
// SessionStart payload. PreToolUse later proves effective effort and the same
// live Claude process ancestry; it cannot manufacture a missing model pin.

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
    const runtimeHostClaude = require('../../scripts/lib/runtime-host-claude.cjs');
    const recorded = runtimeHostClaude.recordInteractiveSessionPin({ projectRoot, event });
    // Non-authoritative, code-only diagnostic so the later collaboration
    // denial can name why this session has no pin. Never used to authorize.
    try {
      runtimeHostClaude.recordInteractiveSessionPinDiagnostic({ projectRoot, event, result: recorded });
    } catch { /* diagnostics are best-effort */ }
    if (!recorded || recorded.ok !== true) {
      process.stderr.write('[runtime-host-session-start] '
        + String(recorded && (recorded.detail || recorded.reason) || 'HOST_PIN_UNPROVEN') + '\n');
    }
  } catch (error) {
    // SessionStart cannot block. A missing observation remains fail-closed at
    // the later collaboration entrypoint PreToolUse gate.
    const code = error && typeof error.code === 'string' && /^[A-Z0-9_]+$/.test(error.code)
      ? error.code
      : 'HOOK_EXCEPTION';
    process.stderr.write('[runtime-host-session-start] ' + code + '\n');
  }
  process.exit(0);
});
