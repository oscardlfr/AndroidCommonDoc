#!/usr/bin/env node
// context-provider-gate.js — PreToolUse hook
// Blocks Grep/Glob/Bash-search unless the CALLING agent has consulted CP this session.
//
// Per-agent flag: each agent must SendMessage context-provider to unblock its own searches.
// Session-scoped gates (old behavior) let ANY agent's consultation unblock EVERYONE — that
// created the Sprint 1 Wave 2 incident where devs grepped for patterns despite protocol.
// Per-agent flag enforces Search Dispatch Protocol mechanically.
//
// Exempt via agent_type prefix match: context-provider, project-manager, team-lead.
//
// Fail open on any error (never block due to script failure).
// Emergency escape: rm "$(node -e "console.log(require('os').tmpdir())")/claude-cp-consulted-*.flag"

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
    const toolName = data.tool_name || '';
    const sessionId = data.session_id || 'unknown';
    const agentType = data.agent_type || '';
    const agentId = sanitizeId(data.agent_id || 'unknown');
    const EXEMPT_TYPES = ['context-provider', 'project-manager', 'team-lead'];
    if (EXEMPT_TYPES.some(e => agentType === e || agentType.startsWith(e))) process.exit(0);

    // 2. Bash allow-list: non-search bash commands pass through
    if (toolName === 'Bash') {
      const cmd = data.tool_input?.command || '';
      // Block only if command contains search patterns
      if (!/grep\b|rg\b|find\b|cat\s+.*\.(kt|ts|md)/.test(cmd)) {
        process.exit(0); // build/git/gradlew bash commands — allow
      }
    }

    // 3. Check per-agent consultation flag
    const flagPath = path.join(os.tmpdir(), `claude-cp-consulted-${sessionId}-${agentId}.flag`);
    if (fs.existsSync(flagPath)) {
      process.exit(0); // this agent has consulted CP — allow
    }

    // 4. Block — write per-agent block marker for logger and emit decision
    const blockMarker = path.join(os.tmpdir(), `claude-cp-blocked-${sessionId}-${agentId}.flag`);
    try { fs.writeFileSync(blockMarker, new Date().toISOString()); } catch {}

    const out = JSON.stringify({
      decision: 'block',
      reason: 'This agent has not consulted context-provider this session. SendMessage to context-provider first to validate pattern assumptions, then retry.'
    });
    process.stdout.write(out);
    process.exit(2);

  } catch (e) {
    // Fail open — never block due to script error
    process.exit(0);
  }
});
