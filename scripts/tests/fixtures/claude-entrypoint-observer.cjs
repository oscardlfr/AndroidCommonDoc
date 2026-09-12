'use strict';

// Passive P4 entrypoint observer. It records native hook payloads for the
// launcher but never imports production authority and never returns a hook
// decision or updatedInput.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeysDeep(value[key])]));
  }
  return value;
}

function digestString(value) {
  return crypto.createHash('sha256').update(Buffer.from(value, 'utf8')).digest('hex');
}

function digestObject(value) {
  return digestString(JSON.stringify(sortKeysDeep(value)));
}

function main() {
  const rootArg = argValue('--root');
  const evidenceMode = argValue('--evidence-mode');
  if (!rootArg || !['fake-fixture', 'genuine-pinned'].includes(evidenceMode)) return 64;
  const root = fs.realpathSync(rootArg);
  const stat = fs.lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) return 65;
  const event = JSON.parse(fs.readFileSync(0, 'utf8'));
  const allowedEvents = new Set(['SessionStart', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'SubagentStart', 'SubagentStop']);
  if (!event || !allowedEvents.has(event.hook_event_name)
      || typeof event.session_id !== 'string' || event.session_id.length === 0) return 66;
  const observerRoot = path.join(root, 'observer');
  fs.mkdirSync(observerRoot, { recursive: true });
  const observerRealParent = fs.realpathSync(observerRoot);
  if (observerRealParent !== root && !observerRealParent.startsWith(`${root}${path.sep}`)) return 67;
  const row = {
    schema: 'runtime/claude-entrypoint-observer-event/v1',
    evidence_mode: evidenceMode,
    producer: 'claude-entrypoint-observer',
    hook_event_name: event.hook_event_name,
    session_digest: digestString(event.session_id),
    tool_use_digest: typeof event.tool_use_id === 'string' ? digestString(event.tool_use_id) : null,
    prompt_id_digest: typeof event.prompt_id === 'string' ? digestString(event.prompt_id) : null,
    agent_id_digest: typeof event.agent_id === 'string' ? digestString(event.agent_id) : null,
    agent_type: typeof event.agent_type === 'string' ? event.agent_type : null,
    tool_name: typeof event.tool_name === 'string' ? event.tool_name : null,
    tool_input_digest: event.tool_input === undefined ? null : digestObject(event.tool_input),
    updated_input_digest: null,
    raw_event: event,
    observed_at: new Date().toISOString(),
  };
  fs.appendFileSync(path.join(observerRoot, 'events.jsonl'), `${JSON.stringify(row)}\n`, { encoding: 'utf8', flag: 'a' });
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  process.stderr.write(`${error && error.message ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
