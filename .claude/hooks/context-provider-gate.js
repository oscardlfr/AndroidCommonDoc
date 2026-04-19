#!/usr/bin/env node
// context-provider-gate.js — PreToolUse hook
// Blocks Grep/Glob/Bash unless CP was consulted this session.
//
// EMPIRICAL FINDINGS (probe 2026-04-19, session c501e6c9-253c-4d27-a042-7dfbc39aa6ac):
//   - session_id IS present in PreToolUse payload and is stable across all tool calls
//   - CLAUDE_AGENT_NAME is NOT set in hook subprocess (env var absent)
//   - agent_id and agent_type ARE present in payload but agent_name is NOT
//   - Gate is session-level: one flag covers all tool calls in the session
//   - Identity resolution falls back to CLAUDE_AGENT_NAME env (null in practice);
//     exemption must rely on env var being set by the agent launcher or on flag presence
//
// Fail open on any error (never block due to script failure).
// Exempt: context-provider, team-lead, project-manager agents always allowed.
// Emergency escape: rm $(node -e "require('os').tmpdir()")/claude-cp-consulted-*.flag

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
    const toolName = data.tool_name || '';
    const sessionId = data.session_id || 'unknown';
    const agentType = data.agent_type || '';
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

    // 3. Check consultation flag
    const flagPath = path.join(os.tmpdir(), `claude-cp-consulted-${sessionId}.flag`);
    if (fs.existsSync(flagPath)) {
      process.exit(0); // CP consulted — allow
    }

    // 4. Block — write block marker for logger and emit decision
    const blockMarker = path.join(os.tmpdir(), `claude-cp-blocked-${sessionId}.flag`);
    try { fs.writeFileSync(blockMarker, new Date().toISOString()); } catch {}

    const out = JSON.stringify({
      decision: 'block',
      reason: 'context-provider not consulted this session. SendMessage to context-provider-2 first to validate pattern assumptions, then retry.'
    });
    process.stdout.write(out);
    process.exit(2);

  } catch (e) {
    // Fail open — never block due to script error
    process.exit(0);
  }
});
