#!/usr/bin/env node
// knowledge-currency-gate.js — PreToolUse hook for SendMessage (FIND-06, BL-W42 PR5).
//
// Blocks arch-platform and arch-testing from sending messages that contain KMP
// API claims (commonMain, kotlinx, expect/actual, appleMain, jvmMain) unless the
// sender confirms the claim is CP-verified via KMP_CURRENCY_CHECKED=1 env OR an
// inline [KMP_CURRENCY_CHECKED] marker in the message body.
//
// Fail-open on any parse error or stdin timeout (exit 0).

const KMP_KEYWORDS = ['commonMain', 'kotlinx', 'expect/actual', 'appleMain', 'jvmMain'];
const GUARDED_AGENTS = ['arch-platform', 'arch-testing'];

let input = '';
const stdinTimeout = setTimeout(() => process.exit(0), 5000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => (input += chunk));
process.stdin.on('end', () => {
  clearTimeout(stdinTimeout);

  let data;
  try {
    data = JSON.parse(input);
  } catch {
    process.exit(0);
  }

  if (data.tool_name !== 'SendMessage') process.exit(0);

  const agentType = (data.agent_type ?? '').toLowerCase();
  if (!GUARDED_AGENTS.includes(agentType)) process.exit(0);

  const messageRaw = data.tool_input?.message;
  const body = typeof messageRaw === 'string' ? messageRaw : JSON.stringify(messageRaw ?? '');

  const hasKmpClaim = KMP_KEYWORDS.some(kw => body.includes(kw));
  if (!hasKmpClaim) process.exit(0);

  // Inline marker bypass
  if (body.includes('[KMP_CURRENCY_CHECKED]')) process.exit(0);

  // Env bypass
  if (process.env.KMP_CURRENCY_CHECKED === '1') process.exit(0);
  if (process.env.KMP_CURRENCY_GATE_BYPASS === '1') process.exit(0);

  process.stderr.write(
    `[knowledge-currency-gate] BLOCKED: ${agentType} message contains KMP API claims ` +
    `but KMP_CURRENCY_CHECKED is not set.\n` +
    `Before sending KMP-specific assertions, confirm with context-provider that the ` +
    `claim is current.\n` +
    `Bypass options:\n` +
    `  1. Export KMP_CURRENCY_CHECKED=1 after CP confirms the claim\n` +
    `  2. Include [KMP_CURRENCY_CHECKED] inline marker in the message body\n` +
    `Reference: FIND-06 (BL-W41)\n`
  );
  process.exit(2);
});
