#!/usr/bin/env node
/**
 * Addressee Liveness Gate — PreToolUse hook for SendMessage.
 * Blocks SendMessage if the target peer has a shutdown notification
 * or has 3+ consecutive unanswered messages in this session.
 *
 * Fail-open: any parse/script error exits 0 (never block on hook failure).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');

const rl = readline.createInterface({ input: process.stdin });
let raw = '';
rl.on('line', line => { raw += line; });
rl.on('close', () => {
  try {
    const data = JSON.parse(raw);

    // Only intercept SendMessage
    if (data.tool_name !== 'SendMessage') process.exit(0);

    const toolInput = data.tool_input || {};
    const recipient = toolInput.to || '';
    const sessionId = data.session_id || '';

    if (!recipient || !sessionId) process.exit(0);

    // Sanitize recipient for filename safety
    const safeRecipient = recipient.replace(/[^a-zA-Z0-9_-]/g, '_');

    // Check shutdown flag: ~/.claude/teams/{sessionId}/shutdown-{recipient}.flag
    const teamsDir = path.join(os.homedir(), '.claude', 'teams', sessionId);
    const shutdownFlag = path.join(teamsDir, `shutdown-${safeRecipient}.flag`);
    if (fs.existsSync(shutdownFlag)) {
      console.log(JSON.stringify({
        decision: 'block',
        reason: `Addressee liveness gate: ${recipient} has a shutdown notification. Route to team-lead or an alternate peer instead.`
      }));
      process.exit(2);
    }

    // Check unanswered-message counter: ~/.claude/teams/{sessionId}/unanswered-{recipient}.count
    const countFile = path.join(teamsDir, `unanswered-${safeRecipient}.count`);
    if (fs.existsSync(countFile)) {
      const count = parseInt(fs.readFileSync(countFile, 'utf8').trim(), 10);
      if (!isNaN(count) && count >= 3) {
        console.log(JSON.stringify({
          decision: 'block',
          reason: `Addressee liveness gate: ${recipient} has ${count} consecutive unanswered messages. Suspected not alive. Route to team-lead or an alternate peer instead.`
        }));
        process.exit(2);
      }
    }

    process.exit(0);
  } catch (_) {
    // Fail open
    process.exit(0);
  }
});
