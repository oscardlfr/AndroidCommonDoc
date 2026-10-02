#!/usr/bin/env node
// context-provider-consulted.js — PostToolUse hook on SendMessage
// Writes claude-cp-consulted-{session_id}.flag when ANY agent addresses context-provider.
// Session-scoped flag: one agent consulting CP unblocks all peers in that session
// (via context-provider-gate.js). Matches Search Dispatch Protocol intent.
// Use os.tmpdir() — never hardcode /tmp/ (Windows).
//
// BL-W35-06 successor: arch → mediated-recipient handoffs are recorded as
// durable actor authorizations. They are keyed by the exact session_id +
// agent_id and current wave/PLAN, never by SendMessage.to or agent_type.
// Emergency escape:
//   rm "$(node -e "console.log(require('os').tmpdir())")/claude-cp-consulted-*.flag"

const fs = require('fs');
const os = require('os');
const path = require('path');
const actorAuthorization = require('../../scripts/lib/context-provider-actor-authorization.cjs');

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

    // The SendMessage host outcome carries the resumed actor's stable ID.
    // recordMediatedAuthorization resolves both actors through the durable
    // authority registry and rejects absent/ambiguous/foreign identities.
    // The presentation route (`to`) is intentionally not an input.
    actorAuthorization.recordMediatedAuthorization(
      process.env.CLAUDE_PROJECT_DIR || process.cwd(),
      data,
    );
  } catch (e) {
    // Silent — PostToolUse, never block
  }
  process.exit(0); // PostToolUse: always exit 0
});
