#!/usr/bin/env node
// context-provider-consulted.js — PostToolUse hook on SendMessage
// Writes claude-cp-consulted-{session_id}.flag when ANY agent addresses context-provider.
// Session-scoped flag: one agent consulting CP unblocks all peers in that session
// (via context-provider-gate.js). Matches Search Dispatch Protocol intent.
// Use os.tmpdir() — never hardcode /tmp/ (Windows).
//
// BL-W35-06 fix: also writes per-agent arch-response flag when arch → specialist.
// Dual-flag behavior: global CP flag (arch-tier) + per-agent flag (specialists).
// Emergency escape:
//   rm "$(node -e "console.log(require('os').tmpdir())")/claude-cp-consulted-*.flag"
//   rm "$(node -e "console.log(require('os').tmpdir())")/claude-arch-responded-*.flag"

const fs = require('fs');
const os = require('os');
const path = require('path');

function sanitizeId(id) {
  return String(id).replace(/[^a-zA-Z0-9_-]/g, '-');
}

let input = '';
const t = setTimeout(() => process.exit(0), 5000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', c => input += c);
process.stdin.on('end', () => {
  clearTimeout(t);
  try {
    const data = JSON.parse(input);
    const sessionId = data.session_id || 'unknown';
    const to = data.tool_input?.to || '';

    // Write flag only when SendMessage targets context-provider (any suffix)
    if (to === 'context-provider' || to.startsWith('context-provider-')) {
      const flagPath = path.join(os.tmpdir(), `claude-cp-consulted-${sessionId}.flag`);
      fs.writeFileSync(flagPath, new Date().toISOString());
    }

    // BL-W35-06: per-agent-type arch-response flag — written when arch → specialist
    const ARCH_PREFIXES = ['arch-platform', 'arch-testing', 'arch-integration'];
    const SPECIALIST_NAMES = [
      'test-specialist', 'toolkit-specialist', 'ui-specialist',
      'domain-model-specialist', 'data-layer-specialist'
    ];
    const senderType = data.agent_type || '';
    const isArchSender = ARCH_PREFIXES.some(p => senderType === p || senderType.startsWith(p));
    const isSpecialistRecipient = SPECIALIST_NAMES.some(s => to === s || to.startsWith(s));
    if (isArchSender && isSpecialistRecipient) {
      const agentFlag = path.join(os.tmpdir(),
        `claude-arch-responded-${sessionId}-${sanitizeId(to)}.flag`);
      fs.writeFileSync(agentFlag, new Date().toISOString());
    }
  } catch (e) {
    // Silent — PostToolUse, never block
  }
  process.exit(0); // PostToolUse: always exit 0
});
