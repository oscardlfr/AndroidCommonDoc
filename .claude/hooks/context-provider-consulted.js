#!/usr/bin/env node
// context-provider-consulted.js — PostToolUse hook on SendMessage
// Writes claude-cp-consulted-{session_id}-{sender_agent_id}.flag when the SENDER
// addresses context-provider. Per-agent flag: each agent must consult CP independently
// to unblock its own Grep/Glob/Bash-search calls (via context-provider-gate.js).
// Use os.tmpdir() — never hardcode /tmp/ (Windows).

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
    const senderId = sanitizeId(data.agent_id || 'unknown');
    const to = data.tool_input?.to || '';

    // Write flag only when SendMessage targets context-provider (any suffix)
    if (to === 'context-provider' || to.startsWith('context-provider-')) {
      const flagPath = path.join(os.tmpdir(), `claude-cp-consulted-${sessionId}-${senderId}.flag`);
      fs.writeFileSync(flagPath, new Date().toISOString());
    }
  } catch (e) {
    // Silent — PostToolUse, never block
  }
  process.exit(0); // PostToolUse: always exit 0
});
