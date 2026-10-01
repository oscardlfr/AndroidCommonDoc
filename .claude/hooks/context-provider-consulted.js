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
const { ARCH_SENDER_PREFIXES, MEDIATED_RECIPIENT_ROLES } = require('./hook-control-plane-utils.js');

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
      const payload = JSON.stringify({
        written_by: data.agent_type || 'unknown',
        agent_id: data.agent_id || 'unknown',
        session_id: sessionId,
        ts: new Date().toISOString()
      });
      fs.writeFileSync(flagPath, payload);
    }

    // BL-W35-06: per-agent-type arch-response flag — written when arch → specialist or planner (mediated recipients)
    const senderType = data.agent_type || '';
    const isArchSender = ARCH_SENDER_PREFIXES.some(p => senderType === p || senderType.startsWith(p));
    const isSpecialistRecipient = MEDIATED_RECIPIENT_ROLES.some(s => to === s || to.startsWith(s));
    if (isArchSender && isSpecialistRecipient) {
      const agentFlag = path.join(os.tmpdir(),
        `claude-arch-responded-${sessionId}-${sanitizeId(to)}.flag`);
      const archPayload = JSON.stringify({
        written_by: senderType,
        agent_id: data.agent_id || 'unknown',
        session_id: sessionId,
        ts: new Date().toISOString()
      });
      fs.writeFileSync(agentFlag, archPayload);
    }
  } catch (e) {
    // Silent — PostToolUse, never block
  }
  process.exit(0); // PostToolUse: always exit 0
});
