#!/usr/bin/env node
// context-provider-gate.js — PreToolUse hook
// Blocks Grep/Glob/Bash-search unless ANY agent has consulted CP this session.
//
// Session-scoped flag: one CP consultation unblocks all peers in that session.
// The harness assigns a new agent_id per tool invocation for peer agents, so
// per-agent flags (old behavior) never matched between PostToolUse (SendMessage)
// and PreToolUse (Bash/Grep). Session-scoped flag restores dev autonomy.
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

    // 2a. Read on pattern-discovery paths requires CP consultation (T-BUG-015)
    try {
      if (toolName === 'Read') {
        const filePath = data.tool_input?.file_path ?? '';
        const isExemptPath =
          filePath.includes('/.planning/') ||
          filePath.includes('\\.planning\\') ||
          filePath.includes('/.claude/teams/') ||
          filePath.includes('\\.claude\\teams\\') ||
          filePath.endsWith('team.json') ||
          filePath.endsWith('config.json');
        if (!isExemptPath) {
          const isPatternDiscovery =
            (/[/\\]docs[/\\]/.test(filePath) && filePath.endsWith('.md')) ||
            (/[/\\]setup[/\\]agent-templates[/\\]/.test(filePath) && filePath.endsWith('.md')) ||
            (/[/\\]\.claude[/\\]agents[/\\]/.test(filePath) && filePath.endsWith('.md')) ||
            /skills[/\\][^/\\]+[/\\]SKILL\.md$/.test(filePath);
          if (isPatternDiscovery) {
            const tmpDir = process.env.TMPDIR || process.env.TMP || os.tmpdir();
            const flagPath = path.join(tmpDir, `claude-cp-consulted-${sessionId}.flag`);
            if (!fs.existsSync(flagPath)) {
              process.stdout.write(JSON.stringify({
                decision: 'block',
                reason: `[T-BUG-015] CP gate: Read on pattern/doc/template path "${filePath}" requires context-provider consultation first. SendMessage(to="context-provider") before reading pattern docs.`
              }));
              process.exit(2);
            }
          }
        }
        process.exit(0); // Read not blocked — allow
      }
    } catch { process.exit(0); }

    // 2b. Bash allow-list: non-search bash commands pass through
    if (toolName === 'Bash') {
      const cmd = data.tool_input?.command || '';
      // Block only if command contains search patterns
      if (!/grep\b|rg\b|find\b|cat\s+.*\.(kt|ts|md)/.test(cmd)) {
        process.exit(0); // build/git/gradlew bash commands — allow
      }
    }

    // 3. Check session consultation flag (any agent's CP consult unblocks all peers)
    const tmpDir = process.env.TMPDIR || process.env.TMP || os.tmpdir();
    const flagPath = path.join(tmpDir, `claude-cp-consulted-${sessionId}.flag`);
    if (fs.existsSync(flagPath)) {
      process.exit(0); // session has CP-consulted — allow
    }

    // 4. Block — write per-agent block marker for logger and emit decision
    const blockMarker = path.join(tmpDir, `claude-cp-blocked-${sessionId}-${agentId}.flag`);
    try { fs.writeFileSync(blockMarker, new Date().toISOString()); } catch {}

    const out = JSON.stringify({
      decision: 'block',
      reason: 'No agent in this session has consulted context-provider yet. SendMessage to context-provider first to validate pattern assumptions, then retry.'
    });
    process.stdout.write(out);
    process.exit(2);

  } catch (e) {
    // Fail open — never block due to script error
    process.exit(0);
  }
});
