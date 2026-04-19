#!/usr/bin/env node
// context-provider-consulted.js — PostToolUse hook on SendMessage
// Writes claude-cp-consulted-{session_id}.flag when CP is addressed.
// Use os.tmpdir() — never hardcode /tmp/ (Windows).

const fs = require('fs');
const os = require('os');
const path = require('path');

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
  } catch (e) {
    // Silent — PostToolUse, never block
  }
  process.exit(0); // PostToolUse: always exit 0
});
